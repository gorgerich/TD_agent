import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { GET as readPayments } from "../../app/api/agent/cases/[caseId]/payments/route";
import { POST as contractCommand } from "../../app/api/agent/cases/[caseId]/contract/route";
import { POST as createLead } from "../../app/api/agent/leads/route";
import { POST as transitionCommand } from "../../app/api/agent/cases/[caseId]/transition/route";
import { PATCH as updatePartyRoute } from "../../app/api/agent/cases/[caseId]/parties/[partyId]/route";
import {
  createContractVersion, decideLedgerAdjustment, getPaymentSummary,
  issueContractVersion, recordManualPayment, recordRefund,
  requestLedgerAdjustment, signContractVersion,
} from "../../lib/contractLedgerService";
import { createCaseParty, updateCaseParty, type CasePartyInput } from "../../lib/casePartyService";
import { getCanonicalCase } from "../../lib/caseReadModel";
import { transitionCase } from "../../lib/caseService";
import { advanceCaseFulfilment } from "../../lib/caseFulfilment";
import { reconcileM3Case } from "../../lib/m3Reconciliation";
import { materializeCaseRequirements } from "../../lib/documentRequirementService";
import { beginDocumentReview, decideDocumentReview, uploadCaseDocument } from "../../lib/documentService";
import type { DocumentScanner } from "../../lib/documentScanner";
import { encryptField } from "../../lib/crypto";
import { commandFingerprint } from "../../lib/m3Command";
import { serverCommandKey } from "../../lib/commandNamespace";
import { OperationalCommandError } from "../../lib/operationalTransaction";
import { SESSION_COOKIE, signSession } from "../../lib/session";
import { encryptPlatformMfaSecret, generatePlatformMfaSecret } from "../../lib/platformMfa";
import { InMemoryTestStorage } from "../fixtures/testStorage";
import { syntheticDocumentPdf } from "../cpoAuditDocuments.fixture.mjs";
import { installM3OrganizationBaseline } from "./_m3Baseline";
import { createFixtureContext, db, makeRequest, skip, type FixtureCase, type FixtureMember } from "./_setup";

const opts = { skip: skip ? "DB access not authorized; requires approved isolated integration environment" : false };
const fixtures = createFixtureContext("cpo-audit-finance");
const storage = new InMemoryTestStorage();
const scanner: DocumentScanner = {
  isOperational: () => true,
  async scan() { return { status: "CLEAN", provider: "synthetic-finance-test", resultCode: "CLEAN" }; },
};
const AMOUNT = 100_000;
const PRIVATE_PAYER = "SYNTHETIC_PRIVATE_PAYER_DO_NOT_RETURN";
let agent: FixtureMember;
let peer: FixtureMember;
let manager: FixtureMember;
let reviewer: FixtureMember;
let finance: FixtureMember;
let approver: FixtureMember;
let outsider: FixtureMember;
let signingPolicyVersion: string;
let sequence = 0;

function meta(label: string) {
  return {
    idempotencyKey: `${fixtures.runId}:${++sequence}:${label}`,
    correlationId: `${fixtures.runId}:finance-regression`,
    reason: "Synthetic CPO finance regression",
  };
}

async function cookie(member: FixtureMember, mfaVerified = false) {
  const user = await db.user.findUniqueOrThrow({ where: { id: member.userId }, select: { sessionVersion: true } });
  return `${SESSION_COOKIE}=${await signSession({
    userId: member.userId, sessionVersion: user.sessionVersion,
    activeMembershipId: member.membershipId, mfaVerified,
  })}`;
}

async function expectStatus(work: Promise<unknown>, status: number) {
  await assert.rejects(work, (error: unknown) => error instanceof OperationalCommandError && error.status === status);
}

before(async () => {
  if (skip) return;
  const organizationId = await fixtures.makeOrganization("primary");
  agent = await fixtures.makeMember("owner", { organizationId });
  peer = await fixtures.makeMember("peer", { organizationId });
  manager = await fixtures.makeMember("manager", { organizationId, role: "MANAGER" });
  reviewer = await fixtures.makeMember("reviewer", { organizationId, role: "DOCUMENT_REVIEWER" });
  finance = await fixtures.makeMember("finance", { organizationId, role: "FINANCE" });
  approver = await fixtures.makeMember("approver", { organizationId, role: "FINANCE" });
  outsider = await fixtures.makeMember("foreign-finance", { role: "FINANCE" });
  for (const member of [finance, approver, outsider]) {
    await db.user.update({ where: { id: member.userId }, data: {
      platformMfaEnabledAt: new Date(), platformMfaSecretEncrypted: encryptPlatformMfaSecret(generatePlatformMfaSecret()),
    } });
  }
  const baseline = await installM3OrganizationBaseline(organizationId);
  baseline.policyIds.forEach(fixtures.trackDocumentPolicy);
  baseline.documentTypeIds.forEach(fixtures.trackDocumentType);
  signingPolicyVersion = `SYNTHETIC_CPO_FINANCE_${fixtures.runId}`;
  const policy = await db.contractSigningPolicy.create({ data: {
    organizationId, version: signingPolicyVersion, status: "APPROVED",
    allowedEvidenceTypes: ["SYNTHETIC_TEST_ONLY"], source: "SYNTHETIC_TEST_ONLY_NOT_A_LEGAL_VERDICT",
    approvedByUserId: manager.userId, approvedAt: new Date(), effectiveFrom: new Date(Date.now() - 60_000),
  } });
  fixtures.trackSigningPolicy(policy.id);
  await db.financialControlPolicy.create({ data: {
    organizationId, version: 1, status: "APPROVED", correctionThresholdKopecks: 10_000,
    source: "SYNTHETIC_TEST_ONLY_NOT_A_FINANCE_VERDICT", approvedAt: new Date(),
  } });
});

after(async () => {
  storage.clear();
  if (skip) return;
  await fixtures.cleanup();
  await fixtures.assertNoResidue();
});

// Only synthetic initial state is seeded directly. Contracts, money, approvals,
// document verification and stage advancement use canonical application commands.
async function publishedQuote(record: FixtureCase, amount: number, accepted: boolean, quoteId?: number) {
  if (quoteId === undefined) {
    const meeting = await db.meeting.create({ data: {
      leadId: record.leadId, agentId: agent.agentId, organizationId: agent.organizationId,
      caseId: record.id, ownerMembershipId: agent.membershipId, idempotencyKey: meta("meeting").idempotencyKey,
    } });
    quoteId = (await db.quote.create({ data: {
      meetingId: meeting.id, organizationId: agent.organizationId, caseId: record.id,
      ownerMembershipId: agent.membershipId, scenario: "CREMATION_V1", status: accepted ? "ACCEPTED" : "PUBLISHED", currency: "RUB",
    } })).id;
  }
  const versionNumber = 1 + ((await db.quoteVersion.aggregate({ where: { quoteId }, _max: { versionNumber: true } }))._max.versionNumber ?? 0);
  const command = meta("quote-version");
  const version = await db.quoteVersion.create({ data: {
    quoteId, versionNumber, state: "PUBLISHED", totalState: "KNOWN", subtotal: amount,
    discountTotal: 0, total: amount, currency: "RUB", snapshotChecksum: "a".repeat(64),
    payload: JSON.stringify({ schemaVersion: 1, total: amount, synthetic: true }),
    catalogSourceVersion: "synthetic-finance-regression", publishedByMembershipId: agent.membershipId,
    publishedAt: new Date(), validUntil: new Date(Date.now() + 86_400_000),
    publishReason: "Synthetic CPO regression", publishChannel: "integration",
    idempotencyKey: command.idempotencyKey, correlationId: command.correlationId,
  } });
  await db.quote.update({ where: { id: quoteId }, data: { latestPublishedVersionId: version.id, status: accepted ? "ACCEPTED" : "PUBLISHED" } });
  if (accepted) await acceptFixtureQuote(version.id);
  await db.case.update({ where: { id: record.id }, data: { publishedQuoteVersionId: version.id } });
  return version;
}

async function acceptFixtureQuote(quoteVersionId: number) {
  const command = meta("acceptance");
  await db.quoteClientDecision.create({ data: {
    quoteVersionId, type: "ACCEPTED", source: "SYNTHETIC_TEST_ONLY",
    idempotencyKey: command.idempotencyKey, correlationId: command.correlationId,
  } });
}

async function draftContract(label: string) {
  const record = await fixtures.makeCase(agent, label);
  await db.clientLead.update({ where: { id: record.leadId }, data: {
    deceasedName: encryptField("Synthetic deceased"), ceremonyType: "кремация",
    context: encryptField("SYNTHETIC_PRIVATE_LEAD_CONTEXT"),
  } });
  await db.case.update({ where: { id: record.id }, data: { scenarioId: "CREMATION_V1", stage: "CONTRACTING" } });
  await materializeCaseRequirements(agent.context, record.id, meta("requirements"));
  const payer = await createCaseParty(agent.context, record.id, {
    name: PRIVATE_PAYER, phone: "+79160000001", email: "private-payer@synthetic.invalid",
    roles: ["PAYER"], preferredChannel: "NONE", consentStatus: "NOT_REQUESTED", visibilityPolicy: "FINANCE_LIMITED",
  }, meta("payer"));
  const quote = await publishedQuote(record, AMOUNT, true);
  const draft = await createContractVersion(agent.context, {
    caseId: record.id, payerPartyId: payer.partyId, paymentTerms: { mode: "synthetic-manual" },
  }, meta("contract-create"));
  return { record, payerId: payer.partyId, quote, contractVersionId: draft.contractVersionId };
}

function signature(contractVersionId: string) {
  return {
    contractVersionId, signatureEvidence: { type: "SYNTHETIC_TEST_ONLY", reference: "synthetic-finance-signature" },
    signaturePolicyVersion: signingPolicyVersion,
  };
}

async function signedContract(label: string, documentsReady = false) {
  const state = await draftContract(label);
  if (documentsReady) await verifyDocuments(state.record);
  await issueContractVersion(agent.context, state.contractVersionId, meta("issue"));
  const signed = await signContractVersion(agent.context, signature(state.contractVersionId), meta("sign"));
  return { ...state, ...signed };
}

function payerChange(roles: CasePartyInput["roles"]): CasePartyInput {
  return { name: PRIVATE_PAYER, phone: "+79160000001", email: "private-payer@synthetic.invalid",
    roles, preferredChannel: "NONE", consentStatus: "NOT_REQUESTED", visibilityPolicy: "FINANCE_LIMITED" };
}

async function payerBoundaryState(record: FixtureCase, payerId: string) {
  return {
    party: await db.caseParty.findUniqueOrThrow({ where: { id: payerId } }),
    roles: await db.casePartyRoleAssignment.findMany({ where: { casePartyId: payerId }, orderBy: { id: "asc" } }),
    case: await db.case.findUniqueOrThrow({ where: { id: record.id } }),
    contractRoots: await db.contract.findMany({ where: { caseId: record.id }, orderBy: { id: "asc" } }),
    contracts: await db.contractVersion.findMany({ where: { caseId: record.id }, orderBy: { id: "asc" } }),
    obligations: await db.paymentObligation.findMany({ where: { caseId: record.id }, orderBy: { id: "asc" } }),
    ledger: await db.paymentLedgerEntry.findMany({ where: { caseId: record.id }, orderBy: { id: "asc" } }),
    events: await db.caseEvent.findMany({ where: { caseId: record.id }, orderBy: { id: "asc" } }),
    requirements: await db.caseDocumentRequirement.findMany({ where: { caseId: record.id }, orderBy: { id: "asc" } }),
    audits: await db.operationalAuditEvent.findMany({ where: { organizationId: agent.organizationId }, orderBy: { id: "asc" } }),
  };
}

test("CPO09: issued and signed bound PAYER removal is 409 through API with no state or audit writes", opts, async () => {
  const ownerCookie = await cookie(agent);
  for (const status of ["ISSUED", "SIGNED"] as const) {
    const state = await draftContract(`payer-bound-${status}`);
    await issueContractVersion(agent.context, state.contractVersionId, meta(`payer-${status}-issue`));
    if (status === "SIGNED") await signContractVersion(agent.context, signature(state.contractVersionId), meta("payer-bound-sign"));
    const beforeState = await payerBoundaryState(state.record, state.payerId);
    assert.equal(beforeState.contracts.find((version) => version.id === state.contractVersionId)?.status, status);
    const command = meta(`payer-${status}-remove`);
    const invoke = () => updatePartyRoute(makeRequest(`/api/agent/cases/${state.record.leadId}/parties/${state.payerId}`, {
      method: "PATCH", cookie: ownerCookie, body: payerChange(["ADDITIONAL_CONTACT"]),
      headers: { "Idempotency-Key": command.idempotencyKey, "X-Correlation-Id": command.correlationId },
    }), { params: Promise.resolve({ caseId: String(state.record.leadId), partyId: state.payerId }) });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await invoke();
      assert.equal(response.status, 409);
      assert.match((await response.json()).error, /Плательщик закреплён в выданном договоре/);
      assert.deepEqual(await payerBoundaryState(state.record, state.payerId), beforeState);
    }
  }
});

test("CPO09: multiple active payers are allowed and an unbound draft payer can change role", opts, async () => {
  const state = await draftContract("payer-unbound");
  const other = await createCaseParty(agent.context, state.record.id, { ...payerChange(["PAYER", "APPLICANT"]), name: "Synthetic second payer" }, meta("second-payer"));
  assert.equal(await db.casePartyRoleAssignment.count({ where: { caseParty: { caseId: state.record.id }, role: "PAYER", validUntil: null } }), 2);
  const command = meta("unbound-role-change");
  const changed = await updateCaseParty(agent.context, state.record.id, state.payerId, payerChange(["ADDITIONAL_CONTACT"]), command);
  assert.equal(changed.partyId, state.payerId);
  assert.equal(changed.replayed, false);
  assert.deepEqual(await updateCaseParty(agent.context, state.record.id, state.payerId, payerChange(["ADDITIONAL_CONTACT"]), command), { ...changed, replayed: true });
  assert.equal(await db.casePartyRoleAssignment.count({ where: { casePartyId: state.payerId, role: "PAYER", validUntil: null } }), 0);
  assert.equal(await db.casePartyRoleAssignment.count({ where: { casePartyId: other.partyId, role: "PAYER", validUntil: null } }), 1);
  assert.equal((await db.contractVersion.findUniqueOrThrow({ where: { id: state.contractVersionId } })).status, "DRAFT");
});

test("CPO09: injected payer-role drift blocks ISSUE and SIGN atomically and reconciles issued contract drift", opts, async () => {
  const state = await draftContract("payer-role-drift");
  const ownerCookie = await cookie(agent);
  const expirePayer = () => db.casePartyRoleAssignment.updateMany({
    where: { casePartyId: state.payerId, role: "PAYER", validUntil: null },
    data: { validFrom: new Date(Date.now() - 2000), validUntil: new Date(Date.now() - 1000) },
  });
  for (const action of ["ISSUE", "SIGN"] as const) {
    // Deliberate out-of-band corruption, not an application command: exercises revalidation.
    assert.equal((await expirePayer()).count, 1);
    const beforeState = await payerBoundaryState(state.record, state.payerId);
    const command = meta(`drift-${action}`);
    const response = await contractCommand(makeRequest(`/api/agent/cases/${state.record.leadId}/contract`, {
      method: "POST", cookie: ownerCookie,
      body: action === "ISSUE" ? { action, contractVersionId: state.contractVersionId } : { action, ...signature(state.contractVersionId) },
      headers: { "Idempotency-Key": command.idempotencyKey, "X-Correlation-Id": command.correlationId },
    }), { params: Promise.resolve({ caseId: String(state.record.leadId) }) });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /Роль плательщика изменилась/);
    assert.deepEqual(await payerBoundaryState(state.record, state.payerId), beforeState);
    const reconciliation = await reconcileM3Case(manager.context, state.record.id);
    assert.equal(reconciliation.discrepancies.some((item) => item.code === "CONTRACT_PAYER_DRIFT" && item.entityId === state.contractVersionId), action === "SIGN",
      "payer drift is reported for the issued contract, not an unissued draft");
    if (action === "ISSUE") {
      await updateCaseParty(agent.context, state.record.id, state.payerId, payerChange(["PAYER"]), meta("restore-draft-payer"));
      await issueContractVersion(agent.context, state.contractVersionId, meta("issue-restored-payer"));
    }
  }
});

test("CPO09: concurrent ISSUE and payer removal cannot both commit or leave issued payer drift", opts, async () => {
  const state = await draftContract("payer-issue-race");
  const issueMeta = meta("race-issue");
  const removeMeta = meta("race-remove");
  const results = await Promise.allSettled([
    issueContractVersion(agent.context, state.contractVersionId, issueMeta),
    updateCaseParty(agent.context, state.record.id, state.payerId, payerChange(["ADDITIONAL_CONTACT"]), removeMeta),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, "exactly one conflicting command commits");
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof OperationalCommandError && rejected.reason.status === 409);
  const issued = results[0].status === "fulfilled";
  assert.equal((await db.contractVersion.findUniqueOrThrow({ where: { id: state.contractVersionId } })).status, issued ? "ISSUED" : "DRAFT");
  assert.equal(await db.casePartyRoleAssignment.count({ where: { casePartyId: state.payerId, role: "PAYER", validUntil: null } }), issued ? 1 : 0);
  for (const [index, command] of [issueMeta, removeMeta].entries()) {
    assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: agent.organizationId, idempotencyKey: command.idempotencyKey } }), results[index].status === "fulfilled" ? 1 : 0);
  }
  assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: agent.organizationId,
    idempotencyKey: serverCommandKey("db-auth-contract", `${issueMeta.idempotencyKey}:${state.contractVersionId}:issue`),
    action: "m3.lifecycle_transition_authorized.v1",
  } }), issued ? 1 : 0);
  assert.equal((await reconcileM3Case(manager.context, state.record.id)).discrepancies.some((item) => item.code === "CONTRACT_PAYER_DRIFT"), false);
});

async function verifyDocuments(record: FixtureCase) {
  const requirements = await db.caseDocumentRequirement.findMany({ where: { caseId: record.id, isApplicable: true } });
  assert.equal(requirements.length, 3);
  for (const requirement of requirements) {
    const types = requirement.acceptedDocumentTypeCodes as string[];
    const uploaded = await uploadCaseDocument(agent.context, {
      caseId: record.id, requirementId: requirement.id, documentTypeCode: types[0]!,
      file: new File([syntheticDocumentPdf(`synthetic ${requirement.stableKey}`)], "synthetic.pdf", { type: "application/pdf" }),
    }, meta("document-upload"), { storage, scanner });
    await beginDocumentReview(reviewer.context, uploaded.versionId, meta("review-start"));
    await decideDocumentReview(reviewer.context, uploaded.versionId, {
      decision: "VERIFIED", checklist: Object.fromEntries((requirement.reviewChecklist as string[]).map((key) => [key, true])),
    }, meta("review-approve"), storage);
  }
}

function paymentInput(obligationId: string, payerId: string, amountKopecks: number) {
  return {
    obligationId, payerPartyId: payerId, amountKopecks, currency: "RUB", occurredAt: new Date(),
    method: "BANK_TRANSFER" as const, evidenceReference: "synthetic-payment-evidence", reason: "Synthetic received payment",
  };
}

async function closeCase(record: FixtureCase) {
  for (const eventType of ["execution.confirmed.v1", "case.closure_requested.v1"] as const) {
    const command = meta(eventType);
    await transitionCase({ leadId: record.leadId, eventType,
      payload: eventType === "execution.confirmed.v1" ? { confirmationSource: "OPERATOR_CONFIRMED" } : {},
      context: { ...agent.context, actorId: agent.agentId, ...command },
    });
  }
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: record.id } })).stage, "CLOSED");
}

test("CPO finance: overpayment refund preserves PAID, immutable history, replay truth and closure", opts, async () => {
  const state = await signedContract("overpayment", true);
  const paid = await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, 120_000), meta("overpay"));
  const input = { paymentEntryId: paid.ledgerEntryId, amountKopecks: 20_000, occurredAt: new Date(),
    method: "BANK_TRANSFER" as const, evidenceReference: "synthetic-surplus-refund", reason: "Return surplus only" };
  const command = meta("surplus-refund");
  const refunded = await recordRefund(finance.context, input, command);
  assert.equal(refunded.summary.status, "PAID");
  assert.equal(refunded.summary.balanceKopecks, 0);
  assert.equal(refunded.summary.refundedKopecks, 20_000);
  assert.deepEqual(await recordRefund(finance.context, input, command), { ...refunded, replayed: true });
  const rows = await db.paymentLedgerEntry.findMany({ where: { obligationId: state.obligationId }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(rows.map((row) => [row.type, row.amountKopecks]), [["OBLIGATION", AMOUNT], ["PAYMENT", 120_000], ["REFUND", 20_000]]);
  const read = await getCanonicalCase(agent.context, state.record.leadId);
  assert.equal(read?.guardState.payment_satisfied, true);
  assert.equal(read?.payment.balanceKopecks, 0);
  assert.equal((await reconcileM3Case(manager.context, state.record.id)).discrepancyCount, 0);
  await closeCase(state.record);
});

test("CPO finance: refund then repayment reopens coverage without reversing real refund history", opts, async () => {
  const state = await signedContract("refund-repay");
  const paid = await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, AMOUNT), meta("pay"));
  await recordRefund(finance.context, { paymentEntryId: paid.ledgerEntryId, amountKopecks: 40_000, occurredAt: new Date(),
    method: "BANK_TRANSFER", evidenceReference: "synthetic-real-refund", reason: "Synthetic partial refund" }, meta("refund"));
  assert.equal((await getPaymentSummary(finance.context, state.obligationId)).balanceKopecks, 40_000);
  assert.equal((await getCanonicalCase(agent.context, state.record.leadId))?.guardState.payment_satisfied, false);
  await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, 40_000), meta("repay"));
  const summary = await getPaymentSummary(finance.context, state.obligationId);
  assert.equal(summary.status, "PAID");
  assert.equal(summary.balanceKopecks, 0);
  assert.equal(summary.refundedKopecks, 40_000);
  await verifyDocuments(state.record);
  await advanceCaseFulfilment({ organizationId: agent.organizationId, caseId: state.record.id,
    actorAgentId: agent.agentId, actorMembershipId: agent.membershipId, ...meta("advance-repaid") });
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: state.record.id } })).stage, "EXECUTION");
  assert.equal(await db.paymentLedgerEntry.count({ where: { obligationId: state.obligationId, type: "REVERSAL" } }), 0);
  await closeCase(state.record);
});

test("real Production missing or malformed policy bindings cannot advance populated M3 cases", opts, async () => {
  const state = await signedContract("missing-production-policy", true);
  await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, AMOUNT), meta("covered-before-disable"));
  const auth = await cookie(agent);
  const previous = { environment: process.env.VERCEL_ENV, bindings: process.env.M3_PRODUCTION_POLICY_BINDINGS };
  const snapshot = async () => ({
    record: await db.case.findUniqueOrThrow({ where: { id: state.record.id } }),
    events: await db.caseEvent.count({ where: { caseId: state.record.id } }),
    tasks: await db.task.count({ where: { caseId: state.record.id } }),
    audit: await db.operationalAuditEvent.count({ where: { organizationId: agent.organizationId } }),
    ledger: await db.paymentLedgerEntry.count({ where: { caseId: state.record.id } }),
  });
  try {
    for (const binding of [undefined, "{}", "not-json", JSON.stringify({ [agent.organizationId]: "invalid" })]) {
      for (const [eventType, stage, payload] of [
        ["contract.signed.v1", "CONTRACTING", {}],
        ["payment.requirement_satisfied.v1", "PAYMENT", {}],
        ["execution.confirmed.v1", "EXECUTION", { confirmationSource: "OPERATOR_CONFIRMED" }],
        ["case.closure_requested.v1", "EXECUTION", {}],
      ] as const) {
        // Recreate the durable projection gap without altering signed/paid/verified history.
        await db.case.update({ where: { id: state.record.id }, data: { stage, guardState: { execution_confirmed: true } } });
        process.env.VERCEL_ENV = "production";
        if (binding === undefined) delete process.env.M3_PRODUCTION_POLICY_BINDINGS;
        else process.env.M3_PRODUCTION_POLICY_BINDINGS = binding;
        const before = await snapshot();
        const command = meta("disabled-production-stage");
        const denied = await transitionCommand(makeRequest(`/api/agent/cases/${state.record.leadId}/transition`, {
          method: "POST", cookie: auth, body: { eventType, payload },
          headers: { "idempotency-key": command.idempotencyKey, "x-correlation-id": command.correlationId },
        }), { params: Promise.resolve({ caseId: String(state.record.leadId) }) });
        assert.equal(denied.status, 403);
        assert.deepEqual(await snapshot(), before);
      }
    }
  } finally {
    if (previous.environment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous.environment;
    if (previous.bindings === undefined) delete process.env.M3_PRODUCTION_POLICY_BINDINGS;
    else process.env.M3_PRODUCTION_POLICY_BINDINGS = previous.bindings;
  }
});

test("CPO finance: refund after EXECUTION entry blocks confirmation atomically until coverage returns", opts, async () => {
  const state = await signedContract("execution-refund", true);
  const paid = await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, AMOUNT), meta("execution-pay"));
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: state.record.id } })).stage, "EXECUTION");
  await recordRefund(finance.context, {
    paymentEntryId: paid.ledgerEntryId, amountKopecks: AMOUNT, occurredAt: new Date(),
    method: "BANK_TRANSFER", evidenceReference: "synthetic-execution-refund", reason: "Synthetic full refund before confirmation",
  }, meta("execution-refund"));
  const reconciliation = await reconcileM3Case(manager.context, state.record.id);
  assert.equal(reconciliation.discrepancyCount, 0);
  assert.equal((await getPaymentSummary(finance.context, state.obligationId)).balanceKopecks, AMOUNT);
  const snapshot = async () => ({
    record: await db.case.findUniqueOrThrow({ where: { id: state.record.id } }),
    events: await db.caseEvent.count({ where: { caseId: state.record.id } }),
    tasks: await db.task.count({ where: { caseId: state.record.id } }),
    audit: await db.operationalAuditEvent.count({ where: { organizationId: agent.organizationId } }),
  });
  const before = await snapshot();
  const command = meta("execution-confirm");
  const ownerCookie = await cookie(agent);
  const invoke = () => transitionCommand(makeRequest(`/api/agent/cases/${state.record.leadId}/transition`, {
    method: "POST", cookie: ownerCookie,
    body: { eventType: "execution.confirmed.v1", payload: { confirmationSource: "OPERATOR_CONFIRMED" } },
    headers: { "Idempotency-Key": command.idempotencyKey, "X-Correlation-Id": command.correlationId },
  }), { params: Promise.resolve({ caseId: String(state.record.leadId) }) });
  for (let attempt = 0; attempt < 2; attempt++) {
    const rejected = await invoke();
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json()).details.guard, "payment_satisfied");
    assert.deepEqual(await snapshot(), before);
  }
  await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, AMOUNT), meta("execution-repay"));
  const accepted = await invoke();
  assert.equal(accepted.status, 200);
  const first = await accepted.json();
  assert.equal(first.replayed, false);
  const after = await snapshot();
  const replay = await invoke();
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { ...first, replayed: true });
  assert.deepEqual(await snapshot(), after);
  assert.equal((await reconcileM3Case(manager.context, state.record.id)).discrepancyCount, 0);
});

test("CPO finance: cumulative sub-threshold corrections across source payments require a second actor", opts, async () => {
  const state = await signedContract("cumulative");
  const first = await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, 30_000), meta("source-a"));
  const second = await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, 30_000), meta("source-b"));
  const adjustment = (relatedEntryId: string) => ({ type: "CORRECTION" as const, relatedEntryId, direction: "CREDIT" as const,
    amountKopecks: 6_000, occurredAt: new Date(), evidenceReference: "synthetic-correction", reason: "Synthetic cumulative correction" });
  const below = await requestLedgerAdjustment(finance.context, adjustment(first.ledgerEntryId), meta("below-threshold"));
  const above = await requestLedgerAdjustment(finance.context, adjustment(second.ledgerEntryId), meta("cross-threshold"));
  assert.equal(below.approvalRequired, false);
  assert.equal(above.approvalRequired, true);
  assert.equal((await getPaymentSummary(finance.context, state.obligationId)).paidKopecks, 66_000);
  const decision = { ledgerEntryId: above.ledgerEntryId, decision: "APPROVED" as const, reason: "Independent synthetic approval" };
  await expectStatus(decideLedgerAdjustment(finance.context, decision, meta("self-approve")), 403);
  const command = meta("independent-approve");
  const approved = await decideLedgerAdjustment(approver.context, decision, command);
  assert.equal(approved.summary.paidKopecks, 72_000);
  assert.deepEqual(await decideLedgerAdjustment(approver.context, decision, command), { ...approved, replayed: true });
  assert.equal(await db.paymentLedgerEntry.count({ where: { obligationId: state.obligationId, type: "CORRECTION" } }), 2);
});

test("CPO finance: concurrent splitting cannot make both threshold-crossing corrections effective", opts, async () => {
  const state = await signedContract("parallel-splitting");
  const paid = await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, 50_000), meta("parallel-source"));
  const results = await Promise.all(["a", "b"].map((label) => requestLedgerAdjustment(finance.context, {
    type: "CORRECTION", relatedEntryId: paid.ledgerEntryId, direction: "CREDIT", amountKopecks: 6_000,
    occurredAt: new Date(), evidenceReference: "synthetic-parallel-correction", reason: "Concurrent split regression",
  }, meta(`parallel-${label}`))));
  assert.deepEqual(results.map((result) => result.approvalRequired).sort(), [false, true]);
  assert.equal((await getPaymentSummary(finance.context, state.obligationId)).paidKopecks, 56_000);
  assert.equal(await db.paymentLedgerEntry.count({ where: { obligationId: state.obligationId, type: "CORRECTION" } }), 2);
});

test("CPO finance: FINANCE GET reads peer-owned money without PII and never crosses tenant/owner/MFA boundaries", opts, async () => {
  const state = await signedContract("finance-read");
  const path = `/api/agent/cases/${state.record.leadId}/payments`;
  const params = { params: Promise.resolve({ caseId: String(state.record.leadId) }) };
  const response = await readPayments(makeRequest(path, { cookie: await cookie(finance, true) }), params);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.caseId, state.record.id);
  assert.equal(body.versions[0].obligation.id, state.obligationId);
  assert.doesNotMatch(JSON.stringify(body), /SYNTHETIC_PRIVATE|private-payer|enc1:/);
  const forbidden = new Set(["name", "phone", "email", "partiesSnapshot", "signatureEvidence", "payload", "storageKey", "nameEncrypted", "phoneEncrypted", "emailEncrypted", "passwordHash", "platformMfaSecretEncrypted", "token", "codeHash"]);
  const inspect = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); inspect(nested); }
  };
  inspect(body);
  for (const [member, mfa, expected] of [[peer, false, 404], [outsider, true, 404], [finance, false, 403]] as const) {
    const denied = await readPayments(makeRequest(path, { cookie: await cookie(member, mfa) }), params);
    assert.equal(denied.status, expected);
    assert.doesNotMatch(await denied.text(), /SYNTHETIC_PRIVATE|private-payer|enc1:/);
  }
  assert.equal((await readPayments(makeRequest(path), params)).status, 401);
});

test("CPO finance: pre-upgrade ISSUE/SIGN fingerprints replay through parent API without writes; mismatched parents/payloads fail", opts, async () => {
  const state = await draftContract("legacy-replay");
  const other = await fixtures.makeCase(agent, "wrong-parent");
  const ownerCookie = await cookie(agent);
  const issueMeta = meta("legacy-issue");
  const issueBody = { action: "ISSUE", contractVersionId: state.contractVersionId };
  const invoke = (leadId: number, body: unknown, command: ReturnType<typeof meta>) => contractCommand(makeRequest(`/api/agent/cases/${leadId}/contract`, {
    method: "POST", cookie: ownerCookie, body,
    headers: { "Idempotency-Key": command.idempotencyKey, "X-Correlation-Id": command.correlationId },
  }), { params: Promise.resolve({ caseId: String(leadId) }) });
  assert.equal((await invoke(other.leadId, issueBody, issueMeta)).status, 404);
  assert.equal((await db.contractVersion.findUniqueOrThrow({ where: { id: state.contractVersionId } })).status, "DRAFT");
  const issued = await issueContractVersion(agent.context, state.contractVersionId, issueMeta);
  const issueAudit = await db.operationalAuditEvent.findUniqueOrThrow({ where: { organizationId_idempotencyKey: { organizationId: agent.organizationId, idempotencyKey: issueMeta.idempotencyKey } } });
  assert.equal((issueAudit.result as { commandFingerprint: string }).commandFingerprint, commandFingerprint({ contractVersionId: state.contractVersionId, command: "issue" }));
  const issueReplay = await invoke(state.record.leadId, issueBody, issueMeta);
  assert.equal(issueReplay.status, 200);
  assert.deepEqual(await issueReplay.json(), { ...issued, replayed: true });
  assert.equal((await invoke(other.leadId, issueBody, issueMeta)).status, 404);
  await expectStatus(issueContractVersion(agent.context, state.contractVersionId, issueMeta, other.id), 404);

  // The old API passed action:SIGN but had no caseId in its semantic envelope.
  const signBody = { action: "SIGN" as const, ...signature(state.contractVersionId) };
  const signMeta = meta("legacy-sign");
  assert.equal((await invoke(other.leadId, signBody, signMeta)).status, 404);
  assert.equal((await db.contractVersion.findUniqueOrThrow({ where: { id: state.contractVersionId } })).status, "ISSUED");
  const signed = await signContractVersion(agent.context, signBody, signMeta);
  const signAudit = await db.operationalAuditEvent.findUniqueOrThrow({ where: { organizationId_idempotencyKey: { organizationId: agent.organizationId, idempotencyKey: signMeta.idempotencyKey } } });
  assert.equal((signAudit.result as { commandFingerprint: string }).commandFingerprint, commandFingerprint(signBody));
  const counts = await Promise.all([
    db.paymentObligation.count({ where: { contractVersionId: state.contractVersionId } }),
    db.paymentLedgerEntry.count({ where: { obligationId: signed.obligationId } }),
    db.operationalAuditEvent.count({ where: { organizationId: agent.organizationId } }),
  ]);
  const replay = await invoke(state.record.leadId, signBody, signMeta);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { ...signed, replayed: true });
  assert.equal((await invoke(other.leadId, signBody, signMeta)).status, 404);
  await expectStatus(signContractVersion(agent.context, { ...signBody, caseId: other.id }, signMeta), 404);
  assert.equal((await invoke(state.record.leadId, { ...signBody, signatureEvidence: { ...signBody.signatureEvidence, reference: "different-evidence" } }, signMeta)).status, 409);
  assert.deepEqual(await Promise.all([
    db.paymentObligation.count({ where: { contractVersionId: state.contractVersionId } }),
    db.paymentLedgerEntry.count({ where: { obligationId: signed.obligationId } }),
    db.operationalAuditEvent.count({ where: { organizationId: agent.organizationId } }),
  ]), counts);
  assert.deepEqual((await db.operationalAuditEvent.findUniqueOrThrow({ where: { id: signAudit.id } })).result, signAudit.result);
});

test("CPO finance: accepted historical quote stays binding across SUPERSEDED/EXPIRED and newer unaccepted publication", opts, async () => {
  for (const historicalState of ["SUPERSEDED", "EXPIRED"] as const) {
    const state = await signedContract(`historical-${historicalState.toLowerCase()}`, true);
    await recordManualPayment(finance.context, paymentInput(state.obligationId, state.payerId, AMOUNT), meta("historical-payment"));
    // Synthetic history models a published revision without bypassing contract or ledger triggers.
    const newer = await publishedQuote(state.record, AMOUNT * 2, false, state.quote.quoteId);
    await db.quoteVersion.update({ where: { id: state.quote.id }, data: { state: historicalState } });
    const oldContract = await db.contractVersion.findUniqueOrThrow({ where: { id: state.contractVersionId } });
    assert.equal(oldContract.status, "SIGNED");
    const read = await getCanonicalCase(agent.context, state.record.leadId);
    assert.equal(read?.guardState.contract_signed, true);
    assert.equal(read?.guardState.payment_satisfied, true);
    assert.equal(read?.payment.totalKopecks, AMOUNT);
    assert.equal(read?.payment.balanceKopecks, 0);
    const reconciliation = await reconcileM3Case(manager.context, state.record.id);
    assert.equal(reconciliation.discrepancyCount, 0, JSON.stringify(reconciliation.discrepancies));
    assert.equal(reconciliation.paymentStatus, "PAID");
    await expectStatus(createContractVersion(agent.context, { caseId: state.record.id, payerPartyId: state.payerId, paymentTerms: {} }, meta("unaccepted-contract")), 422);
    assert.equal(await db.paymentObligation.count({ where: { caseId: state.record.id } }), 1);
    await acceptFixtureQuote(newer.id);
    const replacement = await createContractVersion(agent.context, { caseId: state.record.id, payerPartyId: state.payerId, paymentTerms: {} }, meta("replacement-create"));
    await issueContractVersion(agent.context, replacement.contractVersionId, meta("replacement-issue"));
    const signed = await signContractVersion(agent.context, signature(replacement.contractVersionId), meta("replacement-sign"));
    assert.equal((await db.contractVersion.findUniqueOrThrow({ where: { id: state.contractVersionId } })).status, "SUPERSEDED");
    const after = await getCanonicalCase(agent.context, state.record.leadId);
    assert.equal(after?.payment.totalKopecks, AMOUNT * 2);
    assert.equal(after?.payment.balanceKopecks, AMOUNT * 2);
    assert.equal(after?.guardState.payment_satisfied, false);
    assert.equal((await getPaymentSummary(finance.context, state.obligationId)).paidKopecks, AMOUNT);
    assert.equal((await reconcileM3Case(manager.context, state.record.id)).discrepancyCount, 0);
    await recordManualPayment(finance.context, paymentInput(signed.obligationId, state.payerId, AMOUNT * 2), meta("replacement-pay"));
    await closeCase(state.record);
  }
});

test("CPO finance: lead creation cannot occupy reserved server command namespaces", opts, async () => {
  const ownerCookie = await cookie(agent);
  const beforeCounts = await Promise.all([
    db.clientLead.count({ where: { agentId: agent.agentId } }),
    db.caseEvent.count({ where: { tenantId: agent.organizationId } }),
  ]);
  for (const idempotencyKey of [serverCommandKey("quote-publish-case", "synthetic-parent"), "webhook:synthetic:event", "document-access:synthetic"]) {
    const response = await createLead(makeRequest("/api/agent/leads", {
      method: "POST", cookie: ownerCookie,
      headers: { "Idempotency-Key": idempotencyKey, "X-Correlation-Id": fixtures.runId },
      body: { name: "Synthetic namespace attempt", phone: "+79160000002", source: "integration" },
    }));
    assert.equal(response.status, 400);
  }
  assert.deepEqual(await Promise.all([
    db.clientLead.count({ where: { agentId: agent.agentId } }),
    db.caseEvent.count({ where: { tenantId: agent.organizationId } }),
  ]), beforeCounts);
});
