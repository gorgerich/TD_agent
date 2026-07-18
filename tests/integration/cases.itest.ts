import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { skip, db, createFixtureContext, sessionCookieHeader, makeRequest } from "./_setup";
import { POST as leadsPost } from "../../app/api/agent/leads/route";
import { POST as transitionPost } from "../../app/api/agent/cases/[caseId]/transition/route";
import { PATCH as intakePatch } from "../../app/api/agent/cases/[caseId]/intake/route";
import { reconcileCaseState } from "../../lib/caseReconciliation";
import { SCENARIO_CLOSURE_GUARDS } from "../../lib/caseDomain";
import { getCanonicalCase, getCanonicalCases } from "../../lib/caseReadModel";

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
  assert.equal(first.status, 200);
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
  assert.equal(await db.caseEvent.count({ where: { tenantId: `agent:${first.agentId}`, idempotencyKey: sharedKey } }), 1);
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
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "intake.completed.v1", key: "it:chain:intake" })).status, 200);
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "scenario.selected.v1", key: "it:chain:scenario", payload: { scenarioId: "CREMATION_V1" } })).status, 200);

  const membership = await db.membership.findUniqueOrThrow({ where: { agentId: fixture.agentId } });
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
  const quote = await db.quote.create({ data: { meetingId: meeting.id } });
  const version = await db.quoteVersion.create({ data: { quoteId: quote.id, payload: "{}", total: 100_000_00 } });
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "quote.published.v1", key: "it:chain:publish", payload: { quoteVersionId: version.id } })).status, 200);
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "quote.accepted.v1", key: "it:chain:accept", payload: { quoteVersionId: version.id } })).status, 200);

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
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "contract.signed.v1", key: "it:chain:contract" })).status, 200);
  await db.order.update({ where: { id: order.id }, data: { status: "PAID" } });
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "payment.requirement_satisfied.v1", key: "it:chain:payment" })).status, 200);

  const guardState = Object.fromEntries(SCENARIO_CLOSURE_GUARDS.CREMATION_V1.map((guard) => [guard, true]));
  await db.case.update({ where: { id: fixture.lead.caseId }, data: { guardState } });
  assert.equal((await command({ leadId, cookie: fixture.cookie, eventType: "case.closure_requested.v1", key: "it:chain:close" })).status, 200);

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
    getCanonicalCases(fixture.agentId),
    getCanonicalCase(fixture.agentId, leadId),
  ]);
  assert.equal(listProjection.find((item) => item.leadId === leadId)?.stage, aggregate.stage);
  assert.equal(detailProjection?.stage, aggregate.stage);
  const report = await reconcileCaseState(fixture.agentId);
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
