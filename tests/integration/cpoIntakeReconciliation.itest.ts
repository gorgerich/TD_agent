import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { POST as createLead } from "../../app/api/agent/leads/route";
import { PATCH as saveIntake } from "../../app/api/agent/cases/[caseId]/intake/route";
import { POST as createParty } from "../../app/api/agent/cases/[caseId]/parties/route";
import { PATCH as updateParty } from "../../app/api/agent/cases/[caseId]/parties/[partyId]/route";
import { GET as reconcile } from "../../app/api/agent/cases/[caseId]/reconciliation/route";
import { SESSION_COOKIE, signSession } from "../../lib/session";
import { materializeCaseRequirements } from "../../lib/documentRequirementService";
import { installM3OrganizationBaseline } from "./_m3Baseline";
import { createFixtureContext, db, makeRequest, skip, type FixtureMember } from "./_setup";

const fixtures = createFixtureContext("cpo-intake-reconciliation");
const options = { skip: skip ? "Approved isolated test database required" : false };
let owner: FixtureMember;
let outsider: FixtureMember;
let sequence = 0;

before(async () => {
  if (skip) return;
  owner = await fixtures.makeMember("owner");
  outsider = await fixtures.makeMember("foreign");
  const baseline = await installM3OrganizationBaseline(owner.organizationId);
  baseline.policyIds.forEach(fixtures.trackDocumentPolicy);
  baseline.documentTypeIds.forEach(fixtures.trackDocumentType);
});
after(async () => {
  if (skip) return;
  await fixtures.cleanup();
  await fixtures.assertNoResidue();
});

async function request(member: FixtureMember, route: string, method = "GET", body?: unknown) {
  return makeRequest(route, {
    method, body,
    cookie: `${SESSION_COOKIE}=${await signSession({ userId: member.userId, sessionVersion: 0, activeMembershipId: member.membershipId })}`,
    headers: { "Idempotency-Key": `${fixtures.runId}:${++sequence}`, "X-Correlation-Id": fixtures.runId },
  });
}

for (const ceremonyType of ["кремация", "погребение"] as const) {
  test(`legitimate partial ${ceremonyType} intake reconciles without authorizing fulfilment`, options, async () => {
    const created = await createLead(await request(owner, "/api/agent/leads", "POST", {
      name: `${fixtures.runId} SYNTHETIC ONLY`, phone: "0000000000", source: "PR36_OWNER_SYNTHETIC", ceremonyType,
    }));
    assert.equal(created.status, 201);
    const lead = await created.json();
    const params = Promise.resolve({ caseId: String(lead.id) });
    const prefix = `/api/agent/cases/${lead.id}`;
    const saved = await saveIntake(await request(owner, `${prefix}/intake`, "PATCH", { needs: "Synthetic only; no outreach" }), { params });
    assert.equal(saved.status, 200);
    const partyBody = { name: "Synthetic payer", roles: ["APPLICANT", "PAYER"], preferredChannel: "NONE", consentStatus: "NOT_REQUESTED", visibilityPolicy: "CASE_TEAM" };
    const partyResponse = await createParty(await request(owner, `${prefix}/parties`, "POST", partyBody), { params });
    assert.equal(partyResponse.status, 201);
    const party = await partyResponse.json();
    const updated = await updateParty(await request(owner, `${prefix}/parties/${party.partyId}`, "PATCH", {
      ...partyBody, name: "Synthetic updated payer", roles: [...partyBody.roles, "ADDITIONAL_CONTACT"],
    }), { params: Promise.resolve({ caseId: String(lead.id), partyId: party.partyId }) });
    assert.equal(updated.status, 200);
    const stored = await db.case.findUniqueOrThrow({ where: { id: lead.caseId } });
    assert.equal(stored.stage, "INTAKE");
    assert.equal(stored.scenarioId, "UNSELECTED");
    const response = await reconcile(await request(owner, `${prefix}/reconciliation`), { params });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.discrepancyCount, 0, JSON.stringify(result.discrepancies));
    assert.equal(result.fulfilment.ready, false);
    for (const code of ["POLICY_UNAPPROVED", "CONTRACT_NOT_SIGNED", "PAYMENT_UNKNOWN"]) {
      assert.ok(result.fulfilment.blockers.some((blocker: { code: string }) => blocker.code === code));
    }
    const foreign = await reconcile(await request(outsider, `${prefix}/reconciliation`), { params });
    assert.equal(foreign.status, 404);
  });
}

for (const stage of ["PLANNING", "EXECUTION", "CLOSED"] as const) {
  test(`unselected scenario in ${stage} remains a reconciliation discrepancy`, options, async () => {
    const record = await fixtures.makeCase(owner, `invalid-${stage}`);
    await db.case.update({ where: { id: record.id }, data: { stage } });
    const response = await reconcile(await request(owner, `/api/agent/cases/${record.leadId}/reconciliation`), {
      params: Promise.resolve({ caseId: String(record.leadId) }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.discrepancies.some((item: { code: string }) => item.code === "CASE_SCENARIO_UNSUPPORTED"));
    assert.equal(result.fulfilment.ready, false);
  });
}

test("materialized requirements with a lost scenario remain a discrepancy even during intake", options, async () => {
  const record = await fixtures.makeCase(owner, "lost-materialized-scenario");
  await db.case.update({ where: { id: record.id }, data: { scenarioId: "CREMATION_V1" } });
  await materializeCaseRequirements(owner.context, record.id, {
    idempotencyKey: `${fixtures.runId}:materialize`, correlationId: fixtures.runId,
  });
  assert.ok(await db.caseDocumentRequirement.count({ where: { caseId: record.id } }) > 0);
  await db.case.update({ where: { id: record.id }, data: { scenarioId: "UNSELECTED" } });
  const response = await reconcile(await request(owner, `/api/agent/cases/${record.leadId}/reconciliation`), {
    params: Promise.resolve({ caseId: String(record.leadId) }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.ok(result.discrepancies.some((item: { code: string }) => item.code === "CASE_SCENARIO_UNSUPPORTED"));
  assert.equal(result.fulfilment.ready, false);
});

for (const history of ["closed-at", "prior-stage", "prior-scenario", "standalone-document", "standalone-contract"] as const) {
  test(`unselected intake with ${history} does not conceal lifecycle drift`, options, async () => {
    const record = await fixtures.makeCase(owner, history);
    if (history === "closed-at") {
      await db.case.update({ where: { id: record.id }, data: { closedAt: new Date() } });
    } else if (history === "standalone-document") {
      const type = await db.documentTypeDefinition.findFirstOrThrow({ where: { organizationId: owner.organizationId } });
      await db.caseDocument.create({ data: { organizationId: owner.organizationId, caseId: record.id, documentTypeId: type.id } });
    } else if (history === "standalone-contract") {
      await db.contract.create({ data: { organizationId: owner.organizationId, caseId: record.id, createdByMembershipId: owner.membershipId } });
    } else {
      await db.caseEvent.create({ data: {
        caseId: record.id, tenantId: owner.organizationId, actorId: owner.agentId,
        eventType: history === "prior-stage" ? "intake.completed.v1" : "scenario.corrected.v1",
        fromStage: "INTAKE", toStage: history === "prior-stage" ? "PLANNING" : "INTAKE",
        idempotencyKey: `${fixtures.runId}:${history}`, correlationId: fixtures.runId,
        before: {}, after: {}, payload: {}, result: {},
      } });
    }
    const response = await reconcile(await request(owner, `/api/agent/cases/${record.leadId}/reconciliation`), {
      params: Promise.resolve({ caseId: String(record.leadId) }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.discrepancies.some((item: { code: string }) => item.code === "CASE_SCENARIO_UNSUPPORTED"));
    assert.equal(result.fulfilment.ready, false);
  });
}
