import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { skip, db, createFixtureContext, sessionCookieHeader, makeRequest } from "./_setup";
import { POST as leadsPost } from "../../app/api/agent/leads/route";
import { POST as transitionPost } from "../../app/api/agent/cases/[caseId]/transition/route";
import { PATCH as intakePatch } from "../../app/api/agent/cases/[caseId]/intake/route";
import { reconcileCaseState } from "../../lib/caseReconciliation";
import { SCENARIO_CLOSURE_GUARDS } from "../../lib/caseDomain";
import { getCanonicalCase, getCanonicalCases } from "../../lib/caseReadModel";
import { createCaseParty } from "../../lib/casePartyService";
import {
  createContractVersion,
  issueContractVersion,
  recordManualPayment,
  signContractVersion,
} from "../../lib/contractLedgerService";
import { materializeCaseRequirements } from "../../lib/documentRequirementService";
import { getM3IntegrationBaseline } from "./_m3Baseline";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };
const fixtures = createFixtureContext("cases");

before(async () => { if (!skip) await fixtures.cleanup(); });
after(async () => { if (!skip) await fixtures.cleanup(); });

async function createCase(tag: string) {
  const agent = await fixtures.makeAgent(tag);
  const cookie = await sessionCookieHeader(agent.userId, agent.agentId);
  const key = `it:${tag}:create`;
  const request = () => leadsPost(makeRequest("/api/agent/leads", {
    method: "POST",
    cookie,
    headers: { "idempotency-key": key, "x-correlation-id": `it:${tag}` },
    body: { name: `Клиент ${tag}`, phone: `+7916${String(agent.agentId).padStart(7, "0")}`, source: "agent" },
  }));
  const first = await request();
  assert.equal(first.status, 201);
  const lead = await first.json() as { id: number; caseId: string };
  return { ...agent, cookie, lead, request };
}

async function command(input: {
  leadId: number;
  cookie: string;
  eventType: string;
  key: string;
  payload?: Record<string, unknown>;
}) {
  return transitionPost(
    makeRequest(`/api/agent/cases/${input.leadId}/transition`, {
      method: "POST",
      cookie: input.cookie,
      headers: { "idempotency-key": input.key, "x-correlation-id": `it:case:${input.leadId}` },
      body: { eventType: input.eventType, payload: input.payload ?? {} },
    }),
    { params: Promise.resolve({ caseId: String(input.leadId) }) },
  );
}

test("AC-W2-02: create and transition retries are idempotent", opts, async () => {
  const fixture = await createCase("idem");
  const replayCreate = await fixture.request();
  assert.equal(replayCreate.status, 200);
  const replayLead = await replayCreate.json() as { id: number; replayed: boolean };
  assert.equal(replayLead.id, fixture.lead.id);
  assert.equal(replayLead.replayed, true);
  assert.equal(await db.clientLead.count({ where: { agentId: fixture.agentId } }), 1);

  await db.clientLead.update({ where: { id: fixture.lead.id }, data: { deceasedName: "enc1:test" } });
  const first = await command({ leadId: fixture.lead.id, cookie: fixture.cookie, eventType: "intake.completed.v1", key: "it:idem:intake" });
  assert.equal(first.status, 200);
  const replay = await command({ leadId: fixture.lead.id, cookie: fixture.cookie, eventType: "intake.completed.v1", key: "it:idem:intake" });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as { replayed: boolean }).replayed, true);
  assert.equal(await db.caseEvent.count({ where: { caseId: fixture.lead.caseId, eventType: "intake.completed.v1" } }), 1);
});

test("AC-W2-01: lead replay cannot disclose another agent's case", opts, async () => {
  const organizationId = await fixtures.makeOrganization("lead-replay-team");
  const owner = await fixtures.makeMember("lead-replay-owner", { organizationId, role: "AGENT" });
  const teammate = await fixtures.makeMember("lead-replay-teammate", { organizationId, role: "AGENT" });
  const ownerCookie = await sessionCookieHeader(owner.userId, owner.agentId);
  const teammateCookie = await sessionCookieHeader(teammate.userId, teammate.agentId);
  const key = `it:${fixtures.runId}:lead-replay-owner`;
  const ownerResponse = await leadsPost(makeRequest("/api/agent/leads", {
    method: "POST",
    cookie: ownerCookie,
    headers: { "idempotency-key": key, "x-correlation-id": key },
    body: { name: "Private owner lead", phone: "+79160000123", source: "agent", context: "Private owner context" },
  }));
  assert.equal(ownerResponse.status, 201);

  const denied = await leadsPost(makeRequest("/api/agent/leads", {
    method: "POST",
    cookie: teammateCookie,
    headers: { "idempotency-key": key, "x-correlation-id": key },
    body: { name: "Teammate request", phone: "+79160000456", source: "agent" },
  }));
  assert.equal(denied.status, 404);
  const body = await denied.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.equal(JSON.stringify(body).includes("+79160000123"), false);
  assert.equal(JSON.stringify(body).includes("Private owner context"), false);
  assert.equal(await db.clientLead.count({ where: { agentId: teammate.agentId } }), 0);
});

test("W2-09: intake save and derived transitions replay atomically", opts, async () => {
  const fixture = await createCase("intake-idem");
  const key = "it:intake-idem:save";
  const request = (deceasedName: string) => intakePatch(
    makeRequest(`/api/agent/cases/${fixture.lead.id}/intake`, {
      method: "PATCH",
      cookie: fixture.cookie,
      headers: { "idempotency-key": key, "x-correlation-id": "it:intake-idem" },
      body: { deceasedName, ceremonyType: "кремация", budget: "до 130000" },
    }),
    { params: Promise.resolve({ caseId: String(fixture.lead.id) }) },
  );

  const first = await request("Первое значение");
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
  const firstBody = await first.json() as { stage: string; replayed: boolean };
  assert.equal(firstBody.stage, "QUOTING");
  assert.equal(firstBody.replayed, false);
  const beforeRetry = await db.clientLead.findUniqueOrThrow({ where: { id: fixture.lead.id }, select: { deceasedName: true } });

  const replay = await request("Повтор не должен перезаписать данные");
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as { replayed: boolean }).replayed, true);
  const afterRetry = await db.clientLead.findUniqueOrThrow({ where: { id: fixture.lead.id }, select: { deceasedName: true } });
  assert.equal(afterRetry.deceasedName, beforeRetry.deceasedName);
  assert.equal(await db.caseEvent.count({ where: { caseId: fixture.lead.caseId, eventType: "case.intake_saved.v1" } }), 1);
  assert.equal(await db.caseEvent.count({ where: { caseId: fixture.lead.caseId, eventType: "intake.completed.v1" } }), 1);
  assert.equal(await db.caseEvent.count({ where: { caseId: fixture.lead.caseId, eventType: "scenario.selected.v1" } }), 1);
});

test("M3 privacy: legacy religion field is fail-closed in the operational intake API", opts, async () => {
  const fixture = await createCase("privacy-religion");
  const response = await intakePatch(
    makeRequest(`/api/agent/cases/${fixture.lead.id}/intake`, {
      method: "PATCH",
      cookie: fixture.cookie,
      headers: {
        "idempotency-key": "it:privacy-religion:save",
        "x-correlation-id": "it:privacy-religion",
      },
      body: { religion: "synthetic-special-category-value" },
    }),
    { params: Promise.resolve({ caseId: String(fixture.lead.id) }) },
  );
  assert.equal(response.status, 400);
  assert.equal((await db.clientLead.findUniqueOrThrow({ where: { id: fixture.lead.id } })).religion, null);
});

test("W2-09: an idempotency key cannot replay another case in the same tenant", opts, async () => {
  const first = await createCase("key-owner");
  const secondResponse = await leadsPost(makeRequest("/api/agent/leads", {
    method: "POST",
    cookie: first.cookie,
    headers: { "idempotency-key": "it:key-owner:create-second", "x-correlation-id": "it:key-owner" },
    body: { name: "Второй клиент", phone: "+79160000002", source: "agent" },
  }));
  assert.equal(secondResponse.status, 201);
  const second = await secondResponse.json() as { id: number; caseId: string };
  await db.clientLead.updateMany({
    where: { id: { in: [first.lead.id, second.id] } },
    data: { deceasedName: "enc1:test" },
  });

  const sharedKey = "it:key-owner:shared-transition";
  const leadIds = [first.lead.id, second.id];
  const responses = await Promise.all(leadIds.map((leadId) => command({
    leadId,
    cookie: first.cookie,
    eventType: "intake.completed.v1",
    key: sharedKey,
  })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const losingIndex = responses.findIndex((response) => response.status === 409);
  assert.notEqual(losingIndex, -1);
  assert.equal((await responses[losingIndex].json() as { code: string }).code, "IDEMPOTENCY_CONFLICT");

  const aggregates = await db.case.findMany({
    where: { leadId: { in: leadIds } },
    select: { leadId: true, stage: true },
  });
  assert.equal(aggregates.find((item) => item.leadId === leadIds[losingIndex])?.stage, "INTAKE");
  assert.equal(aggregates.find((item) => item.leadId !== leadIds[losingIndex])?.stage, "PLANNING");
  assert.equal(await db.caseEvent.count({ where: { tenantId: first.organizationId, idempotencyKey: sharedKey } }), 1);
});

test("AC-W2-01/W2-12: invalid transition is clear and has no side effects", opts, async () => {
  const fixture = await createCase("invalid");
  const before = await db.caseEvent.count({ where: { caseId: fixture.lead.caseId } });
  const response = await command({
    leadId: fixture.lead.id,
    cookie: fixture.cookie,
    eventType: "payment.requirement_satisfied.v1",
    key: "it:invalid:paid",
  });
  assert.equal(response.status, 422);
  const body = await response.json() as { code: string; error: string };
  assert.equal(body.code, "INVALID_TRANSITION");
  assert.match(body.error, /запрещён/);
  const aggregate = await db.case.findUniqueOrThrow({ where: { id: fixture.lead.caseId } });
  assert.equal(aggregate.stage, "INTAKE");
  assert.equal(await db.caseEvent.count({ where: { caseId: fixture.lead.caseId } }), before);
});

test("W2-13/AC-W2-06: full allowed chain persists audit events and reconciles to zero", opts, async () => {
  const fixture = await createCase("chain");
  const leadId = fixture.lead.id;
  await db.clientLead.update({ where: { id: leadId }, data: { deceasedName: "enc1:test", ceremonyType: "кремация" } });
  const membership = await db.membership.findUniqueOrThrow({ where: { agentId: fixture.agentId } });
  const baseline = await getM3IntegrationBaseline();
  const documentTypes = await db.documentTypeDefinition.findMany({
    where: {
      code: { in: [baseline.documentTypes.identity, baseline.documentTypes.death, baseline.documentTypes.cremation] },
      version: 1,
    },
  });
  const reviewer = await fixtures.makeMember("chain-reviewer", {
    organizationId: membership.organizationId,
    role: "DOCUMENT_REVIEWER",
  });
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "intake.completed.v1", key: "it:chain:intake" })).status, 200);
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "scenario.selected.v1", key: "it:chain:scenario", payload: { scenarioId: "CREMATION_V1" } })).status, 200);

  const meeting = await db.meeting.create({
    data: {
      leadId,
      agentId: fixture.agentId,
      organizationId: membership.organizationId,
      caseId: fixture.lead.caseId,
      ownerMembershipId: membership.id,
      idempotencyKey: `it:chain:meeting:${leadId}`,
      status: "COMPLETED",
      operationalStatus: "COMPLETED",
      outcome: "Integration fixture",
      outcomeRecordedAt: new Date(),
    },
  });
  const quote = await db.quote.create({
    data: {
      meetingId: meeting.id,
      organizationId: membership.organizationId,
      caseId: fixture.lead.caseId,
      ownerMembershipId: membership.id,
      scenario: "CREMATION_V1",
      status: "ACCEPTED",
      currency: "RUB",
    },
  });
  const version = await db.quoteVersion.create({
    data: {
      quoteId: quote.id,
      versionNumber: 1,
      state: "PUBLISHED",
      payload: JSON.stringify({ schemaVersion: 1, total: 100_000_00, synthetic: true }),
      subtotal: 100_000_00,
      discountTotal: 0,
      total: 100_000_00,
      totalState: "KNOWN",
      currency: "RUB",
      snapshotChecksum: "b".repeat(64),
      catalogSourceVersion: "synthetic-week2-chain-v1",
      publishedByMembershipId: membership.id,
      publishedAt: new Date(),
      publishReason: "Synthetic integration chain",
      publishChannel: "integration",
      idempotencyKey: `it:chain:quote-version:${leadId}`,
      correlationId: `it:chain:quote-version:${leadId}`,
    },
  });
  await db.quote.update({ where: { id: quote.id }, data: { latestPublishedVersionId: version.id } });
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "quote.published.v1", key: "it:chain:publish", payload: { quoteVersionId: version.id } })).status, 200);
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "quote.accepted.v1", key: "it:chain:accept", payload: { quoteVersionId: version.id } })).status, 200);

  await materializeCaseRequirements(fixture.context, fixture.lead.caseId, {
    idempotencyKey: `it:chain:requirements:${leadId}`,
    correlationId: `it:chain:requirements:${leadId}`,
    reason: "Synthetic integration chain",
  });
  const requirements = await db.caseDocumentRequirement.findMany({
    where: { caseId: fixture.lead.caseId, policyId: baseline.cremationPolicyId },
    orderBy: { stableKey: "asc" },
  });
  assert.equal(requirements.length, 3);
  for (const requirement of requirements) {
    const acceptedCode = (requirement.acceptedDocumentTypeCodes as string[])[0];
    const documentType = documentTypes.find((definition) => definition.code === acceptedCode);
    assert.ok(documentType);
    const document = await db.caseDocument.create({
      data: {
        organizationId: membership.organizationId,
        caseId: fixture.lead.caseId,
        requirementId: requirement.id,
        documentTypeId: documentType.id,
        status: "VERIFIED",
      },
    });
    const verified = await db.caseDocumentVersion.create({
      data: {
        documentId: document.id,
        versionNumber: 1,
        organizationId: membership.organizationId,
        caseId: fixture.lead.caseId,
        requirementId: requirement.id,
        fileChecksum: "c".repeat(64),
        storageKey: `integration/${fixtures.runId}/${requirement.id}`,
        storageEtag: "c".repeat(64),
        originalFilenameEncrypted: "enc1:synthetic",
        mimeType: "application/pdf",
        size: 128,
        uploaderMembershipId: membership.id,
        source: "SYNTHETIC_TEST_ONLY",
        status: "VERIFIED",
        scanStatus: "CLEAN",
        scanProvider: "synthetic-integration",
        assignedReviewerMembershipId: reviewer.membershipId,
        reviewedByMembershipId: reviewer.membershipId,
        reviewedAt: new Date(),
        reviewChecklist: acceptedCode === baseline.documentTypes.identity
          ? { "identity-match": true }
          : acceptedCode === baseline.documentTypes.death
            ? { "death-record-match": true }
            : { "scenario-evidence": true },
      },
    });
    await db.caseDocumentRequirement.update({
      where: { id: requirement.id },
      data: { satisfactionStatus: "SATISFIED", satisfiedByVersionId: verified.id },
    });
  }

  const payer = await createCaseParty(fixture.context, fixture.lead.caseId, {
    name: "Synthetic payer",
    roles: ["PAYER"],
    preferredChannel: "NONE",
    consentStatus: "NOT_REQUESTED",
    visibilityPolicy: "FINANCE_LIMITED",
  }, {
    idempotencyKey: `it:chain:payer:${leadId}`,
    correlationId: `it:chain:payer:${leadId}`,
    reason: "Synthetic integration chain",
  });
  const contract = await createContractVersion(fixture.context, {
    caseId: fixture.lead.caseId,
    payerPartyId: payer.partyId,
    paymentTerms: { mode: "synthetic-test-only" },
    validUntil: new Date(Date.now() + 60 * 60 * 1000),
  }, {
    idempotencyKey: `it:chain:contract-create:${leadId}`,
    correlationId: `it:chain:contract-create:${leadId}`,
    reason: "Synthetic integration chain",
  });
  await issueContractVersion(fixture.context, contract.contractVersionId, {
    idempotencyKey: `it:chain:contract-issue:${leadId}`,
    correlationId: `it:chain:contract-issue:${leadId}`,
    reason: "Synthetic integration chain",
  });
  const signingPolicyVersion = `SYNTHETIC_TEST_ONLY_${fixtures.runId}`;
  const signingPolicy = await db.contractSigningPolicy.create({
    data: {
      organizationId: membership.organizationId,
      version: signingPolicyVersion,
      status: "APPROVED",
      allowedEvidenceTypes: ["SYNTHETIC_TEST_ONLY"],
      source: "SYNTHETIC_TEST_ONLY_NOT_A_LEGAL_VERDICT",
      approvedByUserId: fixture.userId,
      approvedAt: new Date(),
      effectiveFrom: new Date(Date.now() - 60_000),
    },
  });
  fixtures.trackSigningPolicy(signingPolicy.id);
  const signed = await signContractVersion(fixture.context, {
    contractVersionId: contract.contractVersionId,
    signatureEvidence: { type: "SYNTHETIC_TEST_ONLY", reference: "synthetic-chain-evidence" },
    signaturePolicyVersion: signingPolicyVersion,
  }, {
    idempotencyKey: `it:chain:contract-sign:${leadId}`,
    correlationId: `it:chain:contract-sign:${leadId}`,
    reason: "Synthetic integration chain",
  });

  const customer = await db.user.create({ data: { email: `it-customer-${fixture.agentId}@test.local` } });
  fixtures.trackUser(customer.id);
  const order = await db.order.create({
    data: {
      publicId: `IT-${fixture.agentId}`,
      userId: customer.id,
      agentId: fixture.agentId,
      meetingId: meeting.id,
      status: "SIGNED",
      serviceType: "funeral",
      totalAmount: version.total,
      meta: "{}",
    },
  });
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: fixture.lead.caseId } })).stage, "PAYMENT");
  assert.equal(await db.caseEvent.count({
    where: { caseId: fixture.lead.caseId, eventType: "contract.signed.v1" },
  }), 1);
  const finance = await fixtures.makeMember("chain-finance", {
    organizationId: membership.organizationId,
    role: "FINANCE",
  });
  await recordManualPayment(finance.context, {
    obligationId: signed.obligationId,
    payerPartyId: payer.partyId,
    amountKopecks: version.total,
    currency: "RUB",
    occurredAt: new Date(),
    method: "BANK_TRANSFER",
    evidenceReference: "synthetic-chain-payment-evidence",
    reason: "Synthetic full payment",
  }, {
    idempotencyKey: `it:chain:payment-ledger:${leadId}`,
    correlationId: `it:chain:payment-ledger:${leadId}`,
    reason: "Synthetic integration chain",
  });
  assert.equal((await db.case.findUniqueOrThrow({ where: { id: fixture.lead.caseId } })).stage, "EXECUTION");
  assert.equal(await db.caseEvent.count({
    where: { caseId: fixture.lead.caseId, eventType: "payment.requirement_satisfied.v1" },
  }), 1);

  const guardState = Object.fromEntries(SCENARIO_CLOSURE_GUARDS.CREMATION_V1.map((guard) => [guard, true]));
  await db.case.update({ where: { id: fixture.lead.caseId }, data: { guardState } });
  const closeResponse = await command({ leadId, cookie: fixture.cookie, eventType: "case.closure_requested.v1", key: "it:chain:close" });
  assert.equal(closeResponse.status, 200, JSON.stringify(await closeResponse.clone().json()));

  await db.document.create({
    data: {
      leadId,
      agentId: fixture.agentId,
      name: "death-certificate.pdf",
      category: "Свидетельство о смерти",
      url: "memory://week-2/death-certificate.pdf",
      pathname: "week-2/death-certificate.pdf",
      mimeType: "application/pdf",
      size: 128,
    },
  });

  const aggregate = await db.case.findUniqueOrThrow({ where: { id: fixture.lead.caseId } });
  assert.equal(aggregate.stage, "CLOSED");
  assert.equal(await db.caseEvent.count({ where: { caseId: aggregate.id } }), 8);
  const [listProjection, detailProjection] = await Promise.all([
    getCanonicalCases(fixture.context),
    getCanonicalCase(fixture.context, leadId),
  ]);
  assert.equal(listProjection.find((item) => item.leadId === leadId)?.stage, aggregate.stage);
  assert.equal(detailProjection?.stage, aggregate.stage);
  const report = await reconcileCaseState(fixture.context);
  assert.equal(report.discrepancyCount, 0, JSON.stringify(report.issues));
  assert.equal(report.leadCount, report.caseCount);
  assert.equal(report.documentCount, 1);
  await db.order.delete({ where: { id: order.id } });
  await db.user.delete({ where: { id: customer.id } });
});

test("Week 2 tenant isolation: another agent cannot transition case", opts, async () => {
  const owner = await createCase("tenant-owner");
  const attacker = await fixtures.makeAgent("tenant-attacker");
  const response = await command({
    leadId: owner.lead.id,
    cookie: await sessionCookieHeader(attacker.userId, attacker.agentId),
    eventType: "intake.completed.v1",
    key: "it:tenant:attack",
  });
  assert.equal(response.status, 404);
});
