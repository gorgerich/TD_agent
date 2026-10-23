import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { isApprovedIntegrationDatabaseEnvironment } from "./testDatabaseSafety";
import type { IntegrationFixtureContext } from "./_setup";
import type { CommercialLine } from "../../lib/commercialQuote";

const enabled = process.env.ALLOW_DB_TESTS === "1" && isApprovedIntegrationDatabaseEnvironment({
  testDatabaseUrl: process.env.TEST_DATABASE_URL, databaseUrl: process.env.DATABASE_URL,
  directDatabaseUrl: process.env.DATABASE_URL_UNPOOLED,
});
const opts = { skip: enabled ? false : "approved isolated local database required" };
const createClient = () => new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } },
  log: [{ emit: "event", level: "query" }] });
let db: ReturnType<typeof createClient>;
let setup: typeof import("./_setup");
let commercial: typeof import("../../lib/commercialQuoteService");
let requirements: typeof import("../../lib/documentRequirementService");
let baseline: typeof import("./_m3Baseline");
let publishRoute: typeof import("../../app/api/agent/quotes/[quoteId]/publish/route");
let crypto: typeof import("../../lib/crypto");
let fixtures: IntegrationFixtureContext;
type Trace = { queries: { operation: string; durationMs: number }[]; transactions: number[]; errors: string[] };
let active: Trace | null = null;
let failAuditKey: string | null = null;
let injectedFailures = 0;

before(async () => {
  if (!enabled) return;
  db = createClient();
  (globalThis as typeof globalThis & { prisma?: PrismaClient }).prisma = db;
  setup = await import("./_setup");
  assert.equal(setup.db, db, "The real route must use the instrumented isolated client");
  commercial = await import("../../lib/commercialQuoteService");
  requirements = await import("../../lib/documentRequirementService");
  baseline = await import("./_m3Baseline");
  publishRoute = await import("../../app/api/agent/quotes/[quoteId]/publish/route");
  crypto = await import("../../lib/crypto");
  fixtures = setup.createFixtureContext("commercial-publish-performance");
  db.$use(async (params, next) => {
    if (failAuditKey && params.model === "OperationalAuditEvent" && params.action === "create"
      && params.args?.data?.idempotencyKey === failAuditKey) {
      failAuditKey = null;
      injectedFailures += 1;
      throw new Error("SYNTHETIC_PUBLICATION_FINAL_AUDIT_FAILURE");
    }
    return next(params);
  });
  db.$on("query", event => {
    const first = event.query.trimStart().split(/\s+/, 1)[0].toUpperCase();
    active?.queries.push({ operation: ["SELECT", "INSERT", "UPDATE", "DELETE", "BEGIN", "COMMIT", "ROLLBACK", "SET"].includes(first) ? first : "OTHER",
      durationMs: event.duration });
  });
  db.$transaction = new Proxy(db.$transaction, {
    async apply(target, receiver, args) {
      const trace = active, started = performance.now();
      try { return await Reflect.apply(target, receiver, args); }
      catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        trace?.errors.push(typeof code === "string" && /^P\d{4}$/.test(code) ? code : "UNCLASSIFIED");
        throw error;
      } finally { trace?.transactions.push(Math.round(performance.now() - started)); }
    },
  });
});

after(async () => {
  if (!enabled) return;
  try { await fixtures.cleanup(); await fixtures.assertNoResidue(); }
  finally { await db.$disconnect(); }
});

async function latency(active: boolean) {
  const endpoint = process.env.M3_INTAKE_LATENCY_CONTROL_URL;
  if (!endpoint) return;
  const url = new URL(endpoint);
  assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1");
  assert.equal((await fetch(url, { method: "POST", body: JSON.stringify({ active }) })).status, 204);
}

for (const scenario of ["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"] as const) {
  test(`published quote preserves its transaction deadline with materialized ${scenario} requirements`, opts, async t => {
    const owner = await fixtures.makeAgent(scenario);
    await fixtures.makeMember(`${scenario}-reviewer`, { organizationId: owner.organizationId, role: "DOCUMENT_REVIEWER" });
    const policies = await baseline.installM3OrganizationBaseline(owner.organizationId);
    policies.policyIds.forEach(fixtures.trackDocumentPolicy);
    policies.documentTypeIds.forEach(fixtures.trackDocumentType);
    const record = await fixtures.makeCase(owner, scenario);
    await db.clientLead.update({ where: { id: record.leadId }, data: {
      deceasedName: crypto.encryptField("Synthetic publication deceased"),
      ceremonyType: scenario === "CREMATION_V1" ? "кремация" : "родственное захоронение",
    } });
    await db.case.update({ where: { id: record.id }, data: { stage: "QUOTING", scenarioId: scenario } });
    const meta = (label: string) => ({ idempotencyKey: `${fixtures.runId}:${scenario}:${label}`,
      correlationId: `${fixtures.runId}:${scenario}`, reason: "Synthetic publication deadline regression" });
    await requirements.materializeCaseRequirements(owner.context, record.id, meta("requirements"));
    assert.equal(await db.caseDocumentRequirement.count({ where: { caseId: record.id } }), scenario === "CREMATION_V1" ? 3 : 5);
    const meeting = await db.meeting.create({ data: {
      leadId: record.leadId, agentId: owner.agentId, organizationId: owner.organizationId, caseId: record.id,
      ownerMembershipId: owner.membershipId, status: "SCHEDULED", type: "CONSULTATION", operationalStatus: "CONFIRMED",
      channel: "IN_PERSON", timezone: "Europe/Moscow", scheduledAt: new Date(Date.now() + 86_400_000),
      idempotencyKey: `${fixtures.runId}:${scenario}:meeting`,
    } });
    await db.task.create({ data: {
      leadId: record.leadId, agentId: owner.agentId, organizationId: owner.organizationId, caseId: record.id,
      assigneeMembershipId: owner.membershipId, createdByMembershipId: owner.membershipId,
      type: "QUOTE_SEND", priority: "HIGH", status: "OPEN", title: "Synthetic publication task",
      idempotencyKey: `${fixtures.runId}:${scenario}:task`,
    } });
    const line: CommercialLine = { stableKey: `${fixtures.runId}:${scenario}:service`, position: 0, type: "SERVICE",
      serviceCode: "synthetic-cpo", description: "Synthetic publication service", quantity: 1, unit: "service",
      priceState: "KNOWN", clientUnitPrice: 100_000, costState: "KNOWN", unitCost: 80_000, discountAmount: 0,
      included: false, optional: false, relationKind: "STANDALONE", source: "synthetic-cpo-repair", sourceVersion: "1",
      scenarioCompatibility: ["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"] };
    const draft = await commercial.saveCommercialDraft({ meetingId: meeting.id, scenario, lines: [line], context: owner.context, meta: meta("draft") });
    await commercial.markCommercialQuoteInReview({ quoteId: draft.quoteId, context: owner.context, meta: meta("review") });
    const cookie = await setup.sessionCookieHeader(owner.userId, owner.agentId);
    const body = { validUntil: new Date(Date.now() + 86_400_000).toISOString(), channel: "link", reason: meta("publish").reason };
    const invoke = (payload = body) => publishRoute.POST(setup.makeRequest(`/api/agent/quotes/${draft.quoteId}/publish`, {
      method: "POST", cookie, headers: { "idempotency-key": meta("publish").idempotencyKey, "x-correlation-id": meta("publish").correlationId },
      body: payload,
    }), { params: Promise.resolve({ quoteId: String(draft.quoteId) }) });
    const counts = async () => ({
      versions: await db.quoteVersion.count({ where: { quoteId: draft.quoteId, state: "PUBLISHED" } }),
      events: await db.caseEvent.count({ where: { caseId: record.id, eventType: "quote.published.v1" } }),
      completedTasks: await db.task.count({ where: { caseId: record.id, type: "QUOTE_SEND", status: "COMPLETED" } }),
      receipts: await db.projectionReceipt.count({ where: { organizationId: owner.organizationId } }),
      audit: await db.operationalAuditEvent.count({ where: { organizationId: owner.organizationId, idempotencyKey: `quote:publish:${meta("publish").idempotencyKey}` } }),
    });
    const before = await counts();
    const injectedBefore = injectedFailures;
    failAuditKey = `quote:publish:${meta("publish").idempotencyKey}`;
    assert.equal((await invoke()).status, 500);
    assert.equal(injectedFailures, injectedBefore + 1, "Failure must occur after domain and projection writes");
    assert.deepEqual(await counts(), before, "Final audit failure must roll back versions, Case event, task and receipt");
    assert.equal((await db.case.findUniqueOrThrow({ where: { id: record.id } })).stage, "QUOTING");
    assert.equal((await db.quote.findUniqueOrThrow({ where: { id: draft.quoteId } })).status, "IN_REVIEW");
    const trace: Trace = { queries: [], transactions: [], errors: [] };
    await latency(true);
    active = trace;
    let response;
    try {
      response = await invoke();
    } finally { active = null; await latency(false); }
    t.diagnostic(JSON.stringify({ scenario, httpStatus: response.status, sqlStatements: trace.queries.length,
      sql: trace.queries, transactionMs: trace.transactions, errorCodes: trace.errors,
      lockWaitMeasurement: "NOT_MEASURED", unchangedDeadlineMs: 5000, requiredHeadroomMs: 4500 }));
    assert.equal(response.status, 200, "The original publication must succeed without increasing the transaction deadline");
    assert.ok(trace.queries.length > 0, "Real SQL instrumentation must not be vacuous");
    assert.equal(trace.transactions.length, 1);
    assert.ok(trace.transactions[0] < 4500, "Publication must preserve at least500ms transaction headroom");
    const result = await response.json();
    assert.equal(result.replayed, false);
    assert.equal(result.versionNumber, 1);
    const after = await counts();
    assert.deepEqual(after, { versions: 1, events: 1, completedTasks: 1, receipts: before.receipts + 1, audit: 1 });
    const updatedCase = await db.case.findUniqueOrThrow({ where: { id: record.id } });
    assert.equal(updatedCase.stage, "AGREEMENT");
    assert.equal(updatedCase.publishedQuoteVersionId, result.quoteVersionId);
    const replay = await invoke();
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { ...result, replayed: true });
    assert.equal((await invoke({ ...body, reason: "Changed payload" })).status, 409);
    assert.deepEqual(await counts(), after, "Replay and changed-payload conflict cannot duplicate side effects");
  });
}
