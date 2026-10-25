import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../lib/password";
import { encryptPlatformMfaSecret } from "../../lib/platformMfa";
import { encryptField } from "../../lib/crypto";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";
import { assertOnlyRecognisedSyntheticData, censusOfTarget, m1UatNamespace, m2UatNamespace, m3UatNamespace } from "./uatFixtureGuard";
import { finalizeCpoPublication, inspectCpoPublication, seedCpoScenarios } from "./cpo-fixture-seed";

// Run after M3 provision. Pass its non-secret JSON output as M3_CPO_REPAIR_FIXTURE_JSON.
// Run cleanup before M3 cleanup, including on failure; never reprovision M3 in between.
const runId = process.env.M3_UAT_RUN_ID ?? "";
if (!runId || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(runId)) throw new Error("Explicit canonical M3_UAT_RUN_ID required");
if (process.env.M3_UAT_FIXTURE !== "1" || process.env.M3_CPO_REPAIR_FIXTURE !== "1") throw new Error("Explicit M3 and CPO fixture opt-in required");
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const target = inspectDirectMigrationUrl(directUrl);
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);
const url = new URL(directUrl!);
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
const production = process.env.M3_PRODUCTION_DATABASE_FINGERPRINT;
if (target.fingerprint === "0257665af2dd90a4") throw new Error("Known production target is unconditionally forbidden");
if (!local && target.fingerprint !== "545a187f9e9d66b0") throw new Error("Remote target is outside the approved isolated fingerprint");
if (production === target.fingerprint || (!local && !/^[a-f0-9]{16}$/.test(production ?? ""))) throw new Error("Production fingerprint exclusion required");
if (local && target.database !== "td_agent_test") throw new Error("Local fixture requires td_agent_test");
const schema = process.env.M3_CPO_REPAIR_SCHEMA;
const localPublic = local && target.database === "td_agent_test" && schema === "public";
if (!schema || (!localPublic && !/^m3_cpo_repair_[a-z0-9_]+$/.test(schema))
  || (url.searchParams.get("schema") ?? "public") !== schema) throw new Error("Explicit isolated CPO schema required in direct URL");
const baseUrl = process.env.E2E_BASE_URL;
if (!baseUrl) throw new Error("Explicit E2E_BASE_URL required");
const origin = new URL(baseUrl).origin;
const browserUrl = new URL(baseUrl);
if (browserUrl.username || browserUrl.password || browserUrl.search || browserUrl.hash || browserUrl.pathname !== "/"
  || !(local ? ["localhost", "127.0.0.1"].includes(browserUrl.hostname) : browserUrl.protocol === "https:" && browserUrl.hostname.endsWith(".vercel.app"))) {
  throw new Error("Use an explicit local or isolated Vercel Preview origin");
}
const password = process.env.M3_UAT_PASSWORD;
const mfa = process.env.M3_UAT_MFA_SECRET;
if (["provision", "provision-base"].includes(process.argv[2]) && (!password || password.length < 32 || !mfa || !/^[A-Z2-7]{32}$/.test(mfa))) throw new Error("Protected M3 password and MFA seed required");
const ownerEmail = `m3-cpo-owner-${runId}@synthetic.invalid`;
const ownerMfa = [...createHmac("sha256", mfa ?? "").update(`cpo-repair-owner:${runId}`).digest()]
  .map((byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte & 31]).join("");
const [organizationA, organizationB] = m3UatNamespace(runId).organizationIds;
const caseIds = { safe: `m3-cpo-case:${runId}:safe`, published: `m3-cpo-case:${runId}:published` };
const publicationInput = { runId, organizationA, cases: caseIds, agentMembershipId: `m3-uat-membership:${runId}:agent` };
const db = new PrismaClient({ datasources: { db: { url: directUrl } } });
let stage = "verify";

async function verify() {
  stage = "verify-target-identity";
  const rows = await db.$queryRaw<Array<{ database: string; schema: string; readOnly: string }>>`
    SELECT current_database() AS database, current_schema() AS schema, current_setting('transaction_read_only') AS "readOnly"
  `;
  if (rows.length !== 1 || rows[0].database !== target.database || rows[0].schema !== schema || rows[0].readOnly !== "off") {
    process.stderr.write(`${JSON.stringify({ code: "CPO_TARGET_IDENTITY_MISMATCH", rowCount: rows.length,
      databaseMatches: rows.length === 1 && rows[0].database === target.database,
      schemaMatches: rows.length === 1 && rows[0].schema === schema,
      writable: rows.length === 1 && rows[0].readOnly === "off" })}\n`);
    throw new Error("Target identity mismatch");
  }
  const namespaces = [m3UatNamespace(runId), { label: "CPO extension", organizationIds: [], userEmails: [ownerEmail] }];
  if (process.env.M1_UAT_RUN_ID) namespaces.push(m1UatNamespace(process.env.M1_UAT_RUN_ID));
  if (process.env.M2_UAT_RUN_ID) namespaces.push(m2UatNamespace(process.env.M2_UAT_RUN_ID));
  stage = "verify-synthetic-census";
  assertOnlyRecognisedSyntheticData(await censusOfTarget(db), namespaces, "CPO repair extension");
}

async function manifest(publicationPending = false) {
  const rows = await db.case.findMany({ where: { id: { in: Object.values(caseIds) }, tenantId: organizationA }, select: { id: true, leadId: true, stage: true, scenarioId: true } });
  if (rows.length !== 2) throw new Error("CPO fixture incomplete");
  const owner = await db.user.findUnique({ where: { email: ownerEmail }, select: { platformRole: true, platformMfaEnabledAt: true, agent: { select: { id: true } }, memberships: { select: { id: true } } } });
  if (!owner || owner.platformRole !== "SUPER_ADMIN" || !owner.platformMfaEnabledAt || owner.agent || owner.memberships.length) throw new Error("CPO platform-only owner mismatch");
  const organization = await db.organization.findUniqueOrThrow({ where: { id: organizationB }, select: { status: true } });
  const adminCount = await db.membership.count({ where: { organizationId: organizationB, role: "ADMIN" } });
  const pendingAdminCount = await db.organizationInvite.count({ where: { organizationId: organizationB, role: "ADMIN", acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
  const previousBootstrapCount = await db.platformAuditEvent.count({ where: { targetId: organizationB, action: "ORGANIZATION_FIRST_ADMIN_ASSIGNED" } });
  const meeting = await db.meeting.findFirstOrThrow({ where: { caseId: caseIds.published, organizationId: organizationA,
    ownerMembershipId: publicationInput.agentMembershipId }, select: { id: true } });
  const publication = publicationPending ? null : await inspectCpoPublication(db, publicationInput);
  return { source: "synthetic-cpo-repair-v1", runId, fingerprint: target.fingerprint, database: target.database, local, schema, origin, organizationA, organizationB,
    publicationPending, publication, publishedMeetingId: meeting.id,
    bootstrap: { organizationStatus: organization.status, adminCount, pendingAdminCount, previousBootstrapCount },
    candidateMembershipId: `m3-uat-membership:${runId}:foreign`, ownerEmail,
    cases: { safe: rows.find((row) => row.id === caseIds.safe)!, published: rows.find((row) => row.id === caseIds.published)! } };
}

async function provision(baseOnly = false) {
  const passwordHash = hashPassword(password!);
  const seed = { runId, organizationA, organizationB, cases: caseIds, ownerEmail, passwordHash,
    candidateMembershipId: `m3-uat-membership:${runId}:foreign`, agentMembershipId: `m3-uat-membership:${runId}:agent`,
    encryptedMfa: encryptPlatformMfaSecret(ownerMfa), encryptedDeceasedName: encryptField("Synthetic CPO deceased") };
  const started = performance.now(), actions: Array<{ label: string; durationMs: number }> = [];
  let callbackCompleted = false, commitAcknowledged = false;
  try {
    await db.$transaction(async tx => {
      await seedCpoScenarios(tx, seed, async (label, operation) => {
        const start = performance.now();
        try { return await operation(); } finally { actions.push({ label, durationMs: Math.round(performance.now() - start) }); }
      });
      callbackCompleted = true;
    });
    commitAcknowledged = true;
  } finally {
    process.stderr.write(`${JSON.stringify({ stage: "CPO_SCENARIO_TRANSACTION", actions, callbackCompleted, commitAcknowledged, durationMs: Math.round(performance.now() - started) })}\n`);
  }
  if (baseOnly) return;
  // Bind production services to the verified isolated client, never the ambient DATABASE_URL.
  const globalClient = globalThis as unknown as { prisma?: PrismaClient };
  if (globalClient.prisma && globalClient.prisma !== db) throw new Error("Unexpected ambient Prisma client");
  globalClient.prisma = db;
  const { saveCommercialDraft, markCommercialQuoteInReview, publishCommercialQuote } = await import("../../lib/commercialQuoteService");
  const member = await db.membership.findUniqueOrThrow({ where: { id: `m3-uat-membership:${runId}:agent` } });
  if (!member.agentId) throw new Error("Synthetic agent missing");
  const context = { organizationId: organizationA, membershipId: member.id, agentId: member.agentId, userId: member.userId,
    role: "AGENT" as const, platformRole: "USER" as const, timezone: "Europe/Moscow" };
  const meta = (action: string) => ({ idempotencyKey: `cpo:${runId}:published:${action}`, correlationId: `cpo:${runId}:published`, reason: "Synthetic CPO publication guard" });
  stage = "canonical-draft";
  const meeting = await db.meeting.findFirstOrThrow({ where: { caseId: caseIds.published, organizationId: organizationA } });
  const draft = await saveCommercialDraft({ meetingId: meeting.id, scenario: "CREMATION_V1", context, meta: meta("draft"), lines: [{
    stableKey: `cpo:${runId}:service`, position: 0, type: "SERVICE", serviceCode: "synthetic-cpo", description: "Synthetic CPO service",
    quantity: 1, unit: "service", priceState: "KNOWN", clientUnitPrice: 100_000, costState: "KNOWN", unitCost: 80_000,
    discountAmount: 0, included: false, optional: false, relationKind: "STANDALONE", source: "synthetic-cpo-repair", sourceVersion: "1",
    scenarioCompatibility: ["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"],
  }] });
  stage = "canonical-review";
  await markCommercialQuoteInReview({ quoteId: draft.quoteId, context, meta: meta("review") });
  stage = "canonical-publish";
  await publishCommercialQuote({ quoteId: draft.quoteId, context, meta: meta("publish"), validUntil: new Date(Date.now() + 86_400_000), channel: "link" });
  stage = "finalize-publication";
  await db.$transaction(tx => finalizeCpoPublication(tx, publicationInput));
}

async function cleanup() {
  if (!local && process.env.M3_ALLOW_REMOTE_FIXTURE_CLEANUP !== "YES") throw new Error("Remote cleanup requires explicit existing M3 cleanup authorization");
  await db.$transaction(async (tx) => {
    const ids = Object.values(caseIds);
    const cases = await tx.case.findMany({ where: { id: { in: ids } }, include: { lead: { include: { agent: { include: { user: true } } } } } });
    if (cases.some((record) => record.tenantId !== organizationA || record.lead.source !== "synthetic-cpo-repair"
      || record.lead.agent.user.email !== `m3-agent-${runId}@synthetic.invalid` || record.ownerId !== record.lead.agentId)) throw new Error("Cleanup case provenance mismatch");
    const owner = await tx.user.findUnique({ where: { email: ownerEmail }, include: { memberships: true, agent: true, platformAuditEvents: true } });
    if (owner && (owner.platformRole !== "SUPER_ADMIN" || owner.agent || owner.memberships.length
      || owner.platformAuditEvents.some((event) => event.action !== "ORGANIZATION_FIRST_ADMIN_ASSIGNED" || event.targetType !== "organization" || event.targetId !== organizationB))) throw new Error("Cleanup owner provenance mismatch");
    const emails = ["FINANCE", "DOCUMENT_REVIEWER", "MANAGER"].map((role) => `m3-cpo-invite-${role.toLowerCase()}-${runId}@synthetic.invalid`);
    const invites = await tx.organizationInvite.findMany({ where: { organizationId: organizationB, emailNormalized: { in: emails } } });
    if (invites.some((invite) => invite.createdByMembershipId !== `m3-uat-membership:${runId}:foreign` || invite.acceptedAt
      || invite.emailNormalized !== `m3-cpo-invite-${invite.role.toLowerCase()}-${runId}@synthetic.invalid`)) throw new Error("Cleanup invite provenance mismatch");
    if (!cases.length && !owner && !invites.length) return;
    const consequences = await Promise.all([
      tx.caseDocumentVersion.count({ where: { caseId: { in: ids } } }), tx.contract.count({ where: { caseId: { in: ids } } }),
      tx.contractVersion.count({ where: { caseId: { in: ids } } }), tx.paymentObligation.count({ where: { caseId: { in: ids } } }),
      tx.paymentLedgerEntry.count({ where: { caseId: { in: ids } } }), tx.caseParty.count({ where: { caseId: { in: ids } } }),
    ]);
    if (consequences.some(Boolean)) throw new Error("Unexpected consequences; refuse destructive cleanup");
    const quotes = await tx.quote.findMany({ where: { caseId: { in: ids } }, include: { versions: true } });
    if (quotes.some((quote) => quote.caseId !== caseIds.published || quote.organizationId !== organizationA
      || quote.versions.some((version) => version.state !== "DRAFT" && version.idempotencyKey !== `cpo:${runId}:published:publish`))) throw new Error("Cleanup quote provenance mismatch");
    const versionIds = quotes.flatMap((quote) => quote.versions.map((version) => version.id));
    if (await tx.quoteClientDecision.count({ where: { quoteVersionId: { in: versionIds } } })) throw new Error("Unexpected client decision; refuse cleanup");
    const events = await tx.caseEvent.findMany({ where: { caseId: { in: ids }, tenantId: organizationA }, select: { id: true } });
    const tasks = await tx.task.findMany({ where: { organizationId: organizationA, caseId: { in: ids } }, select: { id: true } });
    const audits = await tx.operationalAuditEvent.findMany({ where: { OR: [
      { organizationId: organizationA, entityId: { in: ids }, entityType: "document_requirement" },
      { organizationId: organizationA, entityId: { in: quotes.map((quote) => String(quote.id)) }, entityType: "quote" },
      { organizationId: organizationA, entityId: { in: versionIds.map(String) }, entityType: "quote_version" },
      { organizationId: organizationA, entityId: { in: tasks.map((task) => String(task.id)) }, entityType: "task" },
      { organizationId: organizationB, entityId: { in: invites.map((invite) => invite.id) }, action: "MEMBER_INVITED", actorMembershipId: `m3-uat-membership:${runId}:foreign` },
    ] }, select: { id: true } });
    const meetings = await tx.meeting.findMany({ where: { caseId: { in: ids }, organizationId: organizationA }, select: { id: true } });
    // Same privileged test-only teardown mechanism as m3-fixture; never alter persistent triggers.
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.platformAuditEvent.deleteMany({ where: { id: { in: owner?.platformAuditEvents.map((event) => event.id) ?? [] } } });
    await tx.operationalAuditEvent.deleteMany({ where: { id: { in: audits.map((event) => event.id) } } });
    await tx.organizationInvite.deleteMany({ where: { id: { in: invites.map((invite) => invite.id) } } });
    await tx.projectionReceipt.deleteMany({ where: { organizationId: organizationA, sourceEventId: { in: events.map((event) => event.id) } } });
    await tx.task.deleteMany({ where: { id: { in: tasks.map((task) => task.id) } } });
    await tx.caseEvent.deleteMany({ where: { id: { in: events.map((event) => event.id) } } });
    await tx.caseDocumentRequirement.deleteMany({ where: { organizationId: organizationA, caseId: { in: ids } } });
    await tx.quoteLineItem.deleteMany({ where: { quoteVersionId: { in: versionIds } } });
    await tx.quoteVersion.deleteMany({ where: { id: { in: versionIds } } });
    await tx.quote.deleteMany({ where: { id: { in: quotes.map((quote) => quote.id) } } });
    await tx.meeting.deleteMany({ where: { id: { in: meetings.map((meeting) => meeting.id) } } });
    await tx.case.deleteMany({ where: { id: { in: cases.map((record) => record.id) } } });
    await tx.clientLead.deleteMany({ where: { id: { in: cases.map((record) => record.leadId) } } });
    if (owner) await tx.user.delete({ where: { id: owner.id } });
  });
}

async function main() {
  try {
    await verify();
    if (["provision", "provision-base"].includes(process.argv[2])) { stage = "provision"; await provision(process.argv[2] === "provision-base"); }
    else if (process.argv[2] === "finalize-http-publication") {
      stage = "finalize-http-publication";
      await db.$transaction(tx => finalizeCpoPublication(tx, publicationInput));
    }
    else if (process.argv[2] === "cleanup") {
      stage = "cleanup";
      await cleanup();
      process.stdout.write(`${JSON.stringify({ status: "CLEAN", source: "synthetic-cpo-repair-v1", runId })}\n`);
      return;
    } else if (process.argv[2] !== "status") throw new Error("Use provision, provision-base, finalize-http-publication, status or cleanup");
    stage = "manifest";
    process.stdout.write(`${JSON.stringify(await manifest(process.argv[2] === "provision-base"))}\n`);
  } finally { await db.$disconnect(); }
}
main().catch((error: unknown) => {
  const code = typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" && /^P\d{4}$/.test(error.code) ? error.code : "FIXTURE_FAILED";
  process.stderr.write(`CPO fixture refused or failed at ${stage}; code=${code}; no connection details emitted\n`);
  process.exitCode = 1;
});
