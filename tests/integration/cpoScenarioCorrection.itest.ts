import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { before, test } from "node:test";
import { Prisma, PrismaClient, type CaseScenario, type DocumentRequirementRule } from "@prisma/client";
import { PATCH as intake } from "../../app/api/agent/cases/[caseId]/intake/route";
import { getCanonicalCase } from "../../lib/caseReadModel";
import { checkCaseRequirementMaterializationParity, refreshCaseRequirementApplicabilityInTransaction } from "../../lib/documentRequirementService";
import { publishCommercialQuote, saveCommercialDraft, markCommercialQuoteInReview } from "../../lib/commercialQuoteService";
import { uploadCaseDocument } from "../../lib/documentService";
import { serverCommandKey } from "../../lib/commandNamespace";
import { InMemoryTestStorage } from "../fixtures/testStorage";
import { installM3OrganizationBaseline, M3_TEST_DOCUMENT_TYPES } from "./_m3Baseline";
import { createFixtureContext, db, makeRequest, sessionCookieHeader, skip } from "./_setup";

const opts = { skip: skip ? "requires approved isolated local PostgreSQL" : false };
const faultMessage = "CPO_SCENARIO_FINAL_EVENT_ROLLBACK";
type Gate = ReturnType<typeof gate>;
type LockStep = { phase: "publication" | "correction"; table: "Case" | "Quote"; step: "attempt" | "acquired" };
type Trace = { faultCaseId?: string; reached?: Gate; resume?: Gate; phase?: "publication" | "correction"; locks?: LockStep[]; audited?: boolean; corrected?: boolean; errors?: { model?: string; action: string; code: string; sqlState?: unknown; detail?: string }[] };
const traces = new AsyncLocalStorage<Trace>();

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function rawSql(args: unknown): string {
  if (typeof args === "string") return args;
  if (Array.isArray(args)) return args.map(rawSql).join(" ");
  if (args && typeof args === "object") {
    const value = args as { query?: unknown; sql?: unknown; text?: unknown; strings?: unknown };
    return rawSql(value.query ?? value.sql ?? value.text ?? value.strings);
  }
  return "";
}

before(() => {
  if (skip) return;
  // File-local middleware and request-local gates; no production test hook.
  db.$use(async (params, next) => {
    const trace = traces.getStore();
    const args = params.args as { data?: { caseId?: string; eventType?: string; state?: string; action?: string } } | undefined;
    const sql = params.action === "queryRaw" ? rawSql(params.args) : "";
    const lockTable = /FOR UPDATE/i.test(sql) ? /FROM\s+"Case"/i.test(sql) ? "Case" : /FROM\s+"Quote"/i.test(sql) ? "Quote" : null : null;
    if (trace?.phase && lockTable) {
      trace.locks?.push({ phase: trace.phase, table: lockTable, step: "attempt" });
      if (trace.phase === "correction" && lockTable === "Case") trace.reached!.resolve();
    }
    if (trace?.phase === "publication" && params.model === "QuoteVersion" && params.action === "update" && args?.data?.state === "PUBLISHED") {
      trace.reached!.resolve();
      await trace.resume!.promise;
    }
    let result;
    try { result = await next(params); }
    catch (error) {
      trace?.errors?.push({ model: params.model, action: params.action,
        code: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error instanceof Error ? error.name : "UNKNOWN",
        sqlState: error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.code : undefined,
        detail: error instanceof Error ? error.message : undefined,
      });
      throw error;
    }
    if (trace?.phase && lockTable) trace.locks?.push({ phase: trace.phase, table: lockTable, step: "acquired" });
    if (trace?.faultCaseId && params.model === "OperationalAuditEvent" && args?.data?.action === "document_requirements.scenario_corrected.v1") trace.audited = true;
    if (trace?.faultCaseId && params.model === "CaseEvent" && args?.data?.eventType === "scenario.corrected.v1") trace.corrected = true;
    if (trace?.faultCaseId && params.model === "CaseEvent" && params.action === "create"
      && args?.data?.caseId === trace.faultCaseId && args.data.eventType === "case.intake_saved.v1") throw new Error(faultMessage);
    return result;
  });
});

async function setup(tag: string, conditionalOnly = false, swapIdentityType = false) {
  const fixtures = createFixtureContext(`cpo-scenario-${tag}`);
  try {
    const owner = await fixtures.makeAgent("owner");
    const baseline = await installM3OrganizationBaseline(owner.organizationId);
    baseline.policyIds.forEach(fixtures.trackDocumentPolicy);
    baseline.documentTypeIds.forEach(fixtures.trackDocumentType);
    const record = await fixtures.makeCase(owner, tag);
    const cookie = await sessionCookieHeader(owner.userId, owner.agentId);
    const meta = (action: string) => ({ idempotencyKey: `${fixtures.runId}:${action}`, correlationId: `${fixtures.runId}:trace`, reason: "Synthetic scenario correction" });
    const save = (action: string, ceremonyType = "погребение", reason = "Synthetic scenario correction") => intake(makeRequest(`/api/agent/cases/${record.leadId}/intake`, {
      method: "PATCH", cookie,
      headers: { "idempotency-key": meta(action).idempotencyKey, "x-correlation-id": meta(action).correlationId },
      body: { deceasedName: "Synthetic deceased", ceremonyType, scenarioCorrection: { confirmed: true, reason } },
    }), { params: Promise.resolve({ caseId: String(record.leadId) }) });
    const initial = await save("initial", "кремация");
    assert.equal(initial.status, 200, JSON.stringify(await initial.clone().json()));
    const source = await db.documentRequirementPolicy.findUniqueOrThrow({ where: { id: baseline.burialPolicyId }, include: { rules: true } });
    await db.documentRequirementPolicy.update({ where: { id: source.id }, data: { status: "RETIRED", retiredAt: new Date() } });
    const target = await db.documentRequirementPolicy.create({
      data: {
        organizationId: owner.organizationId, scenario: "FAMILY_PLOT_BURIAL_V1", version: source.version + 1,
        status: "APPROVED", source: "SYNTHETIC_CPO_SCENARIO_TARGET", approvedByUserId: owner.userId,
        approvedAt: new Date("2026-08-11"), effectiveFrom: new Date("2026-08-11"),
        rules: { create: [
          ...source.rules.map((rule) => ({
            ...ruleData(rule), source: "SYNTHETIC_CPO_SCENARIO_TARGET",
            conditionExplanation: `Target ${rule.stableKey}`, reviewChecklist: [`target-${rule.stableKey}`],
            dueOffsetHours: rule.stableKey === "identity-record" ? 48 : null,
            blockingStage: "CLOSED" as const,
            ...(swapIdentityType && rule.stableKey === "identity-record" ? {
              acceptedDocumentTypeCodes: source.rules.find((item) => item.stableKey === "death-record")!.acceptedDocumentTypeCodes as Prisma.InputJsonValue,
              acceptedDocumentTypeVersionIds: source.rules.find((item) => item.stableKey === "death-record")!.acceptedDocumentTypeVersionIds as Prisma.InputJsonValue,
            } : {}),
            ...(conditionalOnly ? { kind: "CONDITIONAL" as const, conditionKey: "HAS_PAYER" } : {}),
          })),
          ...(conditionalOnly ? [{
            stableKey: "additional-closed-evidence", kind: "CONDITIONAL" as const, conditionKey: "HAS_PAYER",
            ownerRole: "DOCUMENT_REVIEWER" as const, blockingStage: "CLOSED" as const,
            acceptedDocumentTypeCodes: [], acceptedDocumentTypeVersionIds: [], reviewChecklist: [], source: "SYNTHETIC_CPO_SCENARIO_TARGET",
          }] : []),
        ] },
      }, include: { rules: true },
    });
    fixtures.trackDocumentPolicy(target.id);
    return { fixtures, owner, record, baseline, target, save, meta };
  } catch (error) {
    try { await fixtures.cleanup(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Scenario setup and cleanup failed"); }
    throw error;
  }
}
type Fixture = Awaited<ReturnType<typeof setup>>;

function ruleData(rule: DocumentRequirementRule) {
  return {
    stableKey: rule.stableKey, kind: rule.kind, conditionKey: rule.conditionKey, conditionExplanation: rule.conditionExplanation,
    dueOffsetHours: rule.dueOffsetHours, ownerRole: rule.ownerRole, blockingStage: rule.blockingStage,
    acceptedDocumentTypeCodes: rule.acceptedDocumentTypeCodes as Prisma.InputJsonValue,
    acceptedDocumentTypeVersionIds: rule.acceptedDocumentTypeVersionIds as Prisma.InputJsonValue,
    reviewChecklist: rule.reviewChecklist as Prisma.InputJsonValue, source: rule.source,
  };
}

async function addRequirement(f: Fixture, rule: DocumentRequirementRule, policyVersion: number) {
  return db.caseDocumentRequirement.create({ data: {
    organizationId: f.owner.organizationId, caseId: f.record.id, policyId: rule.policyId, ruleId: rule.id, policyVersion,
    stableKey: rule.stableKey, kind: rule.kind, conditionExplanation: rule.conditionExplanation,
    dueAt: new Date("2026-01-01"), ownerRole: rule.ownerRole, blockingStage: rule.blockingStage,
    acceptedDocumentTypeCodes: rule.acceptedDocumentTypeCodes as Prisma.InputJsonValue,
    acceptedDocumentTypeVersionIds: rule.acceptedDocumentTypeVersionIds as Prisma.InputJsonValue,
    reviewChecklist: rule.reviewChecklist as Prisma.InputJsonValue, sourceRule: rule.source, isApplicable: true,
  } });
}

async function historical(f: Fixture, version: number, scenario: CaseScenario = "CREMATION_V1") {
  const template = f.target.rules.find((rule) => rule.stableKey === "identity-record")!;
  const policy = await db.documentRequirementPolicy.create({ data: {
    organizationId: f.owner.organizationId, scenario, version, status: "RETIRED",
    source: "SYNTHETIC_CPO_SCENARIO_HISTORY", effectiveFrom: new Date("2026-01-01"), retiredAt: new Date("2026-02-01"),
    rules: { create: { ...ruleData(template), source: "SYNTHETIC_CPO_SCENARIO_HISTORY" } },
  }, include: { rules: true } });
  f.fixtures.trackDocumentPolicy(policy.id);
  return addRequirement(f, policy.rules[0], version);
}

async function snapshot(f: Fixture) {
  return {
    record: await db.case.findUniqueOrThrow({ where: { id: f.record.id } }),
    lead: await db.clientLead.findUniqueOrThrow({ where: { id: f.record.leadId } }),
    requirements: await db.caseDocumentRequirement.findMany({ where: { caseId: f.record.id }, orderBy: { id: "asc" } }),
    events: await db.caseEvent.findMany({ where: { caseId: f.record.id }, orderBy: { id: "asc" } }),
    audits: await db.operationalAuditEvent.findMany({ where: { organizationId: f.owner.organizationId }, orderBy: { id: "asc" } }),
    tasks: await db.task.findMany({ where: { caseId: f.record.id }, orderBy: { id: "asc" } }),
    projections: await db.projectionReceipt.findMany({ where: { organizationId: f.owner.organizationId }, orderBy: { id: "asc" } }),
    quotes: await db.quote.findMany({ where: { caseId: f.record.id }, include: { versions: true }, orderBy: { id: "asc" } }),
    documents: await db.caseDocumentVersion.findMany({ where: { caseId: f.record.id }, orderBy: { id: "asc" } }),
    contracts: await db.contractVersion.findMany({ where: { caseId: f.record.id }, orderBy: { id: "asc" } }),
    obligations: await db.paymentObligation.findMany({ where: { caseId: f.record.id }, orderBy: { id: "asc" } }),
  };
}

async function cleanup(f: Fixture) { await f.fixtures.cleanup(); await f.fixtures.assertNoResidue(); }

test("CPO scenario: historical common-key collision selects highest version, preserves inactive history, updates deadlines and audits", opts, async () => {
  const f = await setup("historical");
  try {
    const low = await historical(f, 1);
    const high = await historical(f, 2);
    const before = await snapshot(f);
    const selected = before.requirements.find((row) => row.stableKey === "identity-record" && row.policyId === f.baseline.cremationPolicyId)!;
    await db.caseDocumentRequirement.updateMany({ where: { caseId: f.record.id, stableKey: { in: ["identity-record", "death-record"] } }, data: { dueAt: new Date("2026-01-01") } });
    const beforeCorrection = await snapshot(f);
    const earliest = Date.now();
    const response = await f.save("correct");
    const latest = Date.now();
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const after = await snapshot(f);
    const identity = after.requirements.find((row) => row.id === selected.id)!;
    const rule = f.target.rules.find((row) => row.stableKey === "identity-record")!;
    assert.equal(identity.ruleId, rule.id);
    assert.equal(identity.policyId, f.target.id);
    assert.equal(identity.policyVersion, f.target.version);
    assert.equal(identity.supersededAt, null);
    assert.equal(identity.blockingStage, rule.blockingStage);
    assert.equal(identity.conditionExplanation, rule.conditionExplanation);
    assert.deepEqual(identity.reviewChecklist, rule.reviewChecklist);
    assert.deepEqual(identity.acceptedDocumentTypeCodes, rule.acceptedDocumentTypeCodes);
    assert.deepEqual(identity.acceptedDocumentTypeVersionIds, rule.acceptedDocumentTypeVersionIds);
    assert.equal(identity.sourceRule, rule.source);
    assert.ok(identity.dueAt && identity.dueAt.getTime() >= earliest + 48 * 3_600_000 && identity.dueAt.getTime() <= latest + 48 * 3_600_000);
    assert.equal(after.requirements.find((row) => row.stableKey === "death-record" && row.policyId === f.target.id)!.dueAt, null);
    for (const old of [low, high]) {
      const retained = after.requirements.find((row) => row.id === old.id)!;
      assert.ok(retained.supersededAt instanceof Date);
      assert.ok(retained.supersededAt.getTime() >= earliest && retained.supersededAt.getTime() <= latest);
      assert.deepEqual(retained, { ...old, isApplicable: false, supersededAt: retained.supersededAt,
        applicabilityEvaluatedAt: retained.applicabilityEvaluatedAt, updatedAt: retained.updatedAt });
      assert.equal(retained.isApplicable, false);
    }
    assert.equal(after.requirements.filter((row) => row.ruleId === rule.id).length, 1);
    assert.equal((await checkCaseRequirementMaterializationParity(db, f.owner.organizationId, f.record.id, "FAMILY_PLOT_BURIAL_V1")).ok, true);
    const audit = after.audits.find((row) => row.idempotencyKey === serverCommandKey("scenario-correction-audit", f.meta("correct").idempotencyKey))!;
    assert.ok(audit);
    assert.equal(audit.actorMembershipId, f.owner.membershipId);
    assert.equal(audit.reason, "Synthetic scenario correction");
    assert.equal(audit.correlationId, f.meta("correct").correlationId);
    const auditBefore = audit.before as { scenarioId: string; requirements: unknown[] };
    assert.equal(auditBefore.scenarioId, "CREMATION_V1");
    assert.deepEqual(JSON.parse(JSON.stringify(auditBefore.requirements)).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)), JSON.parse(JSON.stringify(beforeCorrection.requirements)));
    assert.equal((audit.after as { policyId: string }).policyId, f.target.id);
    assert.equal(after.events.filter((row) => row.eventType === "scenario.corrected.v1").length, 1);
    assert.equal((await f.save("correct")).status, 200);
    assert.deepEqual(await snapshot(f), after);
  } finally { await cleanup(f); }
});

test("CPO scenario: existing target-rule row wins over a higher-version historical common key", opts, async () => {
  const f = await setup("target-preference");
  try {
    const targetRule = f.target.rules.find((rule) => rule.stableKey === "identity-record")!;
    const existingTarget = await addRequirement(f, targetRule, f.target.version);
    const higherHistory = await historical(f, f.target.version + 1);
    const retiredTargetHistory = await historical(f, 3, "FAMILY_PLOT_BURIAL_V1");
    const earliest = Date.now();
    const response = await f.save("correct");
    const latest = Date.now();
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const requirements = (await snapshot(f)).requirements;
    assert.equal(requirements.find((row) => row.id === existingTarget.id)!.ruleId, targetRule.id);
    assert.equal(requirements.find((row) => row.id === existingTarget.id)!.supersededAt, null);
    assert.equal(requirements.find((row) => row.id === higherHistory.id)!.ruleId, higherHistory.ruleId);
    assert.equal(requirements.find((row) => row.id === higherHistory.id)!.isApplicable, false);
    assert.equal(requirements.find((row) => row.id === retiredTargetHistory.id)!.isApplicable, false);
    for (const old of [higherHistory, retiredTargetHistory]) {
      const retained = requirements.find((row) => row.id === old.id)!;
      assert.ok(retained.supersededAt instanceof Date);
      assert.ok(retained.supersededAt.getTime() >= earliest && retained.supersededAt.getTime() <= latest);
    }
    assert.equal(requirements.filter((row) => row.ruleId === targetRule.id).length, 1);
    assert.equal((await checkCaseRequirementMaterializationParity(db, f.owner.organizationId, f.record.id, "FAMILY_PLOT_BURIAL_V1")).ok, true);
    assert.equal((await f.save("unchanged")).status, 200);
    const refreshed = (await snapshot(f)).requirements;
    for (const old of [higherHistory, retiredTargetHistory]) {
      assert.deepEqual(refreshed.find((row) => row.id === old.id), requirements.find((row) => row.id === old.id));
    }
  } finally { await cleanup(f); }
});

test("CPO scenario: final-event fault rolls back lead, scenario, metadata, deadlines, quote and audits; retry succeeds", opts, async () => {
  const f = await setup("rollback");
  try {
    await historical(f, 1);
    await prepareQuote(f);
    const before = await snapshot(f);
    const trace: Trace = { faultCaseId: f.record.id };
    const response = await traces.run(trace, () => f.save("correct"));
    assert.equal(response.status, 500);
    assert.equal(trace.audited, true);
    assert.equal(trace.corrected, true);
    assert.deepEqual(await snapshot(f), before);
    const retried = await f.save("correct");
    assert.equal(retried.status, 200, JSON.stringify(await retried.clone().json()));
    assert.equal((await retried.json()).replayed, false);
    assert.equal((await snapshot(f)).events.filter((row) => row.eventType === "scenario.corrected.v1").length, 1);
  } finally { await cleanup(f); }
});

test("CPO scenario: same-key changed-payload race is one success and one 409, never a replay of different input", opts, async () => {
  const f = await setup("changed-payload");
  try {
    const responses = await Promise.all([f.save("same-key", "погребение", "First approved reason"), f.save("same-key", "погребение", "Different approved reason")]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal((await snapshot(f)).events.filter((row) => row.eventType === "scenario.corrected.v1").length, 1);
  } finally { await cleanup(f); }
});

test("CPO-11 PG read model: missing CLOSED row blocks readiness despite all remaining rules being inapplicable", opts, async () => {
  const f = await setup("read-parity", true);
  try {
    assert.equal((await f.save("correct")).status, 200);
    await db.case.update({ where: { id: f.record.id }, data: { stage: "EXECUTION" } });
    const complete = await getCanonicalCase(f.owner.context, f.record.leadId);
    assert.ok(complete);
    assert.equal(complete.documents.ready, true);
    assert.equal(complete.guardState.documents_ready_for_closure, true);
    const closed = await db.caseDocumentRequirement.findFirstOrThrow({ where: { caseId: f.record.id, stableKey: "additional-closed-evidence" } });
    await db.caseDocumentRequirement.delete({ where: { id: closed.id } });
    const missing = await getCanonicalCase(f.owner.context, f.record.leadId);
    assert.ok(missing);
    assert.equal(missing.documents.ready, false);
    assert.equal(missing.guardState.documents_ready_for_closure, false);
    assert.equal(missing.risk.reasons.some((reason) => reason.code === "MISSING_BLOCKER"), true);
  } finally { await cleanup(f); }
});

test("CPO scenario: unchanged intake preserves a pinned retired policy despite a newer approved policy", opts, async () => {
  const f = await setup("pinned-retired-policy");
  try {
    const pinned = await db.documentRequirementPolicy.findUniqueOrThrow({ where: { id: f.baseline.cremationPolicyId }, include: { rules: true } });
    const before = (await snapshot(f)).requirements;
    await db.documentRequirementPolicy.update({ where: { id: pinned.id }, data: { status: "RETIRED", retiredAt: new Date() } });
    const newer = await db.documentRequirementPolicy.create({ data: {
      organizationId: f.owner.organizationId, scenario: "CREMATION_V1", version: pinned.version + 1,
      status: "APPROVED", source: "SYNTHETIC_CPO_NEWER_POLICY", approvedByUserId: f.owner.userId,
      approvedAt: new Date(), effectiveFrom: new Date(),
      rules: { create: pinned.rules.map((rule) => ({ ...ruleData(rule), source: "SYNTHETIC_CPO_NEWER_POLICY" })) },
    } });
    f.fixtures.trackDocumentPolicy(newer.id);
    const response = await f.save("same-scenario", "кремация");
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const after = (await snapshot(f)).requirements;
    assert.deepEqual(after, before);
    assert.ok(after.every((requirement) => requirement.policyId === pinned.id && requirement.supersededAt === null));
    assert.equal((await checkCaseRequirementMaterializationParity(db, f.owner.organizationId, f.record.id, "CREMATION_V1")).ok, true);
  } finally { await cleanup(f); }
});

test("CPO scenario: unchanged applicability refresh preserves the pre-correction SQL round-trip budget", opts, async (t) => {
  const f = await setup("unchanged-sql");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  const selects: string[] = [];
  client.$on("query", (event) => { if (/^SELECT\b/i.test(event.query.trim())) selects.push(event.query); });
  try {
    // Measure the previous requirement/rule relation shape on the same fixture.
    // Its one joined facts read is unchanged, so reserve that same single read.
    await client.caseDocumentRequirement.findMany({ where: { caseId: f.record.id, organizationId: f.owner.organizationId }, select: {
      id: true, stableKey: true, kind: true, isApplicable: true, rule: { select: { conditionKey: true } },
    } });
    const priorBudget = selects.length + 1;
    selects.length = 0;
    await client.$transaction((tx) => refreshCaseRequirementApplicabilityInTransaction(tx, f.owner.context, f.record.id, f.meta("unchanged")));
    t.diagnostic(`SELECT round trips: previous shape + facts = ${priorBudget}; current refresh = ${selects.length}`);
    assert.ok(selects.length <= priorBudget, `Unchanged intake gained ${selects.length - priorBudget} SELECT round trip(s)`);
  } finally { await client.$disconnect(); await cleanup(f); }
});

async function prepareQuote(f: Fixture) {
  const meeting = await db.meeting.create({ data: {
    leadId: f.record.leadId, agentId: f.owner.agentId, organizationId: f.owner.organizationId, caseId: f.record.id,
    ownerMembershipId: f.owner.membershipId, operationalStatus: "COMPLETED", idempotencyKey: f.meta("meeting").idempotencyKey,
  } });
  const draft = await saveCommercialDraft({ meetingId: meeting.id, scenario: "CREMATION_V1", context: f.owner.context, meta: f.meta("draft"), lines: [{
    stableKey: "synthetic-service", position: 0, type: "SERVICE", serviceCode: "synthetic-service", description: "Synthetic service",
    quantity: 1, unit: "service", priceState: "KNOWN", clientUnitPrice: 125_000, costState: "KNOWN", unitCost: 80_000,
    discountAmount: 0, included: false, optional: false, relationKind: "STANDALONE", source: "integration-catalog", sourceVersion: "1",
    scenarioCompatibility: ["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"],
  }] });
  await markCommercialQuoteInReview({ quoteId: draft.quoteId, context: f.owner.context, meta: f.meta("review") });
  return { draft, publish: () => publishCommercialQuote({ quoteId: draft.quoteId, context: f.owner.context, meta: f.meta("publish"), validUntil: new Date(Date.now() + 86_400_000), channel: "link" }) };
}

test("CPO scenario: persisted document consequence rejects correction without touching history", opts, async () => {
  const f = await setup("document-consequence");
  try {
    const requirement = await db.caseDocumentRequirement.findFirstOrThrow({ where: { caseId: f.record.id, stableKey: "identity-record" } });
    await uploadCaseDocument(f.owner.context, { caseId: f.record.id, requirementId: requirement.id, documentTypeCode: M3_TEST_DOCUMENT_TYPES.identity,
      file: new File(["%PDF-1.4\nSynthetic CPO consequence\n%%EOF"], "synthetic.pdf", { type: "application/pdf" }) }, f.meta("upload"), {
      storage: new InMemoryTestStorage(), scanner: { isOperational: () => true, scan: async () => ({ status: "CLEAN", provider: "synthetic-test", resultCode: "CLEAN" }) },
    });
    const before = await snapshot(f);
    assert.equal(before.documents.length, 1);
    assert.equal((await f.save("correct")).status, 422);
    assert.deepEqual(await snapshot(f), before);
  } finally { await cleanup(f); }
});

test("CPO scenario: upload preflight cannot carry an old accepted type across correction", { ...opts, timeout: 30_000 }, async () => {
  const f = await setup("upload-preflight-race", false, true);
  const reached = gate(); const resume = gate();
  let pending: Promise<unknown> | undefined;
  class PausedStorage extends InMemoryTestStorage {
    override async putPrivate(key: string, file: File) {
      reached.resolve();
      await resume.promise;
      return super.putPrivate(key, file);
    }
  }
  const storage = new PausedStorage();
  try {
    const requirement = await db.caseDocumentRequirement.findFirstOrThrow({ where: { caseId: f.record.id, stableKey: "identity-record" } });
    const upload = uploadCaseDocument(f.owner.context, {
      caseId: f.record.id, requirementId: requirement.id, documentTypeCode: M3_TEST_DOCUMENT_TYPES.identity,
      file: new File(["%PDF-1.4\nSynthetic preflight race\n%%EOF"], "synthetic.pdf", { type: "application/pdf" }),
    }, f.meta("upload"), { storage, scanner: { isOperational: () => true, scan: async () => ({ status: "CLEAN", provider: "synthetic-test", resultCode: "CLEAN" }) } });
    const outcome = upload.then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    pending = outcome;
    await Promise.race([reached.promise, outcome.then(() => { throw new Error("Upload settled before preflight gate"); })]);
    assert.equal((await f.save("correct")).status, 200);
    resume.resolve();
    const result = await outcome;
    assert.equal(result.value, null);
    assert.equal((result.error as { status?: number }).status, 409);
    assert.equal(await db.caseDocumentVersion.count({ where: { caseId: f.record.id } }), 0);
    assert.equal(storage.size, 0);
  } finally { resume.resolve(); await pending; await cleanup(f); }
});

for (const state of ["PUBLISHED", "SUPERSEDED"] as const) test(`CPO scenario: ${state} history rejects correction even with a QUOTING fixture stage`, opts, async () => {
  const f = await setup(`${state.toLowerCase()}-consequence`);
  try {
    const quote = await prepareQuote(f);
    const published = await quote.publish();
    if (state === "SUPERSEDED") await db.quoteVersion.update({ where: { id: published.quoteVersionId }, data: { state } });
    // Isolate the history predicate rather than merely testing the later-stage gate.
    await db.case.update({ where: { id: f.record.id }, data: { stage: "QUOTING" } });
    const before = await snapshot(f);
    assert.equal((await f.save("correct")).status, 422);
    assert.deepEqual(await snapshot(f), before);
  } finally { await cleanup(f); }
});

for (const obligation of [false, true]) test(`CPO scenario: persisted draft contract${obligation ? " and obligation" : ""} rejects correction without rewriting history`, opts, async () => {
  const f = await setup(obligation ? "obligation-consequence" : "contract-consequence");
  try {
    const { draft } = await prepareQuote(f);
    const contract = await db.contract.create({ data: {
      organizationId: f.owner.organizationId, caseId: f.record.id, createdByMembershipId: f.owner.membershipId,
    } });
    const version = await db.contractVersion.create({ data: {
      contractId: contract.id, organizationId: f.owner.organizationId, caseId: f.record.id, quoteVersionId: draft.draftVersionId,
      versionNumber: 1, status: "DRAFT", partiesSnapshot: {}, totalObligationKopecks: 125_000, paymentTerms: {},
      issuedByMembershipId: f.owner.membershipId, checksum: "a".repeat(64),
      idempotencyKey: f.meta("contract").idempotencyKey, correlationId: f.meta("contract").correlationId,
    } });
    // Synthetic fixture isolates the consequence predicate; a real obligation
    // would additionally require accepted quote and signed-contract evidence.
    if (obligation) await db.paymentObligation.create({ data: {
      organizationId: f.owner.organizationId, caseId: f.record.id, contractVersionId: version.id,
      amountKopecks: 125_000, createdByMembershipId: f.owner.membershipId,
      idempotencyKey: f.meta("obligation").idempotencyKey, correlationId: f.meta("obligation").correlationId,
    } });
    const before = await snapshot(f);
    assert.equal((await f.save("correct")).status, 422);
    assert.deepEqual(await snapshot(f), before);
  } finally { await cleanup(f); }
});

test("CPO scenario: publication/correction lock overlap preserves one canonical scenario and immutable history", { ...opts, timeout: 30_000 }, async () => {
  const f = await setup("publication-race");
  const publicationReached = gate(); const resumePublication = gate(); const correctionReached = gate();
  const pending: Promise<unknown>[] = [];
  const errors: NonNullable<Trace["errors"]> = [];
  const locks: LockStep[] = [];
  try {
    const quote = await prepareQuote(f);
    const publication = traces.run({ phase: "publication", reached: publicationReached, resume: resumePublication, errors, locks }, quote.publish);
    // Attach rejection handling immediately while the opposite lock is acquired.
    const publicationOutcome = publication.then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    pending.push(publicationOutcome);
    await Promise.race([publicationReached.promise, publicationOutcome.then(() => { throw new Error("Publication settled before reaching the race gate"); })]);
    const publicationCase = locks.findIndex((lock) => lock.phase === "publication" && lock.table === "Case" && lock.step === "acquired");
    const publicationQuote = locks.findIndex((lock) => lock.phase === "publication" && lock.table === "Quote" && lock.step === "acquired");
    assert.ok(publicationCase >= 0 && publicationQuote > publicationCase, `Publication must acquire Case before Quote: ${JSON.stringify(locks)}`);
    const correction = traces.run({ phase: "correction", reached: correctionReached, errors, locks }, () => f.save("correct"));
    pending.push(correction);
    await Promise.race([correctionReached.promise, correction.then((response) => { throw new Error(`Correction settled before Case lock attempt: ${response.status}`); })]);
    assert.equal(locks.at(-1)?.phase, "correction");
    assert.equal(locks.at(-1)?.table, "Case");
    assert.equal(locks.at(-1)?.step, "attempt");
    resumePublication.resolve();
    const [published, corrected] = await Promise.all([publicationOutcome, correction]);
    assert.equal(published.error, null, `Publication holding Case first must commit: ${JSON.stringify(errors)}`);
    assert.equal(corrected.status, 422, `Correction must see committed publication: ${JSON.stringify(errors)}`);
    const state = await snapshot(f);
    const versions = state.quotes.flatMap((q) => q.versions).filter((version) => version.state === "PUBLISHED");
    assert.equal(state.record.scenarioId, "CREMATION_V1");
    assert.equal(versions.length, 1);
    assert.equal(state.events.filter((event) => event.eventType === "scenario.corrected.v1").length, 0);
    const beforeReplay = await snapshot(f);
    assert.equal((await f.save("after-publication")).status, 422);
    assert.deepEqual(await snapshot(f), beforeReplay);
  } finally { resumePublication.resolve(); await Promise.allSettled(pending); await cleanup(f); }
});
