import { AsyncLocalStorage } from "node:async_hooks";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PATCH as intakePatch } from "../../app/api/agent/cases/[caseId]/intake/route";
import { decryptField } from "../../lib/crypto";
import type { CaseCommandResult } from "../../lib/caseService";
import { installM3OrganizationBaseline } from "./_m3Baseline";
import { createFixtureContext, db, makeRequest, sessionCookieHeader, skip } from "./_setup";

const fixtures = createFixtureContext("m3-intake-performance");
const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };
const faultMessage = "M3_INTAKE_FINAL_EVENT_ROLLBACK";
const mutations = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);
type Trace = {
  operations: string[];
  completed: string[];
  faultCaseId?: string;
  injected: number;
  transactionMs?: number;
};
const traces = new AsyncLocalStorage<Trace>();

before(async () => {
  if (skip) return;
  await fixtures.cleanup();
  db.$transaction = new Proxy(db.$transaction, {
    async apply(target, receiver, args) {
      const trace = traces.getStore();
      const started = performance.now();
      try { return await Reflect.apply(target, receiver, args); }
      finally { if (trace) trace.transactionMs = performance.now() - started; }
    },
  });
  // File-local test process, request-local instrumentation; no production hook is added.
  db.$use(async (params, next) => {
    const trace = traces.getStore();
    const operation = `${params.model ?? "raw"}.${params.action}`;
    trace?.operations.push(operation);
    const result = await next(params);
    trace?.completed.push(operation);
    const data = params.args as { data?: { caseId?: string; eventType?: string } } | undefined;
    if (trace?.faultCaseId && params.model === "CaseEvent" && params.action === "create"
      && data?.data?.caseId === trace.faultCaseId && data.data.eventType === "case.intake_saved.v1") {
      trace.injected += 1;
      throw new Error(faultMessage);
    }
    return result;
  });
});

after(async () => {
  if (skip) return;
  await fixtures.cleanup();
  await fixtures.assertNoResidue();
});

const scenarios = [
  { id: "CREMATION_V1", ceremonyType: "\u043a\u0440\u0435\u043c\u0430\u0446\u0438\u044f", rules: 3, applicable: 3 },
  { id: "FAMILY_PLOT_BURIAL_V1", ceremonyType: "\u043f\u043e\u0433\u0440\u0435\u0431\u0435\u043d\u0438\u0435", rules: 5, applicable: 4 },
] as const;
type Scenario = (typeof scenarios)[number];

async function makeFixture(scenario: Scenario, tag: string) {
  const owner = await fixtures.makeAgent(`${scenario.id}-${tag}`);
  const reviewer = await fixtures.makeMember(`${tag}-reviewer`, {
    organizationId: owner.organizationId, role: "DOCUMENT_REVIEWER",
  });
  const baseline = await installM3OrganizationBaseline(owner.organizationId);
  baseline.policyIds.forEach(fixtures.trackDocumentPolicy);
  baseline.documentTypeIds.forEach(fixtures.trackDocumentType);
  const record = await fixtures.makeCase(owner, tag);
  const cookie = await sessionCookieHeader(owner.userId, owner.agentId);
  return {
    ...record, cookie, reviewer,
    policyId: scenario.id === "CREMATION_V1" ? baseline.cremationPolicyId : baseline.burialPolicyId,
  };
}
type Fixture = Awaited<ReturnType<typeof makeFixture>>;

function intakeBody(scenario: Scenario, suffix = "original") {
  // Original smoke shape: the route must complete both derived transitions from this intake.
  return {
    ceremonyType: scenario.ceremonyType,
    deceasedName: `Synthetic intake ${suffix}`,
    needs: `Synthetic audit needs ${suffix}`,
  };
}

async function submit(
  fixture: Fixture, scenario: Scenario, key: string,
  suffix: string | Record<string, string | null> = "original", fault = false,
) {
  const trace: Trace = { operations: [], completed: [], injected: 0, ...(fault ? { faultCaseId: fixture.id } : {}) };
  await latencyControl(true);
  try {
    const response = await traces.run(trace, () => intakePatch(makeRequest(`/api/agent/cases/${fixture.leadId}/intake`, {
      method: "PATCH", cookie: fixture.cookie,
      body: typeof suffix === "string" ? intakeBody(scenario, suffix) : suffix,
      headers: { "idempotency-key": key, "x-correlation-id": key },
    }), { params: Promise.resolve({ caseId: String(fixture.leadId) }) }));
    return { response, trace };
  } finally {
    await latencyControl(false);
  }
}

async function latencyControl(active: boolean) {
  const endpoint = process.env.M3_INTAKE_LATENCY_CONTROL_URL;
  if (!endpoint) return;
  const url = new URL(endpoint);
  assert.equal(skip, false, "Latency control requires an approved isolated test DB");
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  const response = await fetch(url, { method: "POST", body: JSON.stringify({ active }) });
  assert.equal(response.status, 204, "Local latency control failed");
}

async function successful(result: Awaited<ReturnType<typeof submit>>) {
  assert.equal(result.response.status, 200, JSON.stringify(await result.response.clone().json()));
  const body = await result.response.json() as CaseCommandResult & { ok: boolean };
  assert.equal(body.ok, true);
  return body;
}

async function snapshot(fixture: Fixture) {
  // Include projections/audit, not just the lead: partial derived writes must be observable.
  return {
    lead: await db.clientLead.findUniqueOrThrow({ where: { id: fixture.leadId } }),
    record: await db.case.findUniqueOrThrow({ where: { id: fixture.id } }),
    events: await db.caseEvent.findMany({ where: { caseId: fixture.id }, orderBy: { id: "asc" } }),
    requirements: await db.caseDocumentRequirement.findMany({ where: { caseId: fixture.id }, orderBy: { id: "asc" } }),
    tasks: await db.task.findMany({ where: { organizationId: fixture.owner.organizationId }, orderBy: { id: "asc" } }),
    audits: await db.operationalAuditEvent.findMany({ where: { organizationId: fixture.owner.organizationId }, orderBy: { id: "asc" } }),
    projections: await db.projectionReceipt.findMany({ where: { organizationId: fixture.owner.organizationId }, orderBy: { id: "asc" } }),
  };
}

async function assertCommitted(
  fixture: Fixture, scenario: Scenario, body: CaseCommandResult, initialVersion: number, savedCount = 1,
) {
  const state = await snapshot(fixture);
  assert.equal(body.caseId, fixture.id);
  assert.equal(body.leadId, fixture.leadId);
  assert.equal(body.publicRef, fixture.publicRef);
  assert.equal(body.stage, "QUOTING");
  assert.equal(body.scenarioId, scenario.id);
  assert.equal(body.version, initialVersion + 2);
  assert.equal(state.record.stage, body.stage);
  assert.equal(state.record.scenarioId, body.scenarioId);
  assert.equal(state.record.version, body.version);
  assert.equal(state.lead.ceremonyType, scenario.ceremonyType);
  assert.equal(decryptField(state.lead.deceasedName), "Synthetic intake original");
  assert.equal(decryptField(state.lead.needs), "Synthetic audit needs original");
  const eventTypes = ["case.intake_saved.v1", "intake.completed.v1", "scenario.selected.v1"];
  assert.equal(state.events.length, 2 + savedCount);
  for (const eventType of eventTypes) {
    assert.equal(state.events.filter((event) => event.eventType === eventType).length,
      eventType === "case.intake_saved.v1" ? savedCount : 1);
  }
  const saved = state.events.find((event) => event.id === body.eventId)!;
  assert.equal(saved.id, body.eventId);
  assert.deepEqual(saved.result, {
    caseId: body.caseId, publicRef: body.publicRef, leadId: body.leadId, stage: body.stage,
    scenarioId: body.scenarioId, version: body.version, eventId: body.eventId, replayed: false,
  });
  const policy = await db.documentRequirementPolicy.findUniqueOrThrow({
    where: { id: fixture.policyId }, include: { rules: { orderBy: { stableKey: "asc" } } },
  });
  assert.equal(policy.status, "APPROVED");
  assert.equal(policy.version, 3_000_001);
  assert.equal(policy.rules.length, scenario.rules);
  assert.equal(state.requirements.length, scenario.rules);
  assert.equal(state.requirements.filter((item) => item.isApplicable).length, scenario.applicable);
  for (const rule of policy.rules) {
    const rows = state.requirements.filter((item) => item.ruleId === rule.id);
    assert.equal(rows.length, 1);
    const requirement = rows[0];
    assert.equal(requirement.organizationId, fixture.owner.organizationId);
    assert.equal(requirement.policyId, policy.id);
    assert.equal(requirement.policyVersion, policy.version);
    assert.equal(requirement.stableKey, rule.stableKey);
    assert.equal(requirement.kind, rule.kind);
    assert.equal(requirement.conditionExplanation, rule.conditionExplanation);
    assert.equal(requirement.dueAt, null);
    assert.ok(requirement.applicabilityEvaluatedAt instanceof Date);
    assert.equal(requirement.ownerMembershipId, fixture.reviewer.membershipId);
    assert.equal(requirement.ownerRole, rule.ownerRole);
    assert.equal(requirement.blockingStage, rule.blockingStage);
    assert.deepEqual(requirement.acceptedDocumentTypeCodes, rule.acceptedDocumentTypeCodes);
    assert.deepEqual(requirement.acceptedDocumentTypeVersionIds, rule.acceptedDocumentTypeVersionIds);
    assert.deepEqual(requirement.reviewChecklist, rule.reviewChecklist);
    assert.equal(requirement.sourceRule, rule.source);
    assert.equal(requirement.satisfactionStatus, "NOT_SATISFIED");
    assert.equal(requirement.satisfiedByVersionId, null);
    assert.equal(requirement.isApplicable, rule.kind === "REQUIRED");
  }
  assert.equal(state.audits.filter((audit) => audit.action === "document_requirements.materialized.v1").length, 1);
  assert.equal(state.tasks.length, 2);
  assert.deepEqual(state.tasks.map((task) => task.type).sort(), ["PREPARATION", "QUOTE_SEND"]);
  for (const task of state.tasks) {
    assert.equal(task.caseId, fixture.id);
    assert.equal(task.organizationId, fixture.owner.organizationId);
    assert.equal(task.status, "OPEN");
  }
  assert.equal(state.projections.length, 2);
  for (const eventType of ["intake.completed.v1", "scenario.selected.v1"]) {
    const event = state.events.find((item) => item.eventType === eventType)!;
    assert.equal(state.projections.filter((receipt) => receipt.sourceEventId === event.id
      && receipt.projector === "m1.case-work.v1").length, 1);
  }
  return state;
}

function assertReadOnlyReplay(trace: Trace) {
  assert.ok(trace.operations.length > 0, "Prisma instrumentation must observe the request");
  assert.deepEqual(trace.operations.filter((operation) => mutations.has(operation.split(".")[1])), [],
    "A replay must not repeat lead, requirements, audit, events or projection writes");
}

for (const scenario of scenarios) {
  test(`M3 intake ${scenario.id}: incomplete intake remains INTAKE`, opts, async () => {
    const fixture = await makeFixture(scenario, "incomplete");
    const initial = await snapshot(fixture);
    const body = await successful(await submit(fixture, scenario, `${fixtures.runId}:${scenario.id}:incomplete`, {
      ...intakeBody(scenario), deceasedName: null,
    }));
    const state = await snapshot(fixture);
    assert.equal(body.stage, "INTAKE");
    assert.equal(body.scenarioId, "UNSELECTED");
    assert.equal(body.version, initial.record.version);
    assert.equal(body.replayed, false);
    assert.deepEqual(state.record, initial.record);
    assert.equal(state.lead.ceremonyType, scenario.ceremonyType);
    assert.equal(state.lead.deceasedName, null);
    assert.equal(decryptField(state.lead.needs), "Synthetic audit needs original");
    assert.deepEqual(state.events.map((event) => event.eventType), ["case.intake_saved.v1"]);
    assert.equal(state.events[0].id, body.eventId);
    assert.deepEqual(state.requirements, initial.requirements);
    assert.deepEqual(state.tasks, initial.tasks);
    assert.deepEqual(state.audits, initial.audits);
    assert.deepEqual(state.projections, initial.projections);
  });

  test(`M3 intake ${scenario.id}: completed intake without scenario stops at PLANNING`, opts, async () => {
    const fixture = await makeFixture(scenario, "no-scenario");
    const initial = await snapshot(fixture);
    const body = await successful(await submit(fixture, scenario, `${fixtures.runId}:${scenario.id}:no-scenario`, {
      ...intakeBody(scenario), ceremonyType: null,
    }));
    const state = await snapshot(fixture);
    assert.equal(body.stage, "PLANNING");
    assert.equal(body.scenarioId, "UNSELECTED");
    assert.equal(body.version, initial.record.version + 1);
    assert.equal(body.replayed, false);
    assert.equal(state.record.stage, body.stage);
    assert.equal(state.record.scenarioId, body.scenarioId);
    assert.equal(state.record.version, body.version);
    assert.equal(state.lead.ceremonyType, null);
    assert.equal(decryptField(state.lead.deceasedName), "Synthetic intake original");
    assert.deepEqual(state.events.map((event) => event.eventType).sort(),
      ["case.intake_saved.v1", "intake.completed.v1"]);
    assert.equal(state.requirements.length, 0);
    assert.equal(state.tasks.length, 0);
    assert.deepEqual(state.audits, initial.audits);
    assert.equal(state.projections.length, 1);
    assert.equal(state.projections[0].sourceEventId,
      state.events.find((event) => event.eventType === "intake.completed.v1")!.id);
    assert.equal(state.projections[0].projector, "m1.case-work.v1");
  });

  test(`M3 intake ${scenario.id}: PLANNING selects scenario and advances once to QUOTING`, opts, async () => {
    const fixture = await makeFixture(scenario, "planning");
    const initial = await snapshot(fixture);
    const planning = await successful(await submit(fixture, scenario, `${fixtures.runId}:${scenario.id}:planning`, {
      ...intakeBody(scenario), ceremonyType: null,
    }));
    assert.equal(planning.stage, "PLANNING");
    assert.equal(planning.scenarioId, "UNSELECTED");
    assert.equal(planning.version, initial.record.version + 1);
    const selected = await successful(await submit(fixture, scenario, `${fixtures.runId}:${scenario.id}:select`));
    assert.equal(selected.replayed, false);
    assert.equal(selected.version, planning.version + 1);
    await assertCommitted(fixture, scenario, selected, initial.record.version, 2);
  });

  test(`M3 intake ${scenario.id}: later-stage edits never advance or reselect scenario`, opts, async () => {
    const fixture = await makeFixture(scenario, "later-stage");
    const initial = await snapshot(fixture);
    const original = await successful(await submit(fixture, scenario, `${fixtures.runId}:${scenario.id}:later-initial`));
    await assertCommitted(fixture, scenario, original, initial.record.version);
    const otherScenario = scenarios.find((item) => item.id !== scenario.id)!;
    for (const stage of ["QUOTING", "AGREEMENT", "CONTRACTING", "PAYMENT", "EXECUTION", "CLOSED"] as const) {
      // Fixture-only stage setup isolates the intake branch from unrelated lifecycle prerequisites.
      await db.case.update({ where: { id: fixture.id }, data: { stage } });
      const beforeEdit = await snapshot(fixture);
      const body = await successful(await submit(fixture, otherScenario,
        `${fixtures.runId}:${scenario.id}:edit:${stage}`, stage));
      const state = await snapshot(fixture);
      assert.equal(body.stage, stage);
      assert.equal(body.scenarioId, scenario.id);
      assert.equal(body.version, beforeEdit.record.version);
      assert.equal(body.replayed, false);
      assert.deepEqual(state.record, beforeEdit.record);
      assert.equal(state.lead.ceremonyType, otherScenario.ceremonyType);
      assert.equal(decryptField(state.lead.deceasedName), `Synthetic intake ${stage}`);
      assert.equal(decryptField(state.lead.needs), `Synthetic audit needs ${stage}`);
      assert.deepEqual(state.requirements, beforeEdit.requirements);
      assert.deepEqual(state.tasks, beforeEdit.tasks);
      assert.deepEqual(state.audits, beforeEdit.audits);
      assert.deepEqual(state.projections, beforeEdit.projections);
      assert.equal(state.events.length, beforeEdit.events.length + 1);
      assert.deepEqual(state.events.filter((event) => event.id !== body.eventId), beforeEdit.events);
      const saved = state.events.find((event) => event.id === body.eventId)!;
      assert.equal(saved.eventType, "case.intake_saved.v1");
      assert.equal(saved.fromStage, stage);
      assert.equal(saved.toStage, stage);
    }
  });

  test(`M3 intake ${scenario.id}: original request materializes the complete policy baseline`, opts, async (t) => {
    const fixture = await makeFixture(scenario, "normal");
    const initial = await snapshot(fixture);
    assert.equal(initial.record.stage, "INTAKE");
    assert.equal(initial.requirements.length, 0);
    const result = await submit(fixture, scenario, `${fixtures.runId}:${scenario.id}:normal`);
    const body = await successful(result);
    assert.equal(body.replayed, false);
    await assertCommitted(fixture, scenario, body, initial.record.version);
    assert.ok(result.trace.transactionMs != null);
    const budget = Number(process.env.M3_INTAKE_LATENCY_BUDGET_MS ?? 4500);
    assert.ok(Number.isFinite(budget) && budget <= 4500);
    assert.ok(result.trace.transactionMs <= budget, "Initial intake must retain at least 500ms transaction deadline headroom");
    t.diagnostic(`Initial intake transaction: ${Math.round(result.trace.transactionMs)}ms; deadline unchanged at 5000ms`);
    assert.ok(result.trace.completed.includes("ClientLead.update"));
    t.diagnostic(`Prisma operation count (not SQL latency): ${result.trace.operations.length}`);
  });

  test(`M3 intake ${scenario.id}: changed-payload duplicate truthfully replays stored outcome`, opts, async (t) => {
    const fixture = await makeFixture(scenario, "replay");
    const initial = await snapshot(fixture);
    const key = `${fixtures.runId}:${scenario.id}:replay`;
    const original = await successful(await submit(fixture, scenario, key));
    const committed = await assertCommitted(fixture, scenario, original, initial.record.version);
    const result = await submit(fixture, scenario, key, "must-not-overwrite");
    const replay = await successful(result);
    assert.deepEqual(replay, { ...original, replayed: true });
    assertReadOnlyReplay(result.trace);
    assert.deepEqual(await snapshot(fixture), committed);
    t.diagnostic(`Replay Prisma operation count: ${result.trace.operations.length}`);
  });

  test(`M3 intake ${scenario.id}: five parallel duplicates commit once`, opts, async (t) => {
    const fixture = await makeFixture(scenario, "parallel");
    const initial = await snapshot(fixture);
    const key = `${fixtures.runId}:${scenario.id}:parallel`;
    const requests = await Promise.all(Array.from({ length: 5 }, () => submit(fixture, scenario, key)));
    const bodies = await Promise.all(requests.map(successful));
    assert.equal(bodies.filter((body) => !body.replayed).length, 1);
    assert.equal(bodies.filter((body) => body.replayed).length, 4);
    const original = bodies.find((body) => !body.replayed)!;
    for (const [index, body] of bodies.entries()) {
      assert.deepEqual(body, { ...original, replayed: body.replayed });
      if (body.replayed) assertReadOnlyReplay(requests[index].trace);
      const duration = requests[index].trace.transactionMs;
      assert.ok(duration != null && duration <= 4500, `Parallel transaction exceeded deadline headroom: ${duration}ms`);
    }
    t.diagnostic(`Parallel transaction timings: ${requests.map(request => Math.round(request.trace.transactionMs!)).join(",")}ms`);
    await assertCommitted(fixture, scenario, original, initial.record.version);
  });

  test(`M3 intake ${scenario.id}: late fault rolls back lead, transitions, policy and projections`, opts, async () => {
    const fixture = await makeFixture(scenario, "rollback");
    const initial = await snapshot(fixture);
    const key = `${fixtures.runId}:${scenario.id}:rollback`;
    const failed = await submit(fixture, scenario, key, "original", true);
    assert.equal(failed.trace.injected, 1, "Fault must fire after the final intake event insert");
    assert.equal(failed.response.status, 500);
    assert.ok(failed.trace.completed.includes("ClientLead.update"));
    assert.ok(failed.trace.completed.includes("CaseDocumentRequirement.createMany"));
    assert.equal(failed.trace.completed.filter((operation) => operation === "CaseEvent.create").length, 3);
    assert.deepEqual(await snapshot(fixture), initial, "Every derived write must roll back atomically");
    const retried = await successful(await submit(fixture, scenario, key));
    assert.equal(retried.replayed, false, "Rolled-back command must not leave a replay receipt");
    await assertCommitted(fixture, scenario, retried, initial.record.version);
  });
}
