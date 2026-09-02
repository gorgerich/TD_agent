import { createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { DocumentScanner } from "../../lib/documentScanner";
import {
  beginDocumentReview,
  decideDocumentReview,
  escalateDocumentReview,
  listDocumentReviewQueue,
  readAuthorizedDocument,
  uploadCaseDocument,
} from "../../lib/documentService";
import {
  createContractVersion,
  decideLedgerAdjustment,
  getPaymentSummary,
  issueContractVersion,
  listFinanceWorkspace,
  processPaymentWebhook,
  recordManualPayment,
  recordRefund,
  requestLedgerAdjustment,
  signContractVersion,
} from "../../lib/contractLedgerService";
import { createCaseParty, listCaseParties, updateCaseParty } from "../../lib/casePartyService";
import {
  listCaseDocumentRequirements,
  materializeCaseRequirements,
} from "../../lib/documentRequirementService";
import { reconcileM3Case } from "../../lib/m3Reconciliation";
import { transitionCase } from "../../lib/caseService";
import { CaseDomainError } from "../../lib/caseDomain";
import { getCanonicalCase } from "../../lib/caseReadModel";
import { OperationalCommandError } from "../../lib/operationalTransaction";
import { decryptFieldStrict, EncryptedDataUnavailableError } from "../../lib/crypto";
import { InMemoryTestStorage } from "../fixtures/testStorage";
import {
  createFixtureContext,
  db,
  skip,
  type FixtureCase,
  type FixtureMember,
} from "./_setup";
import { installM3OrganizationBaseline } from "./_m3Baseline";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };
const fixtures = createFixtureContext("m3-fulfilment");
const storage = new InMemoryTestStorage();
const cleanScanner: DocumentScanner = {
  isOperational: () => true,
  async scan() {
    return { status: "CLEAN", provider: "synthetic-integration", resultCode: "CLEAN" };
  },
};
const infectedScanner: DocumentScanner = {
  isOperational: () => true,
  async scan() {
    return { status: "INFECTED", provider: "synthetic-integration", resultCode: "TEST_SIGNATURE" };
  },
};
const throwingScanner: DocumentScanner = {
  isOperational: () => true,
  async scan() {
    throw new Error("synthetic scanner outage");
  },
};

let agent: FixtureMember;
let manager: FixtureMember;
let reviewerOne: FixtureMember;
let reviewerTwo: FixtureMember;
let financeOne: FixtureMember;
let financeTwo: FixtureMember;
let outsider: FixtureMember;
let outsiderFinance: FixtureMember;
let caseRecord: FixtureCase;
let identityTypeCode: string;
let deathTypeCode: string;
let scenarioTypeCode: string;
let signingPolicyVersion: string;

function meta(label: string) {
  return {
    idempotencyKey: `${fixtures.runId}:${label}`,
    correlationId: `${fixtures.runId}:${label}:correlation`,
    reason: "Synthetic integration verification",
  };
}

async function expectCommandError(
  work: Promise<unknown>,
  status: number,
  message?: RegExp,
) {
  await assert.rejects(work, (error: unknown) => {
    assert.equal(error instanceof OperationalCommandError, true);
    assert.equal((error as OperationalCommandError).status, status);
    if (message) assert.match((error as Error).message, message);
    return true;
  });
}

async function createApprovedScenarioPolicies() {
  const baseline = await installM3OrganizationBaseline(agent.organizationId);
  baseline.policyIds.forEach(fixtures.trackDocumentPolicy);
  baseline.documentTypeIds.forEach(fixtures.trackDocumentType);
  identityTypeCode = baseline.documentTypes.identity;
  deathTypeCode = baseline.documentTypes.death;
  scenarioTypeCode = baseline.documentTypes.cremation;

  signingPolicyVersion = `SYNTHETIC_TEST_ONLY_${fixtures.runId}`;
  const signingPolicy = await db.contractSigningPolicy.create({
    data: {
      organizationId: agent.organizationId,
      version: signingPolicyVersion,
      status: "APPROVED",
      allowedEvidenceTypes: ["SYNTHETIC_TEST_ONLY"],
      source: "SYNTHETIC_TEST_ONLY_NOT_A_LEGAL_VERDICT",
      approvedByUserId: manager.userId,
      approvedAt: new Date(),
      effectiveFrom: new Date(Date.now() - 60_000),
    },
    select: { id: true },
  });
  fixtures.trackSigningPolicy(signingPolicy.id);
}

async function createAcceptedQuote(caseFixture: FixtureCase) {
  const meeting = await db.meeting.create({
    data: {
      leadId: caseFixture.leadId,
      agentId: caseFixture.owner.agentId,
      organizationId: caseFixture.owner.organizationId,
      caseId: caseFixture.id,
      ownerMembershipId: caseFixture.owner.membershipId,
      idempotencyKey: `${fixtures.runId}:${caseFixture.id}:meeting`,
    },
    select: { id: true },
  });
  const quote = await db.quote.create({
    data: {
      meetingId: meeting.id,
      organizationId: caseFixture.owner.organizationId,
      caseId: caseFixture.id,
      ownerMembershipId: caseFixture.owner.membershipId,
      scenario: "CREMATION_V1",
      status: "ACCEPTED",
      currency: "RUB",
    },
    select: { id: true },
  });
  const published = await db.quoteVersion.create({
    data: {
      quoteId: quote.id,
      versionNumber: 1,
      state: "PUBLISHED",
      payload: JSON.stringify({ schemaVersion: 1, total: 17_600_000, synthetic: true }),
      subtotal: 17_600_000,
      discountTotal: 0,
      total: 17_600_000,
      totalState: "KNOWN",
      currency: "RUB",
      snapshotChecksum: "a".repeat(64),
      catalogSourceVersion: "synthetic-integration-v1",
      publishedByMembershipId: caseFixture.owner.membershipId,
      publishedAt: new Date(),
      publishReason: "Synthetic M3 integration",
      publishChannel: "integration",
      idempotencyKey: `${fixtures.runId}:${caseFixture.id}:quote-publish`,
      correlationId: `${fixtures.runId}:${caseFixture.id}:quote-publish:correlation`,
    },
    select: { id: true },
  });
  await db.quote.update({ where: { id: quote.id }, data: { latestPublishedVersionId: published.id } });
  await db.case.update({
    where: { id: caseFixture.id },
    data: { scenarioId: "CREMATION_V1", stage: "CONTRACTING", publishedQuoteVersionId: published.id },
  });
  return published;
}

before(async () => {
  if (skip) return;
  await fixtures.cleanup();
  const organizationId = await fixtures.makeOrganization("primary");
  agent = await fixtures.makeMember("agent", { organizationId, role: "AGENT" });
  manager = await fixtures.makeMember("manager", { organizationId, role: "MANAGER" });
  reviewerOne = await fixtures.makeMember("reviewer-one", { organizationId, role: "DOCUMENT_REVIEWER" });
  reviewerTwo = await fixtures.makeMember("reviewer-two", { organizationId, role: "DOCUMENT_REVIEWER" });
  financeOne = await fixtures.makeMember("finance-one", { organizationId, role: "FINANCE" });
  financeTwo = await fixtures.makeMember("finance-two", { organizationId, role: "FINANCE" });
  outsider = await fixtures.makeMember("outsider", { role: "MANAGER" });
  outsiderFinance = await fixtures.makeMember("outsider-finance", {
    organizationId: outsider.organizationId,
    role: "FINANCE",
  });
  caseRecord = await fixtures.makeCase(agent, "primary");
  await db.case.update({ where: { id: caseRecord.id }, data: { scenarioId: "CREMATION_V1" } });
  await createApprovedScenarioPolicies();
});

after(async () => {
  storage.clear();
  if (!skip) {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M3: parties, versioned documents, immutable obligation and ledger remain tenant-safe", opts, async () => {
  const party = await createCaseParty(agent.context, caseRecord.id, {
    name: "Синтетический заявитель",
    phone: "+70000000000",
    email: "m3-payer@synthetic.invalid",
    roles: ["APPLICANT", "PAYER"],
    preferredChannel: "EMAIL",
    consentStatus: "GRANTED",
    consentSource: "synthetic-test",
    consentAt: new Date(),
    visibilityPolicy: "FINANCE_LIMITED",
  }, meta("party-create"));
  assert.equal(party.replayed, false);
  const partyReplay = await createCaseParty(agent.context, caseRecord.id, {
    name: "Синтетический заявитель",
    phone: "+70000000000",
    email: "m3-payer@synthetic.invalid",
    roles: ["APPLICANT", "PAYER"],
    preferredChannel: "EMAIL",
    consentStatus: "GRANTED",
    consentSource: "synthetic-test",
    consentAt: new Date((await db.caseParty.findUniqueOrThrow({ where: { id: party.partyId } })).consentAt!),
    visibilityPolicy: "FINANCE_LIMITED",
  }, meta("party-create"));
  assert.equal(partyReplay.partyId, party.partyId);
  assert.equal(partyReplay.replayed, true);

  const rawParty = await db.caseParty.findUniqueOrThrow({ where: { id: party.partyId } });
  assert.match(rawParty.nameEncrypted, /^enc1:/);
  assert.match(rawParty.phoneEncrypted ?? "", /^enc1:/);
  assert.match(rawParty.emailEncrypted ?? "", /^enc1:/);
  const updatedConsentAt = new Date(rawParty.consentAt!.getTime() + 60_000);
  await updateCaseParty(agent.context, caseRecord.id, party.partyId, {
    name: "Синтетический заявитель",
    phone: "+70000000000",
    email: "m3-payer@synthetic.invalid",
    roles: ["APPLICANT", "PAYER"],
    preferredChannel: "EMAIL",
    consentStatus: "GRANTED",
    consentSource: "synthetic-reconsent",
    consentAt: updatedConsentAt,
    visibilityPolicy: "FINANCE_LIMITED",
  }, meta("party-update-consent"));
  const consentAudit = await db.operationalAuditEvent.findFirstOrThrow({
    where: {
      organizationId: agent.organizationId,
      entityType: "case_party",
      entityId: party.partyId,
      action: "case_party.updated.v1",
    },
    select: { before: true, after: true },
  });
  const beforeConsent = (consentAudit.before as Record<string, unknown>).consent as Record<string, unknown>;
  const afterConsent = (consentAudit.after as Record<string, unknown>).consent as Record<string, unknown>;
  assert.match(String(beforeConsent.sourceEncrypted), /^enc1:/);
  assert.match(String(afterConsent.sourceEncrypted), /^enc1:/);
  assert.equal(decryptFieldStrict(String(beforeConsent.sourceEncrypted)), "synthetic-test");
  assert.equal(decryptFieldStrict(String(afterConsent.sourceEncrypted)), "synthetic-reconsent");
  assert.equal(beforeConsent.consentAt, rawParty.consentAt!.toISOString());
  assert.equal(afterConsent.consentAt, updatedConsentAt.toISOString());
  const listedParties = await listCaseParties(agent.context, caseRecord.id);
  assert.deepEqual(listedParties[0]?.roles.sort(), ["APPLICANT", "PAYER"]);
  assert.equal((await listCaseParties(outsider.context, caseRecord.id)).length, 0);
  const previousEncryptionKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "synthetic-wrong-key-for-case-party-read";
  try {
    await assert.rejects(
      listCaseParties(agent.context, caseRecord.id),
      EncryptedDataUnavailableError,
    );
  } finally {
    if (previousEncryptionKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previousEncryptionKey;
  }

  const materialized = await materializeCaseRequirements(agent.context, caseRecord.id, meta("requirements"));
  assert.equal(materialized.policyApproved, true);
  assert.equal(materialized.created, 3);
  const requirements = await listCaseDocumentRequirements(agent.context, caseRecord.id);
  assert.equal(requirements.length, 3);
  assert.equal(requirements.every((item) => item.derivedSatisfactionStatus === "NOT_SATISFIED"), true);
  assert.equal(requirements.every((item) => item.ownerRole === "DOCUMENT_REVIEWER"), true);
  assert.equal(requirements.every((item) => item.reviewChecklist.length > 0), true);
  const materializedRule = await db.caseDocumentRequirement.findFirstOrThrow({
    where: { caseId: caseRecord.id },
    select: { ruleId: true, policyId: true },
  });
  await assert.rejects(
    db.documentRequirementRule.update({
      where: { id: materializedRule.ruleId },
      data: { source: "forbidden mutable rule" },
    }),
    /immutable|new policy version/i,
  );
  await assert.rejects(
    db.documentRequirementPolicy.update({
      where: { id: materializedRule.policyId },
      data: { source: "forbidden mutable policy" },
    }),
    /immutable/i,
  );
  const identityRequirement = requirements.find((item) => item.acceptedDocumentTypeCodes.includes(identityTypeCode));
  const deathRequirement = requirements.find((item) => item.acceptedDocumentTypeCodes.includes(deathTypeCode));
  const scenarioRequirement = requirements.find((item) => item.acceptedDocumentTypeCodes.includes(scenarioTypeCode));
  assert.ok(identityRequirement);
  assert.ok(deathRequirement);
  assert.ok(scenarioRequirement);

  const pinnedIdentityType = await db.documentTypeDefinition.findFirstOrThrow({
    where: { organizationId: agent.organizationId, code: identityTypeCode, version: 1 },
    select: { id: true, name: true, source: true },
  });
  await db.documentTypeDefinition.update({ where: { id: pinnedIdentityType.id }, data: { status: "RETIRED" } });
  const laterIdentityType = await db.documentTypeDefinition.create({
    data: {
      organizationId: agent.organizationId,
      code: identityTypeCode,
      version: 2,
      name: `${pinnedIdentityType.name} later policy`,
      allowedMimeTypes: ["image/png"],
      maxBytes: 64,
      status: "APPROVED",
      source: pinnedIdentityType.source,
    },
    select: { id: true },
  });
  fixtures.trackDocumentType(laterIdentityType.id);

  const identityUpload = await uploadCaseDocument(agent.context, {
    caseId: caseRecord.id,
    requirementId: identityRequirement.id,
    documentTypeCode: identityTypeCode,
    file: new File(["synthetic identity"], "identity.pdf", { type: "application/pdf" }),
  }, meta("identity-upload"), { storage, scanner: cleanScanner });
  assert.equal(identityUpload.status, "UPLOADED");
  assert.equal(identityUpload.scanStatus, "CLEAN");
  assert.equal((await db.caseDocument.findUniqueOrThrow({
    where: { requirementId: identityRequirement.id },
    select: { documentTypeId: true },
  })).documentTypeId, pinnedIdentityType.id);
  assert.equal((await db.caseDocumentRequirement.findUniqueOrThrow({ where: { id: identityRequirement.id } })).satisfactionStatus, "NOT_SATISFIED");

  const queue = await listDocumentReviewQueue(reviewerOne.context);
  const queueJson = JSON.stringify(queue);
  assert.equal(queue.some((item) => item.id === identityUpload.versionId), true);
  assert.equal(queueJson.includes("nameEncrypted"), false);
  assert.equal(queueJson.includes("phoneEncrypted"), false);
  assert.equal(queueJson.includes("payment"), false);
  await beginDocumentReview(reviewerOne.context, identityUpload.versionId, meta("identity-review-start"));
  const escalation = await escalateDocumentReview(
    reviewerOne.context,
    identityUpload.versionId,
    "Нужна сверка основания до истечения срока",
    meta("identity-review-escalation"),
  );
  assert.equal(escalation.replayed, false);
  const escalationReplay = await escalateDocumentReview(
    reviewerOne.context,
    identityUpload.versionId,
    "Нужна сверка основания до истечения срока",
    meta("identity-review-escalation"),
  );
  assert.equal(escalationReplay.replayed, true);
  assert.equal(escalationReplay.taskId, escalation.taskId);
  assert.equal(await db.task.count({ where: { id: escalation.taskId } }), 1);
  await expectCommandError(escalateDocumentReview(
    reviewerOne.context,
    identityUpload.versionId,
    "Другой payload для того же ключа",
    meta("identity-review-escalation"),
  ), 409);
  await expectCommandError(
    beginDocumentReview(reviewerTwo.context, identityUpload.versionId, meta("identity-review-race")),
    409,
  );
  await expectCommandError(
    decideDocumentReview(reviewerTwo.context, identityUpload.versionId, {
      decision: "VERIFIED",
      checklist: { "identity-match": true },
    }, meta("identity-review-wrong-reviewer"), storage),
    404,
  );

  const deathUpload = await uploadCaseDocument(agent.context, {
    caseId: caseRecord.id,
    requirementId: deathRequirement.id,
    documentTypeCode: deathTypeCode,
    file: new File(["synthetic death record"], "death-record.pdf", { type: "application/pdf" }),
  }, meta("death-upload"), { storage, scanner: cleanScanner });
  await beginDocumentReview(reviewerOne.context, deathUpload.versionId, meta("death-review-start"));
  await decideDocumentReview(reviewerOne.context, deathUpload.versionId, {
    decision: "VERIFIED",
    checklist: { "death-record-match": true },
  }, meta("death-review-decision"), storage);
  const authorizedRead = await readAuthorizedDocument(
    reviewerOne.context,
    identityUpload.versionId,
    caseRecord.id,
    "VIEW",
    `${fixtures.runId}:identity-read`,
    storage,
  );
  assert.equal(authorizedRead.mimeType, "application/pdf");
  assert.equal(authorizedRead.filename.includes("identity.pdf"), false);
  const accessEvent = await db.documentAccessEvent.findFirstOrThrow({
    where: { documentVersionId: identityUpload.versionId },
    select: { purpose: true },
  });
  assert.equal(accessEvent.purpose, "Проверка назначенной версии документа");
  const storedIdentity = await db.caseDocumentVersion.findUniqueOrThrow({
    where: { id: identityUpload.versionId },
    select: { storageKey: true },
  });
  storage.replaceBytes(storedIdentity.storageKey, new TextEncoder().encode("tampered synthetic bytes"));
  await expectCommandError(
    readAuthorizedDocument(
      reviewerOne.context,
      identityUpload.versionId,
      caseRecord.id,
      "VIEW",
      `${fixtures.runId}:identity-tampered-read`,
      storage,
    ),
    409,
    /Целостность/,
  );
  assert.equal(await db.documentAccessEvent.count({ where: { documentVersionId: identityUpload.versionId } }), 1);
  await expectCommandError(
    decideDocumentReview(reviewerOne.context, identityUpload.versionId, {
      decision: "VERIFIED",
      checklist: { "identity-match": true },
    }, meta("identity-tampered-review"), storage),
    409,
    /Целостность/,
  );
  assert.equal(
    (await db.caseDocumentRequirement.findUniqueOrThrow({ where: { id: identityRequirement.id } })).satisfactionStatus,
    "NOT_SATISFIED",
  );
  await expectCommandError(
    readAuthorizedDocument(
      reviewerTwo.context,
      identityUpload.versionId,
      caseRecord.id,
      "VIEW",
      `${fixtures.runId}:cross-assignee-read`,
      storage,
    ),
    404,
  );
  await expectCommandError(
    readAuthorizedDocument(
      outsider.context,
      identityUpload.versionId,
      caseRecord.id,
      "VIEW",
      `${fixtures.runId}:cross-tenant-read`,
      storage,
    ),
    404,
  );
  storage.replaceBytes(storedIdentity.storageKey, new TextEncoder().encode("synthetic identity"));
  await decideDocumentReview(reviewerOne.context, identityUpload.versionId, {
    decision: "VERIFIED",
    checklist: { "identity-match": true },
  }, meta("identity-review-decision"), storage);
  await expectCommandError(
    readAuthorizedDocument(
      reviewerOne.context,
      identityUpload.versionId,
      caseRecord.id,
      "VIEW",
      `${fixtures.runId}:historical-reviewer-read`,
      storage,
    ),
    404,
  );

  const infected = await uploadCaseDocument(agent.context, {
    caseId: caseRecord.id,
    requirementId: scenarioRequirement.id,
    documentTypeCode: scenarioTypeCode,
    file: new File(["synthetic infected marker"], "scenario.pdf", { type: "application/pdf" }),
  }, meta("scenario-infected"), { storage, scanner: infectedScanner });
  assert.equal(infected.status, "QUARANTINED");
  assert.equal(infected.scanStatus, "INFECTED");
  await expectCommandError(
    beginDocumentReview(reviewerOne.context, infected.versionId, meta("scenario-infected-review")),
    409,
  );
  const scanFailure = await uploadCaseDocument(agent.context, {
    caseId: caseRecord.id,
    requirementId: scenarioRequirement.id,
    documentTypeCode: scenarioTypeCode,
    file: new File(["synthetic scanner failure"], "scan-failure.pdf", { type: "application/pdf" }),
  }, meta("scenario-scan-failure"), { storage, scanner: throwingScanner });
  assert.equal(scanFailure.status, "QUARANTINED");
  assert.equal(scanFailure.scanStatus, "ERROR");
  const replacement = await uploadCaseDocument(agent.context, {
    caseId: caseRecord.id,
    requirementId: scenarioRequirement.id,
    documentTypeCode: scenarioTypeCode,
    file: new File(["synthetic clean replacement"], "replacement.pdf", { type: "application/pdf" }),
  }, meta("scenario-replacement"), { storage, scanner: cleanScanner });
  assert.equal(replacement.versionNumber, 3);
  assert.equal((await db.caseDocumentVersion.findUniqueOrThrow({ where: { id: infected.versionId } })).status, "SUPERSEDED");
  assert.equal(await db.operationalAuditEvent.count({
    where: {
      entityType: "document_version",
      entityId: { in: [infected.versionId, scanFailure.versionId] },
      action: "document.version_superseded.v1",
    },
  }), 2);
  await beginDocumentReview(reviewerOne.context, replacement.versionId, meta("scenario-review-start"));

  const published = await createAcceptedQuote(caseRecord);
  await assert.rejects(
    db.quoteVersion.update({ where: { id: published.id }, data: { total: 1 } }),
    /immutable|published/i,
  );
  const contract = await createContractVersion(agent.context, {
    caseId: caseRecord.id,
    payerPartyId: party.partyId,
    paymentTerms: { mode: "synthetic-manual-pilot" },
    validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }, meta("contract-create"));
  assert.equal(contract.status, "DRAFT");
  assert.equal((await createContractVersion(agent.context, {
    caseId: caseRecord.id,
    payerPartyId: party.partyId,
    paymentTerms: { mode: "synthetic-manual-pilot" },
    validUntil: new Date((await db.contractVersion.findUniqueOrThrow({ where: { id: contract.contractVersionId } })).validUntil!),
  }, meta("contract-create"))).replayed, true);
  await issueContractVersion(agent.context, contract.contractVersionId, meta("contract-issue"));
  await expectCommandError(signContractVersion(agent.context, {
    contractVersionId: contract.contractVersionId,
    signatureEvidence: { type: "SYNTHETIC_TEST_ONLY", reference: "synthetic-evidence-reference" },
    signaturePolicyVersion: "CLIENT_CANNOT_SELF_APPROVE",
  }, meta("contract-sign-unapproved")), 422, /Legal/);
  const signed = await signContractVersion(agent.context, {
    contractVersionId: contract.contractVersionId,
    signatureEvidence: { type: "SYNTHETIC_TEST_ONLY", reference: "synthetic-evidence-reference" },
    signaturePolicyVersion: signingPolicyVersion,
  }, meta("contract-sign"));
  const signedReplay = await signContractVersion(agent.context, {
    contractVersionId: contract.contractVersionId,
    signatureEvidence: { type: "SYNTHETIC_TEST_ONLY", reference: "synthetic-evidence-reference" },
    signaturePolicyVersion: signingPolicyVersion,
  }, meta("contract-sign"));
  assert.equal(signedReplay.replayed, true);
  assert.equal(signedReplay.contractVersionId, signed.contractVersionId);
  assert.equal(signedReplay.obligationId, signed.obligationId);
  assert.equal(signedReplay.ledgerEntryId, signed.ledgerEntryId);
  assert.equal(await db.paymentObligation.count({ where: { contractVersionId: contract.contractVersionId } }), 1);
  assert.equal(await db.paymentLedgerEntry.count({
    where: { obligationId: signed.obligationId, type: "OBLIGATION" },
  }), 1);
  await db.contractSigningPolicy.update({
    where: {
      organizationId_version: {
        organizationId: agent.organizationId,
        version: signingPolicyVersion,
      },
    },
    data: { status: "RETIRED", retiredAt: new Date() },
  });
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: caseRecord.id } })).stage, "PAYMENT");
  assert.equal(await db.caseEvent.count({
    where: { caseId: caseRecord.id, eventType: "contract.signed.v1" },
  }), 1);
  const directLedgerData = {
    caseId: caseRecord.id,
    obligationId: signed.obligationId,
    payerPartyId: party.partyId,
    type: "PAYMENT" as const,
    direction: "CREDIT" as const,
    amountKopecks: 100,
    currency: "RUB",
    occurredAt: new Date("2026-08-11T11:59:00Z"),
    method: "BANK_TRANSFER" as const,
    source: "manual-finance",
    evidenceReference: "synthetic-direct-write-denial",
    actorMembershipId: financeOne.membershipId,
    correlationId: `${fixtures.runId}:direct-ledger-denial`,
  };
  await assert.rejects(db.paymentLedgerEntry.create({
    data: {
      ...directLedgerData,
      organizationId: agent.organizationId,
      idempotencyKey: `${fixtures.runId}:direct-ledger-without-authorization`,
    },
  }), /canonical authorization evidence/i);
  await assert.rejects(db.paymentLedgerEntry.create({
    data: {
      ...directLedgerData,
      organizationId: outsider.organizationId,
      idempotencyKey: `${fixtures.runId}:direct-ledger-cross-tenant`,
    },
  }), /tenant-scoped obligation/i);

  const halfPaymentInput = {
    obligationId: signed.obligationId,
    payerPartyId: party.partyId,
    amountKopecks: 8_800_000,
    currency: "RUB",
    occurredAt: new Date("2026-08-11T12:00:00Z"),
    method: "BANK_TRANSFER",
    evidenceReference: "synthetic-bank-evidence",
    reason: "Synthetic partial payment",
  } as const;
  const concurrentHalfPayments = await Promise.all(Array.from(
    { length: 5 },
    () => recordManualPayment(financeOne.context, halfPaymentInput, meta("payment-half")),
  ));
  assert.equal(concurrentHalfPayments.filter((result) => !result.replayed).length, 1);
  assert.equal(concurrentHalfPayments.filter((result) => result.replayed).length, 4);
  assert.equal(new Set(concurrentHalfPayments.map((result) => result.ledgerEntryId)).size, 1);
  assert.equal(await db.paymentLedgerEntry.count({
    where: { obligationId: signed.obligationId, type: "PAYMENT", idempotencyKey: meta("payment-half").idempotencyKey },
  }), 1);
  const half = concurrentHalfPayments[0];
  assert.equal(half.summary.status, "PARTIALLY_PAID");
  assert.equal(half.summary.paidKopecks, 8_800_000);
  assert.equal(half.summary.balanceKopecks, 8_800_000);
  const halfReplay = await recordManualPayment(financeOne.context, halfPaymentInput, meta("payment-half"));
  assert.equal(halfReplay.replayed, true);
  assert.equal(halfReplay.ledgerEntryId, half.ledgerEntryId);
  await expectCommandError(recordManualPayment(financeOne.context, {
    obligationId: signed.obligationId,
    payerPartyId: party.partyId,
    amountKopecks: 8_700_000,
    currency: "RUB",
    occurredAt: new Date("2026-08-11T12:00:00Z"),
    method: "BANK_TRANSFER",
    evidenceReference: "synthetic-bank-evidence",
    reason: "Changed payload",
  }, meta("payment-half")), 409);

  const previousSecret = process.env.M3_PAYMENT_WEBHOOK_SECRET;
  const webhookSecret = `${fixtures.runId}:webhook-secret`;
  process.env.M3_PAYMENT_WEBHOOK_SECRET = webhookSecret;
  try {
    const command = {
      organizationId: agent.organizationId,
      caseId: caseRecord.id,
      obligationId: signed.obligationId,
      payerPartyId: party.partyId,
      externalEventId: `${fixtures.runId}:payment-event`,
      eventVersion: "1",
      externalTransactionId: `${fixtures.runId}:transaction`,
      amountKopecks: 8_800_000,
      currency: "RUB",
      occurredAt: "2026-08-11T12:30:00.000Z",
      method: "BANK_TRANSFER" as const,
      evidenceReference: "synthetic-provider-receipt",
    };
    const rawBody = JSON.stringify(command);
    const signature = `sha256=${createHmac("sha256", webhookSecret).update(`synthetic.${rawBody}`).digest("hex")}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => processPaymentWebhook("synthetic", rawBody, signature, command)),
    );
    assert.equal(new Set(results.map((result) => result.ledgerEntryId)).size, 1);
    assert.equal(results.filter((result) => !result.replayed).length, 1);
    assert.equal(results.filter((result) => result.replayed).length, 4);
  } finally {
    if (previousSecret === undefined) delete process.env.M3_PAYMENT_WEBHOOK_SECRET;
    else process.env.M3_PAYMENT_WEBHOOK_SECRET = previousSecret;
  }
  const paid = await getPaymentSummary(financeOne.context, signed.obligationId);
  assert.equal(paid.status, "PAID");
  assert.equal(paid.balanceKopecks, 0);
  assert.equal(await db.paymentLedgerEntry.count({ where: { obligationId: signed.obligationId, type: "PAYMENT" } }), 2);
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: caseRecord.id } })).stage, "PAYMENT");
  await expectCommandError(getPaymentSummary(outsider.context, signed.obligationId), 404);

  const financialPolicy = await db.financialControlPolicy.create({
    data: {
      organizationId: agent.organizationId,
      version: 1,
      status: "APPROVED",
      correctionThresholdKopecks: 1,
      source: "SYNTHETIC_TEST_ONLY_NOT_A_FINANCE_VERDICT",
      approvedAt: new Date(),
    },
  });
  const pendingBeforeExecution = await requestLedgerAdjustment(financeOne.context, {
    type: "REVERSAL",
    relatedEntryId: half.ledgerEntryId,
    direction: "DEBIT",
    amountKopecks: 1,
    occurredAt: new Date("2026-08-11T12:45:00Z"),
    evidenceReference: "synthetic-pre-execution-adjustment",
    reason: "Prove pending four-eyes adjustment blocks stage advancement",
  }, meta("pending-before-execution"));
  assert.equal(pendingBeforeExecution.approvalRequired, true);
  await expectCommandError(recordRefund(financeOne.context, {
    paymentEntryId: half.ledgerEntryId,
    amountKopecks: 8_800_000,
    occurredAt: new Date("2026-08-11T12:46:00Z"),
    method: "BANK_TRANSFER",
    evidenceReference: "synthetic-mixed-capacity-refund",
    reason: "Pending adjustment and refund must share one source capacity",
  }, meta("mixed-capacity-refund")), 422, /исходной записи/);

  await assert.rejects(
    transitionCase({
      leadId: caseRecord.leadId,
      eventType: "payment.requirement_satisfied.v1",
      context: {
        organizationId: agent.organizationId,
        membershipId: agent.membershipId,
        agentId: agent.agentId,
        actorId: agent.userId,
        idempotencyKey: `${fixtures.runId}:stage-before-docs`,
        correlationId: `${fixtures.runId}:stage-before-docs:correlation`,
      },
    }),
    (error: unknown) => error instanceof CaseDomainError && error.code === "GUARD_FAILED",
  );
  await decideDocumentReview(reviewerOne.context, replacement.versionId, {
    decision: "VERIFIED",
    checklist: { "scenario-evidence": true },
  }, meta("scenario-review-decision"), storage);
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: caseRecord.id } })).stage, "PAYMENT");
  assert.equal((await getCanonicalCase(manager.context, caseRecord.leadId))?.guardState.payment_satisfied, false);
  assert.equal(await db.caseEvent.count({
    where: { caseId: caseRecord.id, eventType: "payment.requirement_satisfied.v1" },
  }), 0);
  await decideLedgerAdjustment(financeTwo.context, {
    ledgerEntryId: pendingBeforeExecution.ledgerEntryId,
    decision: "REJECTED",
    reason: "Synthetic pending-gate verification complete",
  }, meta("pending-before-execution-reject"));
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: caseRecord.id } })).stage, "EXECUTION");
  assert.equal(await db.caseEvent.count({
    where: { caseId: caseRecord.id, eventType: "payment.requirement_satisfied.v1" },
  }), 1);

  await assert.rejects(
    db.paymentLedgerEntry.update({ where: { id: half.ledgerEntryId }, data: { amountKopecks: 1 } }),
    /append-only|immutable/i,
  );
  await assert.rejects(
    db.paymentLedgerEntry.delete({ where: { id: half.ledgerEntryId } }),
    /append-only|immutable/i,
  );
  await assert.rejects(
    db.caseDocumentVersion.update({ where: { id: identityUpload.versionId }, data: { fileChecksum: "d".repeat(64) } }),
    /immutable/i,
  );
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('td_agent.m3_document_transition', 'review-decision', true)`;
      await tx.caseDocumentVersion.update({
        where: { id: identityUpload.versionId },
        data: { status: "REJECTED", rejectionReason: "forged" },
      });
    }),
    /lifecycle transition requires canonical command/i,
  );
  const immutableAudit = await db.operationalAuditEvent.findFirstOrThrow({
    where: { organizationId: agent.organizationId, action: "m3.lifecycle_transition_authorized.v1" },
    select: { id: true },
  });
  await assert.rejects(db.operationalAuditEvent.delete({ where: { id: immutableAudit.id } }), /append-only/i);
  await assert.rejects(
    db.caseDocumentVersion.delete({ where: { id: identityUpload.versionId } }),
    /cannot be deleted|history/i,
  );
  await assert.rejects(
    db.contractVersion.update({ where: { id: contract.contractVersionId }, data: { totalObligationKopecks: 1 } }),
    /immutable/i,
  );
  await assert.rejects(
    db.contractVersion.update({
      where: { id: contract.contractVersionId },
      data: { signatureEvidence: { type: "tampered", reference: "tampered" } },
    }),
    /signed proof|immutable/i,
  );
  await assert.rejects(
    db.contractVersion.update({ where: { id: contract.contractVersionId }, data: { status: "DRAFT" } }),
    /lifecycle transition requires canonical command/i,
  );
  await assert.rejects(
    db.paymentObligation.update({ where: { id: signed.obligationId }, data: { amountKopecks: 1 } }),
    /immutable/i,
  );
  const refundInput = {
    paymentEntryId: half.ledgerEntryId,
    amountKopecks: 8_800_000,
    occurredAt: new Date("2026-08-11T13:00:00Z"),
    method: "BANK_TRANSFER",
    evidenceReference: "synthetic-refund-evidence",
    reason: "Synthetic refund",
  } as const;
  const refunds = await Promise.all(Array.from({ length: 5 }, () => (
    recordRefund(financeOne.context, refundInput, meta("refund"))
  )));
  assert.equal(refunds.filter((result) => !result.replayed).length, 1);
  assert.equal(refunds.filter((result) => result.replayed).length, 4);
  assert.equal(new Set(refunds.map((result) => result.ledgerEntryId)).size, 1);
  const refund = refunds.find((result) => !result.replayed)!;
  assert.equal(refund.summary.status, "PARTIALLY_REFUNDED");
  assert.equal(await db.paymentLedgerEntry.count({
    where: { idempotencyKey: meta("refund").idempotencyKey, organizationId: financeOne.organizationId },
  }), 1);
  await expectCommandError(recordRefund(financeOne.context, {
    ...refundInput,
    amountKopecks: refundInput.amountKopecks - 1,
  }, meta("refund")), 409, /другой командой/);
  assert.equal(await db.paymentLedgerEntry.count({ where: { id: half.ledgerEntryId } }), 1);

  const adjustment = await requestLedgerAdjustment(financeOne.context, {
    type: "REVERSAL",
    relatedEntryId: refund.ledgerEntryId,
    direction: "CREDIT",
    amountKopecks: 8_800_000,
    occurredAt: new Date("2026-08-11T13:30:00Z"),
    evidenceReference: "synthetic-reversal-evidence",
    reason: "Synthetic four-eyes reversal",
  }, meta("adjustment"));
  assert.equal(adjustment.approvalRequired, true);
  await expectCommandError(requestLedgerAdjustment(financeOne.context, {
    type: "REVERSAL",
    relatedEntryId: refund.ledgerEntryId,
    direction: "CREDIT",
    amountKopecks: 1,
    occurredAt: new Date("2026-08-11T13:31:00Z"),
    evidenceReference: "synthetic-over-source-adjustment",
    reason: "Synthetic cumulative source-capacity guard",
  }, meta("adjustment-over-source")), 422, /исходной записи/);
  await expectCommandError(decideLedgerAdjustment(financeOne.context, {
    ledgerEntryId: adjustment.ledgerEntryId,
    decision: "APPROVED",
    reason: "Self approval forbidden",
  }, meta("adjustment-self-approve")), 403);
  const decisions = await Promise.allSettled([
    decideLedgerAdjustment(financeTwo.context, {
      ledgerEntryId: adjustment.ledgerEntryId,
      decision: "APPROVED",
      reason: "Independent synthetic approval",
    }, meta("adjustment-approve-a")),
    decideLedgerAdjustment(financeTwo.context, {
      ledgerEntryId: adjustment.ledgerEntryId,
      decision: "APPROVED",
      reason: "Concurrent duplicate approval",
    }, meta("adjustment-approve-b")),
  ]);
  assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(decisions.filter((result) => result.status === "rejected").length, 1);
  await expectCommandError(requestLedgerAdjustment(financeOne.context, {
    type: "CORRECTION",
    relatedEntryId: adjustment.ledgerEntryId,
    direction: "CREDIT",
    amountKopecks: 1,
    occurredAt: new Date("2026-08-11T13:35:00Z"),
    evidenceReference: "synthetic-nested-ancestor-overflow",
    reason: "Nested reservation must preserve every immutable ancestor",
  }, meta("nested-ancestor-overflow")), 422, /исходной записи/);

  const secondRefund = await recordRefund(financeOne.context, {
    paymentEntryId: half.ledgerEntryId,
    amountKopecks: 100_000,
    occurredAt: new Date("2026-08-11T13:40:00Z"),
    method: "BANK_TRANSFER",
    evidenceReference: "synthetic-second-refund-evidence",
    reason: "Prove approved reversal reopens original payment capacity",
  }, meta("second-refund"));
  const secondReversal = await requestLedgerAdjustment(financeOne.context, {
    type: "REVERSAL",
    relatedEntryId: secondRefund.ledgerEntryId,
    direction: "CREDIT",
    amountKopecks: 100_000,
    occurredAt: new Date("2026-08-11T13:45:00Z"),
    evidenceReference: "synthetic-second-reversal-evidence",
    reason: "Restore synthetic second refund",
  }, meta("second-reversal"));
  await db.financialControlPolicy.update({
    where: { id: financialPolicy.id },
    data: { status: "RETIRED" },
  });
  const retiredPolicyDecision = await decideLedgerAdjustment(financeTwo.context, {
    ledgerEntryId: secondReversal.ledgerEntryId,
    decision: "APPROVED",
    reason: "Approve in-flight adjustment under its immutable retired policy snapshot",
  }, meta("second-reversal-approve"));
  assert.equal(retiredPolicyDecision.decision, "APPROVED");
  const terminalApproval = await db.paymentLedgerApproval.findUniqueOrThrow({
    where: { ledgerEntryId: secondReversal.ledgerEntryId },
  });
  await assert.rejects(
    db.paymentLedgerApproval.update({
      where: { id: terminalApproval.id },
      data: { decisionReason: "forbidden rewrite" },
    }),
    /terminal decision is immutable/i,
  );
  await assert.rejects(
    db.paymentLedgerApproval.delete({ where: { id: terminalApproval.id } }),
    /history cannot be deleted/i,
  );

  const restoredSummary = await getPaymentSummary(financeOne.context, signed.obligationId);
  assert.equal(restoredSummary.status, "PAID");
  assert.equal(restoredSummary.refundedKopecks, 0);
  assert.equal(restoredSummary.balanceKopecks, 0);
  assert.equal(await db.paymentLedgerEntry.count({
    where: {
      id: {
        in: [
          half.ledgerEntryId,
          refund.ledgerEntryId,
          adjustment.ledgerEntryId,
          secondRefund.ledgerEntryId,
          secondReversal.ledgerEntryId,
        ],
      },
    },
  }), 5);

  const canonicalReadModel = await getCanonicalCase(manager.context, caseRecord.leadId);
  assert.deepEqual(canonicalReadModel?.documents, {
    uploaded: 3,
    required: 3,
    verified: 3,
    ready: true,
  });
  assert.deepEqual(canonicalReadModel?.payment, {
    totalKopecks: 17_600_000,
    paidKopecks: 17_600_000,
    balanceKopecks: 0,
  });

  const financeView = await listFinanceWorkspace(financeOne.context);
  const financeJson = JSON.stringify(financeView);
  assert.equal(financeView.obligations.some((item) => item.id === signed.obligationId), true);
  assert.equal(financeJson.includes("nameEncrypted"), false);
  assert.equal(financeJson.includes("phoneEncrypted"), false);
  assert.equal(financeJson.includes("document"), false);
  assert.equal((await listFinanceWorkspace(outsiderFinance.context)).obligations.length, 0);

  const caseCommandContext = (label: string) => ({
    organizationId: agent.organizationId,
    membershipId: agent.membershipId,
    agentId: agent.agentId,
    actorId: agent.userId,
    idempotencyKey: `${fixtures.runId}:${label}`,
    correlationId: `${fixtures.runId}:${label}:correlation`,
  });
  await assert.rejects(
    transitionCase({
      leadId: caseRecord.leadId,
      eventType: "case.closure_requested.v1",
      context: caseCommandContext("closure-before-execution-confirmation"),
    }),
    (error: unknown) => error instanceof CaseDomainError
      && error.code === "GUARD_FAILED"
      && Array.isArray(error.details.missing)
      && error.details.missing.includes("crematorium_confirmed"),
  );
  const executionConfirmation = await transitionCase({
    leadId: caseRecord.leadId,
    eventType: "execution.confirmed.v1",
    payload: { confirmationSource: "OPERATOR_CONFIRMED" },
    context: caseCommandContext("execution-confirmed"),
  });
  assert.equal(executionConfirmation.stage, "EXECUTION");
  const parityTarget = await db.caseDocumentRequirement.findFirstOrThrow({
    where: { caseId: caseRecord.id },
    select: { id: true, sourceRule: true },
  });
  await db.caseDocumentRequirement.update({
    where: { id: parityTarget.id },
    data: { sourceRule: "synthetic-stale-materialized-rule" },
  });
  const parityDrift = await reconcileM3Case(manager.context, caseRecord.id);
  assert.equal(
    parityDrift.discrepancies.some((item) => item.code === "DOCUMENT_REQUIREMENT_POLICY_PARITY_MISMATCH"),
    true,
  );
  await assert.rejects(
    transitionCase({
      leadId: caseRecord.leadId,
      eventType: "case.closure_requested.v1",
      context: caseCommandContext("closure-with-stale-materialization"),
    }),
    (error: unknown) => error instanceof CaseDomainError
      && error.code === "GUARD_FAILED"
      && Array.isArray(error.details.missing)
      && error.details.missing.includes("identity_verified"),
  );
  await db.caseDocumentRequirement.update({
    where: { id: parityTarget.id },
    data: { sourceRule: parityTarget.sourceRule },
  });
  const closed = await transitionCase({
    leadId: caseRecord.leadId,
    eventType: "case.closure_requested.v1",
    context: caseCommandContext("closure-after-execution-confirmation"),
  });
  assert.equal(closed.stage, "CLOSED");
  assert.equal(await db.caseEvent.count({
    where: { caseId: caseRecord.id, eventType: "execution.confirmed.v1" },
  }), 1);
  assert.equal(await db.caseEvent.count({
    where: { caseId: caseRecord.id, eventType: "case.closure_requested.v1" },
  }), 1);

  const reconciliation = await reconcileM3Case(manager.context, caseRecord.id);
  assert.equal(reconciliation.discrepancyCount, 0, JSON.stringify(reconciliation.discrepancies));
  assert.equal(await db.paymentWebhookReceipt.count({ where: { organizationId: agent.organizationId } }), 1);
  assert.equal(await db.paymentLedgerApproval.count({ where: { organizationId: agent.organizationId } }), 3);
});

test("M3: contract signing cannot bind a policy retired by a concurrent activation boundary", opts, async () => {
  const raceCase = await fixtures.makeCase(agent, "signing-policy-race");
  await db.case.update({ where: { id: raceCase.id }, data: { scenarioId: "CREMATION_V1" } });
  await createAcceptedQuote(raceCase);
  const payer = await createCaseParty(agent.context, raceCase.id, {
    name: "Синтетический плательщик гонки",
    roles: ["PAYER"],
    preferredChannel: "EMAIL",
    consentStatus: "NOT_REQUESTED",
    visibilityPolicy: "FINANCE_LIMITED",
  }, meta("signing-policy-race-party"));
  const racePolicyVersion = `SYNTHETIC_SIGNING_RACE_${fixtures.runId}`;
  const racePolicy = await db.contractSigningPolicy.create({
    data: {
      organizationId: agent.organizationId,
      version: racePolicyVersion,
      status: "APPROVED",
      allowedEvidenceTypes: ["SYNTHETIC_TEST_ONLY"],
      source: "SYNTHETIC_TEST_ONLY_NOT_A_LEGAL_VERDICT",
      approvedByUserId: manager.userId,
      approvedAt: new Date(),
      effectiveFrom: new Date(Date.now() - 60_000),
    },
    select: { id: true },
  });
  fixtures.trackSigningPolicy(racePolicy.id);
  const contract = await createContractVersion(agent.context, {
    caseId: raceCase.id,
    payerPartyId: payer.partyId,
    paymentTerms: { mode: "synthetic-policy-race" },
    validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }, meta("signing-policy-race-contract"));
  await issueContractVersion(agent.context, contract.contractVersionId, meta("signing-policy-race-issue"));

  let reportOrganizationLocked!: () => void;
  let releaseRetirement!: () => void;
  const organizationLocked = new Promise<void>((resolve) => { reportOrganizationLocked = resolve; });
  const mayRetire = new Promise<void>((resolve) => { releaseRetirement = resolve; });
  const retirement = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${agent.organizationId} FOR UPDATE`;
    reportOrganizationLocked();
    await mayRetire;
    await tx.contractSigningPolicy.update({
      where: { id: racePolicy.id },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
  });
  await organizationLocked;
  const signingRejected = expectCommandError(signContractVersion(agent.context, {
    contractVersionId: contract.contractVersionId,
    signatureEvidence: { type: "SYNTHETIC_TEST_ONLY", reference: "synthetic-policy-race-evidence" },
    signaturePolicyVersion: racePolicyVersion,
  }, meta("signing-policy-race-sign")), 422, /Legal/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  releaseRetirement();
  await retirement;
  await signingRejected;
  assert.equal((await db.contractVersion.findUniqueOrThrow({
    where: { id: contract.contractVersionId },
    select: { status: true },
  })).status, "ISSUED");
  assert.equal(await db.paymentObligation.count({
    where: { contractVersionId: contract.contractVersionId },
  }), 0);
  assert.equal(await db.operationalAuditEvent.count({
    where: { entityType: "contract_version", entityId: contract.contractVersionId, action: "contract.signed.v1" },
  }), 0);
});

test("M3: cremation and relative-burial policies remain distinct", opts, async () => {
  const burialCase = await fixtures.makeCase(agent, "burial");
  await db.case.update({ where: { id: burialCase.id }, data: { scenarioId: "FAMILY_PLOT_BURIAL_V1" } });
  const result = await materializeCaseRequirements(agent.context, burialCase.id, meta("burial-requirements"));
  assert.equal(result.policyApproved, true);
  const conditional = await db.caseDocumentRequirement.findFirstOrThrow({
    where: { caseId: burialCase.id, stableKey: "responsible-for-burial-confirmation" },
    select: { id: true, isApplicable: true, applicabilityEvaluatedAt: true },
  });
  assert.equal(conditional.isApplicable, false);
  const responsible = await createCaseParty(agent.context, burialCase.id, {
    name: "Синтетический ответственный",
    roles: ["RESPONSIBLE_FOR_BURIAL"],
    preferredChannel: "EMAIL",
    consentStatus: "NOT_REQUESTED",
    visibilityPolicy: "CASE_TEAM",
  }, meta("burial-responsible-create"));
  const applicable = await db.caseDocumentRequirement.findUniqueOrThrow({
    where: { id: conditional.id },
    select: { isApplicable: true, applicabilityEvaluatedAt: true },
  });
  assert.equal(applicable.isApplicable, true);
  assert.equal(applicable.applicabilityEvaluatedAt >= conditional.applicabilityEvaluatedAt, true);
  await db.caseDocumentRequirement.update({ where: { id: conditional.id }, data: { isApplicable: false } });
  const applicabilityDrift = await reconcileM3Case(manager.context, burialCase.id);
  assert.equal(
    applicabilityDrift.discrepancies.some((item) => item.code === "DOCUMENT_APPLICABILITY_MISMATCH"),
    true,
  );
  await db.caseDocumentRequirement.update({ where: { id: conditional.id }, data: { isApplicable: true } });
  await updateCaseParty(agent.context, burialCase.id, responsible.partyId, {
    name: "Синтетический ответственный",
    roles: ["ADDITIONAL_CONTACT"],
    preferredChannel: "EMAIL",
    consentStatus: "NOT_REQUESTED",
    visibilityPolicy: "CASE_TEAM",
  }, meta("burial-responsible-role-remove"));
  assert.equal((await db.caseDocumentRequirement.findUniqueOrThrow({
    where: { id: conditional.id },
    select: { isApplicable: true },
  })).isApplicable, false);
  const [cremation, burial] = await Promise.all([
    db.caseDocumentRequirement.findMany({ where: { caseId: caseRecord.id }, select: { stableKey: true } }),
    db.caseDocumentRequirement.findMany({ where: { caseId: burialCase.id }, select: { stableKey: true } }),
  ]);
  assert.notDeepEqual(
    cremation.map((item) => item.stableKey).sort(),
    burial.map((item) => item.stableKey).sort(),
  );
  assert.deepEqual((await getCanonicalCase(agent.context, burialCase.leadId))?.payment, {
    totalKopecks: null,
    paidKopecks: null,
    balanceKopecks: null,
  });
});

test("M3: replacement draft preserves signed truth until replacement signing is atomic", opts, async () => {
  const replacementCase = await fixtures.makeCase(agent, "contract-replacement");
  const payer = await createCaseParty(agent.context, replacementCase.id, {
    name: "Синтетический плательщик замены договора",
    roles: ["PAYER"],
    preferredChannel: "EMAIL",
    consentStatus: "NOT_REQUESTED",
    visibilityPolicy: "FINANCE_LIMITED",
  }, meta("contract-replacement-payer"));
  const firstQuoteVersion = await createAcceptedQuote(replacementCase);
  const replacementPolicyVersion = `SYNTHETIC_REPLACEMENT_${fixtures.runId}`;
  const replacementPolicy = await db.contractSigningPolicy.create({
    data: {
      organizationId: agent.organizationId,
      version: replacementPolicyVersion,
      status: "APPROVED",
      allowedEvidenceTypes: ["SYNTHETIC_TEST_ONLY"],
      source: "SYNTHETIC_TEST_ONLY_NOT_A_LEGAL_VERDICT",
      approvedByUserId: manager.userId,
      approvedAt: new Date(),
      effectiveFrom: new Date(Date.now() - 60_000),
    },
    select: { id: true },
  });
  fixtures.trackSigningPolicy(replacementPolicy.id);

  const firstContract = await createContractVersion(agent.context, {
    caseId: replacementCase.id,
    payerPartyId: payer.partyId,
    paymentTerms: { mode: "synthetic-first" },
  }, meta("contract-replacement-v1-create"));
  await issueContractVersion(agent.context, firstContract.contractVersionId, meta("contract-replacement-v1-issue"));
  await signContractVersion(agent.context, {
    contractVersionId: firstContract.contractVersionId,
    signatureEvidence: { type: "SYNTHETIC_TEST_ONLY", reference: "synthetic-replacement-v1" },
    signaturePolicyVersion: replacementPolicyVersion,
  }, meta("contract-replacement-v1-sign"));

  const firstVersion = await db.quoteVersion.findUniqueOrThrow({
    where: { id: firstQuoteVersion.id },
    select: { quoteId: true },
  });
  const secondQuoteVersion = await db.quoteVersion.create({
    data: {
      quoteId: firstVersion.quoteId,
      versionNumber: 2,
      state: "PUBLISHED",
      payload: JSON.stringify({ schemaVersion: 1, total: 18_000_000, synthetic: true }),
      subtotal: 18_000_000,
      discountTotal: 0,
      total: 18_000_000,
      totalState: "KNOWN",
      currency: "RUB",
      snapshotChecksum: "b".repeat(64),
      catalogSourceVersion: "synthetic-integration-v2",
      publishedByMembershipId: agent.membershipId,
      publishedAt: new Date(),
      publishReason: "Synthetic replacement contract regression",
      publishChannel: "integration",
      idempotencyKey: `${fixtures.runId}:${replacementCase.id}:quote-publish-v2`,
      correlationId: `${fixtures.runId}:${replacementCase.id}:quote-publish-v2:correlation`,
    },
    select: { id: true },
  });
  await db.quote.update({
    where: { id: firstVersion.quoteId },
    data: { latestPublishedVersionId: secondQuoteVersion.id },
  });
  await db.case.update({
    where: { id: replacementCase.id },
    data: { publishedQuoteVersionId: secondQuoteVersion.id },
  });

  const secondContract = await createContractVersion(agent.context, {
    caseId: replacementCase.id,
    payerPartyId: payer.partyId,
    paymentTerms: { mode: "synthetic-replacement" },
  }, meta("contract-replacement-v2-create"));
  assert.equal((await db.contractVersion.findUniqueOrThrow({
    where: { id: firstContract.contractVersionId },
    select: { status: true },
  })).status, "SIGNED");

  await issueContractVersion(agent.context, secondContract.contractVersionId, meta("contract-replacement-v2-issue"));
  await signContractVersion(agent.context, {
    contractVersionId: secondContract.contractVersionId,
    signatureEvidence: { type: "SYNTHETIC_TEST_ONLY", reference: "synthetic-replacement-v2" },
    signaturePolicyVersion: replacementPolicyVersion,
  }, meta("contract-replacement-v2-sign"));
  assert.deepEqual(await db.contractVersion.findMany({
    where: { id: { in: [firstContract.contractVersionId, secondContract.contractVersionId] } },
    orderBy: { versionNumber: "asc" },
    select: { status: true },
  }), [{ status: "SUPERSEDED" }, { status: "SIGNED" }]);
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('td_agent.m3_contract_transition', 'sign', true)`;
      await tx.contractVersion.update({ where: { id: firstContract.contractVersionId }, data: { status: "SIGNED" } });
    }),
    /lifecycle transition requires canonical command/i,
  );
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    const historicalObligation = await tx.paymentObligation.findUniqueOrThrow({
      where: { contractVersionId: firstContract.contractVersionId },
      select: { id: true, amountKopecks: true },
    });
    await tx.paymentObligation.update({
      where: { id: historicalObligation.id },
      data: { amountKopecks: historicalObligation.amountKopecks + 1 },
    });
    const historicalDrift = await reconcileM3Case(manager.context, replacementCase.id, tx);
    assert.equal(historicalDrift.discrepancies.some((item) => (
      item.code === "OBLIGATION_TRUTH_MISMATCH" && item.entityId === historicalObligation.id
    )), true);
    throw new Error("ROLLBACK_HISTORICAL_RECONCILIATION_TEST");
  }), /ROLLBACK_HISTORICAL_RECONCILIATION_TEST/);
});

test("M3: upload rechecks conditional applicability after storage and scan", opts, async () => {
  const raceCase = await fixtures.makeCase(agent, "upload-applicability-race");
  await db.case.update({ where: { id: raceCase.id }, data: { scenarioId: "FAMILY_PLOT_BURIAL_V1" } });
  await materializeCaseRequirements(agent.context, raceCase.id, meta("upload-race-requirements"));
  const responsible = await createCaseParty(agent.context, raceCase.id, {
    name: "Синтетический ответственный race",
    roles: ["RESPONSIBLE_FOR_BURIAL"],
    preferredChannel: "EMAIL",
    consentStatus: "NOT_REQUESTED",
    visibilityPolicy: "CASE_TEAM",
  }, meta("upload-race-responsible"));
  const requirement = await db.caseDocumentRequirement.findFirstOrThrow({
    where: { caseId: raceCase.id, stableKey: "responsible-for-burial-confirmation" },
    select: { id: true, isApplicable: true, acceptedDocumentTypeCodes: true },
  });
  assert.equal(requirement.isApplicable, true);
  const documentTypeCode = Array.isArray(requirement.acceptedDocumentTypeCodes)
    ? requirement.acceptedDocumentTypeCodes.find((value): value is string => typeof value === "string")
    : null;
  assert.ok(documentTypeCode);
  const raceStorage = new InMemoryTestStorage();
  const invalidatingScanner: DocumentScanner = {
    isOperational: () => true,
    async scan() {
      await updateCaseParty(agent.context, raceCase.id, responsible.partyId, {
        name: "Синтетический ответственный race",
        roles: ["ADDITIONAL_CONTACT"],
        preferredChannel: "EMAIL",
        consentStatus: "NOT_REQUESTED",
        visibilityPolicy: "CASE_TEAM",
      }, meta("upload-race-role-remove"));
      return { status: "CLEAN", provider: "synthetic-race-scanner", resultCode: "CLEAN" };
    },
  };
  await expectCommandError(uploadCaseDocument(agent.context, {
    caseId: raceCase.id,
    requirementId: requirement.id,
    documentTypeCode,
    file: new File(["synthetic applicability race"], "race.pdf", { type: "application/pdf" }),
  }, meta("upload-race"), { storage: raceStorage, scanner: invalidatingScanner }), 409, /не применимо/);
  assert.equal(await db.caseDocumentVersion.count({ where: { caseId: raceCase.id } }), 0);
  assert.equal(raceStorage.size, 0);
});

test("M3: rejected upload fails closed when orphan cleanup cannot be proved", opts, async () => {
  class FailingDiscardStorage extends InMemoryTestStorage {
    override async discardUncommitted() {
      throw new Error("synthetic discard outage");
    }
  }
  const failingStorage = new FailingDiscardStorage();
  const uploadCase = await fixtures.makeCase(agent, "cleanup-failure");
  await db.case.update({ where: { id: uploadCase.id }, data: { scenarioId: "CREMATION_V1" } });
  await materializeCaseRequirements(agent.context, uploadCase.id, meta("cleanup-failure-requirements"));
  const requirement = (await listCaseDocumentRequirements(agent.context, uploadCase.id))[0];
  assert.ok(requirement);
  const documentTypeCode = requirement.acceptedDocumentTypeCodes[0];
  assert.ok(documentTypeCode);
  const command = meta("cleanup-failure-upload");
  const invalidatingScanner: DocumentScanner = {
    isOperational: () => true,
    async scan() {
      await db.caseDocumentRequirement.delete({ where: { id: requirement.id } });
      return { status: "CLEAN", provider: "synthetic-invalidating-scanner", resultCode: "CLEAN" };
    },
  };
  try {
    await assert.rejects(
      uploadCaseDocument(agent.context, {
        caseId: uploadCase.id,
        requirementId: requirement.id,
        documentTypeCode,
        file: new File(["synthetic rejected upload"], "rejected.pdf", { type: "application/pdf" }),
      }, command, { storage: failingStorage, scanner: invalidatingScanner }),
      (error: unknown) => error instanceof OperationalCommandError
        && error.status === 503
        && error.code === "ORPHAN_STORAGE_CLEANUP_FAILED",
    );
    assert.equal(await db.caseDocumentVersion.count({ where: { caseId: uploadCase.id } }), 0);
    assert.equal(failingStorage.size, 1);
  } finally {
    failingStorage.clear();
  }
});
