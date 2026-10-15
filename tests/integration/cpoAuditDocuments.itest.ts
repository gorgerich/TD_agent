import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  beginDocumentReview, decideDocumentReview, escalateDocumentReview, listDocumentReviewQueue,
  retryDocumentScan, uploadCaseDocument,
} from "../../lib/documentService";
import { materializeCaseRequirements } from "../../lib/documentRequirementService";
import { appendOperationalAudit } from "../../lib/operationalAudit";
import { serverCommandKey } from "../../lib/commandNamespace";
import { saveCaseIntake } from "../../lib/caseService";
import type { DocumentScanner } from "../../lib/documentScanner";
import { InMemoryTestStorage } from "../fixtures/testStorage";
import { syntheticDocumentPdf } from "../cpoAuditDocuments.fixture.mjs";
import { createFixtureContext, db, skip, type FixtureMember } from "./_setup";
import { installM3OrganizationBaseline, M3_TEST_DOCUMENT_TYPES } from "./_m3Baseline";

const fixtures = createFixtureContext("cpo-audit-documents");
const opts = { skip: skip ? "requires approved local isolated PostgreSQL target" : false };
const storage = new InMemoryTestStorage();
const clean: DocumentScanner = {
  isOperational: () => true,
  scan: async () => ({ status: "CLEAN", provider: "isolated-test-only", resultCode: "FIXTURE" }),
};
const errorScanner: DocumentScanner = { ...clean, scan: async () => { throw new Error("isolated scanner outage"); } };
let owner: FixtureMember;
let reviewer: FixtureMember;
let outsider: FixtureMember;
const meta = (label: string) => ({ idempotencyKey: `${fixtures.runId}:${label}`, correlationId: `${fixtures.runId}:${label}` });
const file = () => new File([syntheticDocumentPdf("CPO isolated regression")], "test.pdf", { type: "application/pdf" });

before(async () => {
  if (skip) return;
  const organizationId = await fixtures.makeOrganization("documents");
  owner = await fixtures.makeMember("owner", { organizationId });
  reviewer = await fixtures.makeMember("reviewer", { organizationId, role: "DOCUMENT_REVIEWER" });
  outsider = await fixtures.makeMember("foreign-reviewer", { role: "DOCUMENT_REVIEWER" });
  const baseline = await installM3OrganizationBaseline(organizationId);
  baseline.policyIds.forEach(fixtures.trackDocumentPolicy);
  baseline.documentTypeIds.forEach(fixtures.trackDocumentType);
});

after(async () => {
  if (skip) return;
  try {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  } finally {
    storage.clear();
    await db.$disconnect();
  }
});

async function documentCase(label: string, uploader = owner) {
  const record = await fixtures.makeCase(uploader, label);
  await db.case.update({ where: { id: record.id }, data: { scenarioId: "CREMATION_V1" } });
  await materializeCaseRequirements(uploader.context, record.id, meta(`${label}:requirements`));
  const requirement = await db.caseDocumentRequirement.findFirstOrThrow({ where: { caseId: record.id, stableKey: "identity-record" } });
  return { record, requirement, input: { caseId: record.id, requirementId: requirement.id, documentTypeCode: M3_TEST_DOCUMENT_TYPES.identity, file: file() } };
}

test("CPO04 PostgreSQL: unavailable provider rejects before storage or persisted document", opts, async () => {
  const fixture = await documentCase("unavailable");
  const size = storage.size;
  await assert.rejects(uploadCaseDocument(owner.context, fixture.input, meta("unavailable:upload"), {
    storage, scanner: { ...clean, isOperational: () => false },
  }), { status: 503, code: "DOCUMENT_SCANNER_UNAVAILABLE" });
  assert.equal(storage.size, size);
  assert.equal(await db.caseDocumentVersion.count({ where: { caseId: fixture.record.id } }), 0);
});

test("CPO04 PostgreSQL: superseded requirement history denies upload despite reactivated applicability", opts, async () => {
  for (const phase of ["preflight", "commit"]) {
    const fixture = await documentCase(`superseded-${phase}`);
    const retire = () => db.caseDocumentRequirement.update({ where: { id: fixture.requirement.id }, data: { supersededAt: new Date(), isApplicable: true } });
    if (phase === "preflight") await retire();
    const scanner: DocumentScanner = { ...clean, scan: async (input) => {
      await retire();
      return clean.scan(input);
    } };
    const beforeStorage = storage.size;
    await assert.rejects(uploadCaseDocument(owner.context, fixture.input, meta(`superseded:${phase}`), { storage, scanner }), { status: 404 });
    assert.equal(await db.caseDocumentVersion.count({ where: { caseId: fixture.record.id } }), 0);
    assert.equal(storage.size, beforeStorage, "no stored object remains after denial");
  }
});

test("CPO04 PostgreSQL: unsuperseded requirement pinned to a retired policy remains uploadable", opts, async () => {
  const fixture = await documentCase("pinned-retired-policy");
  const policy = await db.documentRequirementPolicy.findUniqueOrThrow({ where: { id: fixture.requirement.policyId } });
  await db.documentRequirementPolicy.update({ where: { id: policy.id }, data: { status: "RETIRED", retiredAt: new Date() } });
  try {
    const uploaded = await uploadCaseDocument(owner.context, fixture.input, meta("pinned-retired-policy:upload"), { storage, scanner: clean });
    assert.equal(uploaded.status, "UPLOADED");
    assert.equal((await db.caseDocumentRequirement.findUniqueOrThrow({ where: { id: fixture.requirement.id } })).supersededAt, null);
  } finally {
    await db.documentRequirementPolicy.update({ where: { id: policy.id }, data: { status: "APPROVED", retiredAt: null } });
  }
});

test("CPO07 PostgreSQL: authenticated matching VERIFIED replay returns saved result after expiry", opts, async (t) => {
  const fixture = await documentCase("expiry-replay");
  const uploaded = await uploadCaseDocument(owner.context, fixture.input, meta("expiry-replay:upload"), { storage, scanner: clean });
  await beginDocumentReview(reviewer.context, uploaded.versionId, meta("expiry-replay:start"));
  const now = Date.now();
  const expiresAt = new Date(now + 86_400_000);
  let clock = now;
  t.mock.method(Date, "now", () => clock);
  const input = { decision: "VERIFIED" as const, checklist: { "identity-match": true }, expiresAt };
  const command = meta("expiry-replay:decision");
  const first = await decideDocumentReview(reviewer.context, uploaded.versionId, input, command, storage);
  const before = await db.caseDocumentVersion.findUniqueOrThrow({ where: { id: uploaded.versionId } });
  clock = expiresAt.getTime() + 1;
  const replay = await decideDocumentReview(reviewer.context, uploaded.versionId, input, command, storage);
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.deepEqual(await db.caseDocumentVersion.findUniqueOrThrow({ where: { id: uploaded.versionId } }), before);
  assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: owner.organizationId, idempotencyKey: command.idempotencyKey } }), 1);
  await assert.rejects(decideDocumentReview(reviewer.context, uploaded.versionId, input, meta("expiry-replay:fresh"), storage), { status: 422, code: "DOCUMENT_EXPIRY_INVALID" });
  await assert.rejects(decideDocumentReview(reviewer.context, uploaded.versionId, { ...input, checklist: {} }, command, storage), { status: 409 });
  await assert.rejects(decideDocumentReview(outsider.context, uploaded.versionId, input, command, storage), { status: 404 });
});

test("CPO07 PostgreSQL: injected set_config cannot authorize review/supersession; old upload actor fails closed", opts, async () => {
  const fixture = await documentCase("injected-config");
  const uploaded = await uploadCaseDocument(owner.context, fixture.input, meta("config:upload"), { storage, scanner: clean });
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('td_agent.m3_document_transition', 'begin-review', true)`;
    await tx.caseDocumentVersion.update({ where: { id: uploaded.versionId }, data: { status: "IN_REVIEW", assignedReviewerMembershipId: reviewer.membershipId } });
  }), /canonical command/i);
  await beginDocumentReview(reviewer.context, uploaded.versionId, meta("config:real-start"));
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('td_agent.m3_document_transition', 'review-decision', true)`;
    await tx.caseDocumentVersion.update({ where: { id: uploaded.versionId }, data: {
      status: "VERIFIED", reviewedByMembershipId: reviewer.membershipId, reviewedAt: new Date(), reviewChecklist: { "identity-match": true },
    } });
  }), /canonical command/i);
  await decideDocumentReview(reviewer.context, uploaded.versionId, { decision: "VERIFIED", checklist: { "identity-match": true } }, meta("config:real-verify"), storage);
  await assert.rejects(db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('td_agent.m3_document_transition', 'supersede', true)`;
    await tx.caseDocumentVersion.update({ where: { id: uploaded.versionId }, data: { status: "SUPERSEDED" } });
  }), /canonical command/i);
  await assert.rejects(db.$transaction(async (tx) => {
    await appendOperationalAudit(tx, owner.context, {
      entityType: "document_version", entityId: uploaded.versionId, action: "m3.lifecycle_transition_authorized.v1",
      before: { status: "VERIFIED" }, after: { status: "SUPERSEDED", command: "supersede" },
      correlationId: meta("config:old-runtime").correlationId,
      idempotencyKey: serverCommandKey("document-db-auth", meta("config:old-runtime").idempotencyKey), result: { authorized: true },
    });
    await tx.caseDocumentVersion.update({ where: { id: uploaded.versionId }, data: { status: "SUPERSEDED" } });
  }), /canonical command/i);
  assert.equal((await db.caseDocumentVersion.findUniqueOrThrow({ where: { id: uploaded.versionId } })).status, "VERIFIED");
});

test("CPO04 PostgreSQL: scenario correction during scan cannot commit a stale common-key type/version", opts, async () => {
  for (const [index, boundary] of ["code", "version-id"].entries()) {
    const fixture = await documentCase(`policy-race-${boundary}`);
    await db.case.update({ where: { id: fixture.record.id }, data: { stage: "QUOTING" } });
    const replacementType = await db.documentTypeDefinition.create({ data: {
      organizationId: owner.organizationId, code: boundary === "code" ? "CPO_CHANGED_IDENTITY" : M3_TEST_DOCUMENT_TYPES.identity,
      version: boundary === "code" ? 1 : 2, name: "Synthetic replacement identity type",
      allowedMimeTypes: ["application/pdf"], maxBytes: 1_000_000, status: "APPROVED", source: "SYNTHETIC_CPO_TEST_NOT_LEGAL_APPROVAL",
    } });
    fixtures.trackDocumentType(replacementType.id);
    await db.documentRequirementPolicy.updateMany({
      where: { organizationId: owner.organizationId, scenario: "FAMILY_PLOT_BURIAL_V1", status: "APPROVED" },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
    const policy = await db.documentRequirementPolicy.create({ data: {
      organizationId: owner.organizationId, scenario: "FAMILY_PLOT_BURIAL_V1", version: 9_000_001 + index,
      status: "APPROVED", source: "SYNTHETIC_CPO_TEST_NOT_LEGAL_APPROVAL", approvedByUserId: owner.userId,
      approvedAt: new Date(0), effectiveFrom: new Date(0),
      rules: { create: { stableKey: "identity-record", kind: "REQUIRED", ownerRole: "DOCUMENT_REVIEWER", blockingStage: "EXECUTION",
        acceptedDocumentTypeCodes: [replacementType.code], acceptedDocumentTypeVersionIds: [replacementType.id],
        reviewChecklist: ["identity-match"], source: "SYNTHETIC_CPO_TEST_NOT_LEGAL_APPROVAL" } },
    } });
    fixtures.trackDocumentPolicy(policy.id);
    const startingStorageSize = storage.size;
    const correctingScanner: DocumentScanner = { ...clean, scan: async (scanInput) => {
      await saveCaseIntake({
        leadId: fixture.record.leadId,
        data: { ceremonyType: "погребение", budget: null, needs: null, deceasedName: null, deceasedDate: null, morgue: null, ceremonyAt: null, ceremonyPlace: null },
        context: { organizationId: owner.organizationId, membershipId: owner.membershipId, agentId: owner.agentId, actorId: owner.userId, ...meta(`policy-race:${boundary}:correction`) },
        scenarioCorrection: { confirmed: true, reason: "Synthetic correction during pending file scan" },
      });
      return clean.scan(scanInput);
    } };
    await assert.rejects(uploadCaseDocument(owner.context, fixture.input, meta(`policy-race:${boundary}:upload`), { storage, scanner: correctingScanner }), { status: 409, code: "DOCUMENT_UPLOAD_POLICY_CHANGED" });
    assert.equal((await db.case.findUniqueOrThrow({ where: { id: fixture.record.id } })).scenarioId, "FAMILY_PLOT_BURIAL_V1");
    assert.equal((await db.caseDocumentRequirement.findUniqueOrThrow({ where: { id: fixture.requirement.id } })).isApplicable, true);
    assert.equal(await db.caseDocumentVersion.count({ where: { caseId: fixture.record.id } }), 0);
    assert.equal(storage.size, startingStorageSize, "uncommitted stale blob is discarded");
  }
});

test("CPO04/07 PostgreSQL: VERIFIED survives pending/quarantine/rejection until verified replacement", opts, async () => {
  const fixture = await documentCase("replacement");
  const original = await uploadCaseDocument(owner.context, fixture.input, meta("replacement:v1"), { storage, scanner: clean });
  await beginDocumentReview(reviewer.context, original.versionId, meta("replacement:start-v1"));
  await decideDocumentReview(reviewer.context, original.versionId, { decision: "VERIFIED", checklist: { "identity-match": true } }, meta("replacement:verify-v1"), storage);
  const assertOriginalValid = async () => {
    assert.equal((await db.caseDocumentVersion.findUniqueOrThrow({ where: { id: original.versionId } })).status, "VERIFIED");
    const requirement = await db.caseDocumentRequirement.findUniqueOrThrow({ where: { id: fixture.requirement.id } });
    assert.equal(requirement.satisfactionStatus, "SATISFIED"); assert.equal(requirement.satisfiedByVersionId, original.versionId);
  };
  const quarantined = await uploadCaseDocument(owner.context, { ...fixture.input, file: file() }, meta("replacement:error-v2"), { storage, scanner: errorScanner });
  await assertOriginalValid();
  const pending = await uploadCaseDocument(owner.context, { ...fixture.input, file: file() }, meta("replacement:v3"), { storage, scanner: clean });
  await assertOriginalValid();
  await assert.rejects(db.$transaction(async (tx) => {
    await appendOperationalAudit(tx, reviewer.context, {
      entityType: "document_version", entityId: original.versionId, action: "m3.lifecycle_transition_authorized.v1",
      before: { status: "VERIFIED" }, after: { status: "SUPERSEDED", command: "supersede" },
      correlationId: meta("replacement:premature").correlationId,
      idempotencyKey: serverCommandKey("document-db-auth", meta("replacement:premature").idempotencyKey), result: { authorized: true },
    });
    await tx.caseDocumentVersion.update({ where: { id: original.versionId }, data: { status: "SUPERSEDED" } });
  }), /canonical command/i, "even an authorized reviewer cannot supersede with only a pending replacement");
  await assertOriginalValid();
  await beginDocumentReview(reviewer.context, pending.versionId, meta("replacement:start-v3"));
  await assertOriginalValid();
  await decideDocumentReview(reviewer.context, pending.versionId, { decision: "REJECTED", checklist: {}, reason: "Synthetic unreadable evidence" }, meta("replacement:reject-v3"), storage);
  await assertOriginalValid();
  const replacement = await uploadCaseDocument(owner.context, { ...fixture.input, file: file() }, meta("replacement:v4"), { storage, scanner: clean });
  await beginDocumentReview(reviewer.context, replacement.versionId, meta("replacement:start-v4"));
  await assert.rejects(decideDocumentReview(reviewer.context, replacement.versionId, { decision: "VERIFIED", checklist: { "identity-match": true }, expiresAt: new Date(0) }, meta("replacement:expired"), storage), { status: 422 });
  await assertOriginalValid();
  await decideDocumentReview(reviewer.context, replacement.versionId, { decision: "VERIFIED", checklist: { "identity-match": true } }, meta("replacement:verify-v4"), storage);
  const prior = await db.caseDocumentVersion.findMany({ where: { id: { in: [original.versionId, quarantined.versionId, pending.versionId] } } });
  assert.equal(prior.every((version) => version.status === "SUPERSEDED"), true);
  assert.equal((await db.caseDocumentRequirement.findUniqueOrThrow({ where: { id: fixture.requirement.id } })).satisfiedByVersionId, replacement.versionId);
  assert.equal(await db.operationalAuditEvent.count({ where: { entityId: { in: prior.map((v) => v.id) }, action: "document.version_superseded.v1" } }), 3);
});

test("CPO04 PostgreSQL: explicit rescan is authorized, immutable, idempotent and fail closed", opts, async () => {
  const fixture = await documentCase("rescan");
  const failed = await uploadCaseDocument(owner.context, fixture.input, meta("rescan:upload"), { storage, scanner: errorScanner });
  await assert.rejects(retryDocumentScan(outsider.context, fixture.record.id, failed.versionId, meta("rescan:foreign"), { storage, scanner: clean }), { status: 403 });
  const retry = await retryDocumentScan(owner.context, fixture.record.id, failed.versionId, meta("rescan:retry"), { storage, scanner: errorScanner });
  assert.equal(retry.status, "QUARANTINED"); assert.equal(retry.scanStatus, "ERROR");
  const replay = await retryDocumentScan(owner.context, fixture.record.id, failed.versionId, meta("rescan:retry"), { storage, scanner: clean });
  assert.equal(replay.versionId, retry.versionId); assert.equal(replay.replayed, true);
  assert.equal(await db.caseDocumentVersion.count({ where: { documentId: failed.documentId } }), 2);
  assert.equal((await db.caseDocumentVersion.findUniqueOrThrow({ where: { id: failed.versionId } })).scanStatus, "ERROR");
  await assert.rejects(retryDocumentScan(owner.context, fixture.record.id, failed.versionId, meta("rescan:stale"), { storage, scanner: clean }), { status: 409 });
  const cleanRetry = await retryDocumentScan(owner.context, fixture.record.id, retry.versionId, meta("rescan:clean"), { storage, scanner: clean });
  assert.equal(cleanRetry.status, "UPLOADED");
  assert.equal((await db.caseDocumentVersion.findUniqueOrThrow({ where: { id: cleanRetry.versionId } })).uploaderMembershipId, owner.membershipId);
});

test("CPO07 PostgreSQL: user separation survives role and membership changes; direct DB claim also forbidden", opts, async () => {
  const uploader = await fixtures.makeMember("self-uploader", { organizationId: owner.organizationId });
  const fixture = await documentCase("self-review", uploader);
  const uploaded = await uploadCaseDocument(uploader.context, fixture.input, meta("self:upload"), { storage, scanner: clean });
  await db.membership.update({ where: { id: uploader.membershipId }, data: { role: "DOCUMENT_REVIEWER" } });
  const self = { ...uploader.context, role: "DOCUMENT_REVIEWER" as const };
  assert.equal((await listDocumentReviewQueue(self)).some((v) => v.id === uploaded.versionId), false);
  await assert.rejects(beginDocumentReview(self, uploaded.versionId, meta("self:start")), { status: 403 });
  // The additive DB trigger must reject even a correctly authorized direct self-claim.
  await assert.rejects(db.$transaction(async (tx) => {
    await appendOperationalAudit(tx, self, {
      entityType: "document_version", entityId: uploaded.versionId, action: "m3.lifecycle_transition_authorized.v1",
      before: { status: "UPLOADED" }, after: { status: "IN_REVIEW", command: "begin-review" },
      correlationId: meta("self:direct").correlationId, idempotencyKey: serverCommandKey("document-db-auth", meta("self:direct").idempotencyKey), result: { authorized: true },
    });
    await tx.caseDocumentVersion.update({ where: { id: uploaded.versionId }, data: { status: "IN_REVIEW", assignedReviewerMembershipId: self.membershipId } });
  }), /self|independent|separation|uploader|reviewer/i);

  const otherOrganization = await fixtures.makeOrganization("historic-membership");
  await db.membership.update({ where: { id: uploader.membershipId }, data: { organizationId: otherOrganization, agentId: null } });
  const replacementMembership = await db.membership.create({ data: {
    organizationId: owner.organizationId, userId: uploader.userId, agentId: uploader.agentId, role: "DOCUMENT_REVIEWER", status: "ACTIVE",
  } });
  fixtures.trackCreatedMember({ userId: uploader.userId, agentId: uploader.agentId, membershipId: replacementMembership.id });
  const sameUser = { ...self, membershipId: replacementMembership.id };
  assert.equal((await listDocumentReviewQueue(sameUser)).some((v) => v.id === uploaded.versionId), false);
  await assert.rejects(beginDocumentReview(sameUser, uploaded.versionId, meta("self:new-membership")), { status: 403 });
  // Represent a legacy self-assignment predating the repair, only in this approved throwaway DB.
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.caseDocumentVersion.update({ where: { id: uploaded.versionId }, data: { status: "IN_REVIEW", assignedReviewerMembershipId: replacementMembership.id } });
  });
  for (const decision of ["VERIFIED", "REJECTED"] as const) {
    await assert.rejects(decideDocumentReview(sameUser, uploaded.versionId, { decision, checklist: { "identity-match": true }, reason: "legacy self-review" }, meta(`self:decision:${decision}`), storage), { status: 403 });
  }
  assert.equal((await db.caseDocumentVersion.findUniqueOrThrow({ where: { id: uploaded.versionId } })).status, "IN_REVIEW");
  await assert.rejects(db.membership.update({ where: { id: uploader.membershipId }, data: { userId: outsider.userId } }), /user identity is immutable/i);
});

test("CPO08 PostgreSQL: escalation audits prior state, rejects closed task and absent owner", opts, async () => {
  const fixture = await documentCase("escalation");
  const uploaded = await uploadCaseDocument(owner.context, fixture.input, meta("escalation:upload"), { storage, scanner: clean });
  await beginDocumentReview(reviewer.context, uploaded.versionId, meta("escalation:start"));
  const first = await escalateDocumentReview(reviewer.context, uploaded.versionId, "prior reason", meta("escalation:first"));
  const beforeTask = await db.task.findUniqueOrThrow({ where: { id: first.taskId } });
  await escalateDocumentReview(reviewer.context, uploaded.versionId, "updated reason", meta("escalation:update"));
  const audit = await db.operationalAuditEvent.findUniqueOrThrow({ where: { organizationId_idempotencyKey: { organizationId: owner.organizationId, idempotencyKey: meta("escalation:update").idempotencyKey } } });
  assert.deepEqual((audit.before as { task: { waitingReason: string; status: string; assigneeMembershipId: string } }).task, {
    id: first.taskId, waitingReason: beforeTask.waitingReason, status: beforeTask.status, assigneeMembershipId: beforeTask.assigneeMembershipId, priority: beforeTask.priority,
  });
  await db.task.update({ where: { id: first.taskId }, data: { status: "COMPLETED", completedAt: new Date() } });
  const closed = await db.task.findUniqueOrThrow({ where: { id: first.taskId } });
  await assert.rejects(escalateDocumentReview(reviewer.context, uploaded.versionId, "must not overwrite", meta("escalation:closed")), { status: 409, code: "DOCUMENT_ESCALATION_TASK_CLOSED" });
  assert.deepEqual(await db.task.findUniqueOrThrow({ where: { id: first.taskId } }), closed);
  await db.membership.update({ where: { id: owner.membershipId }, data: { status: "SUSPENDED" } });
  try {
    await assert.rejects(escalateDocumentReview(reviewer.context, uploaded.versionId, "no active owner", meta("escalation:no-owner")), { status: 409, code: "DOCUMENT_ESCALATION_OWNER_REQUIRED" });
  } finally {
    await db.membership.update({ where: { id: owner.membershipId }, data: { status: "ACTIVE" } });
  }
});
