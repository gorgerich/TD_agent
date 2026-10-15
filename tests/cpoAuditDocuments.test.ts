import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import ts from "typescript";
import * as commands from "../lib/m3Command";
import * as scannerModule from "../lib/documentScanner";
import * as domain from "../lib/m3Domain";
import * as namespace from "../lib/commandNamespace";
import { OperationalCommandError } from "../lib/operationalTransaction";
import type { OperationalContext } from "../lib/operationalAuth";
import type { DocumentScanner } from "../lib/documentScanner";
import type { appendOperationalAudit } from "../lib/operationalAudit";

type Audit = Parameters<typeof appendOperationalAudit>[2];
type Where = Record<string, unknown>;
type Query = { where: Where; orderBy?: unknown };
type MockTask = { id: number; status: string; waitingReason: string; assigneeMembershipId: string; priority?: string };
type Satisfaction = { satisfactionStatus: string; satisfiedByVersionId: string | null };
type MockVersion = {
  id: string; documentId: string; caseId: string; organizationId: string; requirementId: string; versionNumber: number;
  status: string; scanStatus: string; uploaderMembershipId: string; uploader: { userId: number };
  assignedReviewerMembershipId: string | null; expiresAt: Date | null; storageKey: string; storageEtag: string;
  size: number; mimeType: string; fileChecksum: string; requirement: { reviewChecklist: string[]; dueAt: Date | null };
  document: { documentType: { code: string } }; case: { leadId: number; ownerId: number };
};

const source = readFileSync(new URL("../lib/documentService.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const agent = { userId: 1, agentId: 1, membershipId: "uploader", organizationId: "tenant", role: "AGENT", timezone: "UTC" } as OperationalContext;
const reviewer = { ...agent, userId: 2, membershipId: "reviewer", role: "DOCUMENT_REVIEWER" } as OperationalContext;
const meta = (key: string) => ({ idempotencyKey: `cpo-documents:${key}`, correlationId: key });
const pdf = new File(["%PDF-1.7\nfixture"], "identity.pdf", { type: "application/pdf" });

// Execute the actual service with inert in-memory boundaries. No credentials, DB or blob calls.
function harness(serviceCode = compiled) {
  const bytes = new TextEncoder().encode("%PDF-1.7\nfixture");
  const audits: Audit[] = [];
  const versions: MockVersion[] = [];
  let documentStatus = "REQUIRED";
  let satisfaction: Satisfaction | null = null;
  let task: MockTask | null = null;
  let owner: { id: string } | null = { id: "owner" };
  let puts = 0;
  let writes = 0;
  const requirement = { id: "req", isApplicable: true, supersededAt: null as Date | null, acceptedDocumentTypeCodes: ["IDENTITY"], acceptedDocumentTypeVersionIds: ["type"] };
  const base = (id = "v1", status = "UPLOADED", uploaderUserId = 1): MockVersion => ({
    id, documentId: "doc", caseId: "case", organizationId: "tenant", requirementId: "req", versionNumber: versions.length + 1,
    status, scanStatus: "CLEAN", uploaderMembershipId: "uploader", uploader: { userId: uploaderUserId },
    assignedReviewerMembershipId: status === "IN_REVIEW" ? reviewer.membershipId : null,
    expiresAt: null, storageKey: id, storageEtag: "etag", size: bytes.length, mimeType: "application/pdf",
    fileChecksum: crypto.createHash("sha256").update(bytes).digest("hex"),
    requirement: { reviewChecklist: ["readable"], dueAt: null },
    document: { documentType: { code: "IDENTITY" } }, case: { leadId: 1, ownerId: 1 },
  });
  function match(row: MockVersion, where: Where): boolean {
    return Object.entries(where ?? {}).every(([key, value]) => {
      if (key === "uploader") return row.uploader.userId !== (value as { userId: { not: number } }).userId.not;
      if (key === "case") return row.case.ownerId === (value as { ownerId: number }).ownerId;
      const field = row[key as keyof MockVersion];
      if (value && typeof value === "object") {
        if ("gt" in value) return Number(field) > Number(value.gt);
        if ("lt" in value) return Number(field) < Number(value.lt);
        if ("in" in value) return (value.in as unknown[]).includes(field);
        if ("not" in value) return field !== value.not;
      }
      return field === value;
    });
  }
  const db = {
    $queryRaw: async () => [{ id: "case" }],
    operationalAuditEvent: { findUnique: async ({ where }: { where: { organizationId_idempotencyKey: { idempotencyKey: string } } }) => audits.find((a) => a.idempotencyKey === where.organizationId_idempotencyKey.idempotencyKey) ?? null },
    caseDocumentRequirement: {
      findFirst: async ({ where }: Query) => where.supersededAt === null && requirement.supersededAt !== null ? null : requirement,
      update: async ({ data }: { data: Satisfaction }) => { writes++; satisfaction = data; },
    },
    documentTypeDefinition: { findFirst: async () => ({ id: "type", version: 1, allowedMimeTypes: ["application/pdf"], maxBytes: 10 * 1024 * 1024 }) },
    caseDocument: {
      upsert: async () => { writes++; return { id: "doc" }; },
      update: async ({ data }: { data: { status: string } }) => { writes++; documentStatus = data.status; },
    },
    caseDocumentVersion: {
      findFirst: async ({ where, orderBy }: Query) => {
        const result = versions.filter((row) => match(row, where));
        if (orderBy) result.sort((a, b) => b.versionNumber - a.versionNumber);
        return result[0] ?? null;
      },
      findMany: async ({ where }: Query) => versions.filter((row) => match(row, where)).sort((a, b) => b.versionNumber - a.versionNumber),
      create: async ({ data }: { data: Partial<MockVersion> }) => { writes++; const row = { ...base(`v${versions.length + 1}`), ...data }; versions.push(row); return row; },
      update: async ({ where, data }: Query & { data: Partial<MockVersion> }) => { writes++; const row = versions.find((v) => v.id === where.id); assert.ok(row); Object.assign(row, data); },
      updateMany: async ({ where, data }: Query & { data: Partial<MockVersion> }) => { const rows = versions.filter((row) => match(row, where)); rows.forEach((row) => Object.assign(row, data)); writes += rows.length; return { count: rows.length }; },
    },
    membership: { findFirst: async () => owner },
    task: {
      findUnique: async () => task,
      upsert: async ({ update, create }: { update: Partial<MockTask>; create: Omit<MockTask, "id"> }) => { writes++; task = task ? { ...task, ...update } : { id: 17, ...create }; return task; },
    },
  };
  const storage = {
    isConfigured: () => true,
    putPrivate: async (storageKey: string) => { puts++; return { storageKey, etag: "etag" }; },
    readPrivate: async () => ({ stream: new Blob([bytes]).stream(), etag: "etag", size: bytes.length, contentType: "application/pdf" }),
    discardUncommitted: async () => {},
  };
  const scanner: DocumentScanner = { isOperational: () => true, scan: async () => ({ status: "CLEAN", provider: "unit-only", resultCode: "FIXTURE" }) };
  const modules: Record<string, unknown> = {
    "node:crypto": crypto, "@/lib/prisma": { prisma: db }, "@/lib/crypto": { encryptField: (v: string) => v },
    "@/lib/documentScanner": { ...scannerModule, getDocumentScanner: () => scanner },
    "@/lib/documentStorage": { getDocumentStorage: () => storage },
    "@/lib/operationalAudit": { appendOperationalAudit: async (_tx: unknown, _ctx: unknown, audit: Audit) => { audits.push(audit); }, findOperationalReplay: async (_tx: unknown, _org: string, key: string) => audits.find((a) => a.idempotencyKey === key) ?? null },
    "@/lib/operationalAuth": { assertCapability: (context: OperationalContext, capability: string) => {
      if (capability === "documents:upload" && !["AGENT", "MANAGER"].includes(context.role)) throw new OperationalCommandError(403, "forbidden");
      if (capability === "documents:review" && context.role !== "DOCUMENT_REVIEWER") throw new OperationalCommandError(403, "forbidden");
    } },
    "@/lib/operationalTransaction": { OperationalCommandError, runOperationalTransaction: async (work: (tx: typeof db) => Promise<unknown>) => work(db) },
    "@/lib/m3Command": { ...commands, requireTenantCase: async () => ({ id: "case" }) },
    "@/lib/caseFulfilment": { advanceCaseFulfilment: async () => {} },
    "@/lib/documentRequirementService": { refreshCaseRequirementApplicabilityInTransaction: async () => {} },
    "@/lib/m3Domain": domain, "@/lib/commandNamespace": namespace,
  };
  const mod = { exports: {} as typeof import("../lib/documentService") };
  new Function("require", "module", "exports", serviceCode)((key: string) => {
    assert.ok(key in modules, `unexpected dependency ${key}`); return modules[key];
  }, mod, mod.exports);
  return { service: mod.exports, storage, scanner, versions, audits, base, requirement,
    get puts() { return puts; }, get writes() { return writes; }, get documentStatus() { return documentStatus; }, get satisfaction() { return satisfaction; },
    setTask: (value: MockTask) => { task = value; }, get task() { return task; }, setOwner: (value: { id: string } | null) => { owner = value; } };
}

test("CPO04 unavailable scanner fails before any blob/database write", async () => {
  const h = harness();
  await assert.rejects(h.service.uploadCaseDocument(agent, { caseId: "case", requirementId: "req", documentTypeCode: "IDENTITY", file: pdf }, meta("unavailable"), {
    storage: h.storage, scanner: { ...h.scanner, isOperational: () => false },
  }), { status: 503, code: "DOCUMENT_SCANNER_UNAVAILABLE" });
  assert.equal(h.puts, 0); assert.equal(h.writes, 0); assert.equal(h.audits.length, 0);
});

test("CPO04 signature validation rejects spoofed body before storage", async () => {
  const h = harness();
  await assert.rejects(h.service.uploadCaseDocument(agent, { caseId: "case", requirementId: "req", documentTypeCode: "IDENTITY", file: new File(["not pdf"], "fake.pdf", { type: "application/pdf" }) }, meta("spoof")), { code: "DOCUMENT_MIME_MISMATCH" });
  assert.equal(h.puts, 0); assert.equal(h.writes, 0);
});

test("CPO04 upload revalidates both accepted codes and pinned type IDs after scan", async () => {
  for (const field of ["acceptedDocumentTypeCodes", "acceptedDocumentTypeVersionIds"] as const) {
    const h = harness();
    const changingScanner: DocumentScanner = { ...h.scanner, scan: async (input) => {
      h.requirement[field] = ["changed-policy-value"];
      return h.scanner.scan(input);
    } };
    await assert.rejects(h.service.uploadCaseDocument(agent, { caseId: "case", requirementId: "req", documentTypeCode: "IDENTITY", file: pdf }, meta(`policy-race:${field}`), { storage: h.storage, scanner: changingScanner }), { status: 409, code: "DOCUMENT_UPLOAD_POLICY_CHANGED" });
    assert.equal(h.writes, 0); assert.equal(h.versions.length, 0);
  }
});

test("CPO04 superseded history cannot upload even with isApplicable reactivated, before or during scan", async () => {
  for (const phase of ["preflight", "commit"]) {
    const h = harness();
    if (phase === "preflight") h.requirement.supersededAt = new Date();
    const scanner: DocumentScanner = { ...h.scanner, scan: async (input) => {
      h.requirement.supersededAt = new Date();
      return h.scanner.scan(input);
    } };
    await assert.rejects(h.service.uploadCaseDocument(agent, { caseId: "case", requirementId: "req", documentTypeCode: "IDENTITY", file: pdf }, meta(`superseded:${phase}`), { storage: h.storage, scanner }), { status: 404 });
    assert.equal(h.requirement.isApplicable, true);
    assert.equal(h.puts, phase === "preflight" ? 0 : 1);
    assert.equal(h.writes, 0); assert.equal(h.versions.length, 0);
  }
});

test("CPO04 scanner throw/malformed output stays quarantined; VERIFIED survives upload", async () => {
  for (const scan of [async () => { throw new Error("offline"); }, async () => ({ status: "CLEAN" }), async () => ({ status: "INFECTED", provider: "unit-only", resultCode: "FIXTURE" })]) {
    const h = harness(); h.versions.push(h.base("verified", "VERIFIED"));
    const result = await h.service.uploadCaseDocument(agent, { caseId: "case", requirementId: "req", documentTypeCode: "IDENTITY", file: pdf }, meta("replacement"), { storage: h.storage, scanner: { isOperational: () => true, scan } as unknown as DocumentScanner });
    assert.equal(result.status, "QUARANTINED"); assert.notEqual(result.scanStatus, "CLEAN");
    assert.equal(h.versions[0].status, "VERIFIED"); assert.equal(h.documentStatus, "VERIFIED");
    assert.deepEqual(h.satisfaction, { satisfactionStatus: "SATISFIED", satisfiedByVersionId: "verified" });
    assert.equal(h.audits.some((a) => a.action === "document.version_superseded.v1"), false);
  }
});

test("CPO07 self-review rejects same user under a different membership on start and decision", async () => {
  const self = { ...reviewer, userId: agent.userId, membershipId: "new-membership" };
  const h = harness(); h.versions.push({ ...h.base("v1"), assignedReviewerMembershipId: null });
  await assert.rejects(h.service.beginDocumentReview(self, "v1", meta("self-start")), { status: 403 });
  h.versions[0].status = "IN_REVIEW"; h.versions[0].assignedReviewerMembershipId = self.membershipId;
  for (const decision of ["VERIFIED", "REJECTED"] as const) {
    await assert.rejects(h.service.decideDocumentReview(self, "v1", { decision, checklist: { readable: true }, reason: "reason" }, meta(`self-${decision}`), h.storage), { status: 403 });
  }
  assert.equal(h.writes, 0);
});

test("CPO07 queue excludes own user and non-CLEAN versions", async () => {
  const h = harness();
  h.versions.push(h.base("other", "UPLOADED", 1), h.base("own", "UPLOADED", 2), { ...h.base("unsafe", "UPLOADED", 1), scanStatus: "ERROR" });
  assert.deepEqual((await h.service.listDocumentReviewQueue(reviewer)).map((v) => v.id), ["other"]);
});

test("CPO07 expiry rejects invalid, present and past dates before mutation", async () => {
  for (const expiresAt of [new Date("invalid"), new Date(0), new Date(Date.now() - 1)]) {
    const h = harness();
    h.versions.push(h.base("v1", "IN_REVIEW"));
    await assert.rejects(h.service.decideDocumentReview(reviewer, "v1", { decision: "VERIFIED", checklist: {}, expiresAt }, meta("expiry"), h.storage), { status: 422, code: "DOCUMENT_EXPIRY_INVALID" });
    assert.equal(h.writes, 0);
  }
});

test("CPO07 matching authenticated VERIFIED replay survives expiry; fresh expired decision still fails", async (t) => {
  const h = harness(); h.versions.push(h.base("v1", "IN_REVIEW"));
  const now = Date.now();
  const expiresAt = new Date(now + 86_400_000);
  let clock = now;
  t.mock.method(Date, "now", () => clock);
  const input = { decision: "VERIFIED" as const, checklist: { readable: true }, expiresAt };
  const first = await h.service.decideDocumentReview(reviewer, "v1", input, meta("expiry-replay"), h.storage);
  const writes = h.writes;
  clock = expiresAt.getTime() + 1;
  const replay = await h.service.decideDocumentReview(reviewer, "v1", input, meta("expiry-replay"), h.storage);
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(h.writes, writes);
  assert.equal(h.audits.filter((audit) => audit.action === "document.verified.v1").length, 1);
  await assert.rejects(h.service.decideDocumentReview(reviewer, "v1", input, meta("expiry-fresh"), h.storage), { status: 422, code: "DOCUMENT_EXPIRY_INVALID" });
  await assert.rejects(h.service.decideDocumentReview(reviewer, "v1", { ...input, checklist: {} }, meta("expiry-replay"), h.storage), { status: 409 });
  await assert.rejects(h.service.decideDocumentReview({ ...reviewer, userId: agent.userId }, "v1", input, meta("expiry-replay"), h.storage), { status: 403 });
});

test("CPO04/07 rejection preserves old VERIFIED and verification alone supersedes it", async () => {
  for (const decision of ["REJECTED", "VERIFIED"] as const) {
    const h = harness(); h.versions.push(h.base("old", "VERIFIED"), { ...h.base("replacement", "IN_REVIEW"), versionNumber: 2 });
    await h.service.decideDocumentReview(reviewer, "replacement", { decision, checklist: { readable: true }, reason: "needs repair" }, meta(`decision-${decision}`), h.storage);
    assert.equal(h.versions[0].status, decision === "VERIFIED" ? "SUPERSEDED" : "VERIFIED");
    assert.equal(h.documentStatus, "VERIFIED");
    assert.equal(h.satisfaction?.satisfiedByVersionId, decision === "VERIFIED" ? "replacement" : "old");
    for (const audit of h.audits.filter((a) => ["m3.lifecycle_transition_authorized.v1", "document.version_superseded.v1"].includes(a.action))) assert.match(audit.idempotencyKey, /^server:/);
    assert.ok(h.audits.find((a) => a.idempotencyKey === meta(`decision-${decision}`).idempotencyKey));
  }
});

test("CPO04 retry creates immutable version, preserves uploader, replays without another blob", async () => {
  const h = harness(); h.versions.push({ ...h.base("failed", "QUARANTINED"), scanStatus: "ERROR" });
  const manager = { ...agent, role: "MANAGER", membershipId: "manager", userId: 3 } as OperationalContext;
  const result = await h.service.retryDocumentScan(manager, "case", "failed", meta("retry"), { storage: h.storage, scanner: h.scanner });
  assert.equal(result.status, "UPLOADED"); assert.equal(h.versions[0].scanStatus, "ERROR");
  assert.equal(h.versions[1].uploaderMembershipId, "uploader");
  const replay = await h.service.retryDocumentScan(manager, "case", "failed", meta("retry"), { storage: h.storage, scanner: h.scanner });
  assert.equal(replay.versionId, result.versionId); assert.equal(replay.replayed, true); assert.equal(h.puts, 1);
  await assert.rejects(h.service.retryDocumentScan(reviewer, "case", "failed", meta("forbidden-retry")), { status: 403 });
});

test("CPO04 retry refuses infected, stale, wrong-tenant and wrong-owner versions", async () => {
  for (const boundary of ["infected", "stale", "tenant", "owner"]) {
    const h = harness(); h.versions.push({ ...h.base("failed", "QUARANTINED"), scanStatus: "ERROR" });
    if (boundary === "infected") h.versions[0].scanStatus = "INFECTED";
    if (boundary === "stale") h.versions.push(h.base("newer"));
    if (boundary === "tenant") h.versions[0].organizationId = "elsewhere";
    if (boundary === "owner") h.versions[0].case.ownerId = 99;
    await assert.rejects(h.service.retryDocumentScan(agent, "case", "failed", meta(boundary), { storage: h.storage, scanner: h.scanner }));
    assert.equal(h.puts, 0); assert.equal(h.writes, 0);
  }
});

test("CPO08 closed escalation conflicts without mutation and requires active owner", async () => {
  for (const status of ["COMPLETED", "CANCELLED", "SUPERSEDED"]) {
    const h = harness(); h.versions.push(h.base("v1", "IN_REVIEW"));
    const prior = { id: 17, status, waitingReason: "prior", assigneeMembershipId: "owner" }; h.setTask(prior);
    await assert.rejects(h.service.escalateDocumentReview(reviewer, "v1", "new reason", meta(status)), { status: 409, code: "DOCUMENT_ESCALATION_TASK_CLOSED" });
    assert.deepEqual(h.task, prior); assert.equal(h.writes, 0); assert.equal(h.audits.length, 0);
  }
  const h = harness(); h.versions.push(h.base("v1", "IN_REVIEW")); h.setOwner(null);
  await assert.rejects(h.service.escalateDocumentReview(reviewer, "v1", "reason", meta("owner")), { code: "DOCUMENT_ESCALATION_OWNER_REQUIRED" });
  assert.equal(h.writes, 0);
});

test("CPO08 open re-escalation audits prior reason/status/assignee and replays", async () => {
  const h = harness(); h.versions.push(h.base("v1", "IN_REVIEW"));
  const prior = { id: 17, status: "OPEN", waitingReason: "old reason", assigneeMembershipId: "previous-owner", priority: "NORMAL" }; h.setTask(prior);
  await h.service.escalateDocumentReview(reviewer, "v1", "new reason", meta("escalate"));
  const audit = h.audits[0]; assert.deepEqual((audit.before as Record<string, unknown>).task, prior);
  const after = audit.after as Record<string, unknown>;
  assert.equal(after.status, "OPEN"); assert.equal(after.assigneeMembershipId, "owner");
  assert.equal(after.reason, "new reason");
  assert.equal((await h.service.escalateDocumentReview(reviewer, "v1", "new reason", meta("escalate"))).replayed, true);
  assert.equal(h.audits.length, 1);
});

test("CPO31/32 multipart is bounded even without Content-Length", async () => {
  const h = harness();
  const form = new FormData(); form.set("file", pdf); form.set("requirementId", "req"); form.set("documentTypeCode", "IDENTITY");
  assert.equal((await h.service.readBoundedDocumentMultipart(new Request("https://unit.invalid", { method: "POST", body: form }))).get("requirementId"), "req");
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  const request = new Request("https://unit.invalid", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body, duplex: "half" } as RequestInit);
  await assert.rejects(h.service.readBoundedDocumentMultipart(request), { status: 413 }); assert.equal(cancelled, true);
  await assert.rejects(h.service.readBoundedDocumentMultipart(new Request("https://unit.invalid", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "content-length": "999999999" }, body: "x" })), { status: 413 });
});

test("CPO04/07 before-after: baseline allowed unavailable scan writes and same-user review", async () => {
  const baseline = process.env.CPO_DOCUMENT_BASE_REF ?? "87550178d6b4ba60b3f752880fd08674c6fd2835";
  const beforeSource = execFileSync("git", ["show", `${baseline}:lib/documentService.ts`], { encoding: "utf8" });
  const before = harness(ts.transpileModule(beforeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  before.versions.push(before.base("old", "VERIFIED"));
  await before.service.uploadCaseDocument(agent, { caseId: "case", requirementId: "req", documentTypeCode: "IDENTITY", file: pdf }, meta("before"), {
    storage: before.storage, scanner: { ...before.scanner, isOperational: () => false },
  });
  assert.equal(before.puts, 1); assert.equal(before.versions[0].status, "SUPERSEDED");
  const selfBefore = harness(ts.transpileModule(beforeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  selfBefore.versions.push(selfBefore.base("own"));
  await selfBefore.service.beginDocumentReview({ ...reviewer, userId: agent.userId }, "own", meta("before-self"));
  assert.equal(selfBefore.versions[0].status, "IN_REVIEW");
  const after = harness(); after.versions.push(after.base("own"));
  await assert.rejects(after.service.beginDocumentReview({ ...reviewer, userId: agent.userId }, "own", meta("after-self")), { status: 403 });
  assert.equal(after.versions[0].status, "UPLOADED");
});
