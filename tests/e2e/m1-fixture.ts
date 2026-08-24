import { PrismaClient, type MembershipRole, type Prisma } from "@prisma/client";
import {
  assertIsolatedUatFingerprint,
  assertOnlyRecognisedSyntheticData,
  censusOfTarget,
  m1UatNamespace,
  m2UatNamespace,
} from "./uatFixtureGuard";
import { inspectDirectMigrationUrl, assertExpectedMigrationTarget } from "../../lib/migrationTarget";
import { hashPassword } from "../../lib/password";
import { transitionCase } from "../../lib/caseService";
import { createMeeting, updateMeetingStatus } from "../../lib/meetingService";
import { assignTask, createTask, waitTask } from "../../lib/taskService";
import { ensurePastMeetingEscalations } from "../../lib/operationsProjection";
import { reconcileOperations } from "../../lib/operationsReconciliation";
import type { OperationalContext } from "../../lib/operationalAuth";
import { persistentRateLimitKey } from "../../lib/persistentRateLimit";

const command = process.argv[2];
const runId = (process.env.M1_UAT_RUN_ID ?? "mission-1").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
const organizationId = `m1-uat:${runId}`;
const agentEmail = `m1-agent-${runId}@synthetic.invalid`;
const assignedAgentEmail = `m1-assigned-${runId}@synthetic.invalid`;
const managerEmail = `m1-manager-${runId}@synthetic.invalid`;
const productionFingerprint = process.env.M1_PRODUCTION_DATABASE_FINGERPRINT;
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const target = inspectDirectMigrationUrl(directUrl);

if (process.env.M1_UAT_FIXTURE !== "1") throw new Error("M1_UAT_FIXTURE=1 is required");
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);
if (productionFingerprint && target.fingerprint === productionFingerprint) {
  throw new Error("Refusing to manage M1 UAT fixtures on the production database target");
}
if (!isLocalTarget(directUrl) && !productionFingerprint) {
  throw new Error("Remote M1 UAT requires the separately reviewed production fingerprint for exclusion");
}

const db = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  try {
    await verifyTargetIdentity();
    if (command === "provision") {
      await provision();
    } else if (command === "cleanup") {
      await cleanup();
      process.stdout.write(`${JSON.stringify({ status: "CLEAN", organizationId })}\n`);
    } else if (command === "status") {
      process.stdout.write(`${JSON.stringify(await status())}\n`);
    } else {
      throw new Error("Use provision, status or cleanup");
    }
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "M1 UAT fixture failed"}\n`);
  process.exitCode = 1;
});

async function verifyTargetIdentity() {
  const identity = await db.$queryRaw<Array<{ database: string; readOnly: string }>>`
    SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
  `;
  if (identity.length !== 1 || identity[0].database !== target.database || identity[0].readOnly !== "off") {
    throw new Error("M1 UAT target identity is not writable or does not match its reviewed endpoint");
  }
  if (!isLocalTarget(directUrl)) {
    assertIsolatedUatFingerprint(target.fingerprint, {
      expected: process.env.EXPECTED_DATABASE_FINGERPRINT,
      production: productionFingerprint,
      label: "M1 UAT",
    });
    // Empty, or holding only this mission's own synthetic rows — nothing else. The M2
    // sibling fixture is admissible so both can share one isolated UAT database; any row
    // outside those exact namespaces refuses the run.
    const allowed = [m1UatNamespace(runId)];
    const siblingRunId = process.env.M2_UAT_RUN_ID;
    if (siblingRunId) allowed.push(m2UatNamespace(siblingRunId));
    assertOnlyRecognisedSyntheticData(await censusOfTarget(db), allowed, "M1 UAT");
  }
}

async function provision() {
  await cleanup();
  const password = process.env.M1_UAT_PASSWORD;
  if (!password || password.length < 32) throw new Error("M1_UAT_PASSWORD must contain at least 32 characters");
  const passwordHash = hashPassword(password);
  const tier = await db.agentTier.upsert({
    where: { name: "M1 Synthetic UAT" },
    update: {},
    create: { name: "M1 Synthetic UAT", commissionPct: "0.00" },
  });

  const identities = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { id: organizationId, slug: `m1-uat-${runId}`, name: "Синтетическая команда M1", timezone: "Europe/Moscow" },
    });
    const agent = await createIdentity(tx, tier.id, "agent", "Синтетический агент", agentEmail, "AGENT", passwordHash);
    const assignedAgent = await createIdentity(tx, tier.id, "assigned", "Синтетический координатор", assignedAgentEmail, "AGENT", passwordHash);
    const manager = await createIdentity(tx, tier.id, "manager", "Синтетический руководитель", managerEmail, "MANAGER", passwordHash);
    return { organization, agent, assignedAgent, manager };
  });

  const agent = operationalContext(identities.agent, "AGENT", "Синтетический агент");
  const manager = operationalContext(identities.manager, "MANAGER", "Синтетический руководитель");
  const scenarios = [
    { key: "cremation", name: "Семья Кремова · синтетика", ceremonyType: "кремация", scenarioId: "CREMATION_V1" as const },
    { key: "family", name: "Семья Участкова · синтетика", ceremonyType: "родственное захоронение", scenarioId: "FAMILY_PLOT_BURIAL_V1" as const },
  ];
  const pilotRows: Array<{ key: string; leadId: number; caseId: string; meetingId: number }> = [];

  for (const [index, scenario] of scenarios.entries()) {
    const lead = await db.clientLead.create({
      data: {
        agentId: agent.agentId,
        name: scenario.name,
        phone: `+70000000${index + 101}`,
        source: "synthetic-uat",
        ceremonyType: scenario.ceremonyType,
        deceasedName: "Синтетические данные",
        ceremonyAt: new Date(Date.now() + (48 + index * 24) * 3_600_000),
      },
    });
    const canonicalCase = await db.case.create({
      data: {
        id: `m1-uat-case:${runId}:${scenario.key}`,
        publicRef: `M1-${runId.toUpperCase()}-${index + 1}`,
        leadId: lead.id,
        tenantId: organizationId,
        ownerId: agent.agentId,
      },
    });
    await transitionCase({
      leadId: lead.id,
      eventType: "intake.completed.v1",
      context: caseContext(agent, `${scenario.key}:intake`),
    });
    await transitionCase({
      leadId: lead.id,
      eventType: "scenario.selected.v1",
      payload: { scenarioId: scenario.scenarioId },
      context: caseContext(agent, `${scenario.key}:scenario`),
    });

    const scheduledAt = scenario.key === "family"
      ? new Date(Date.now() - 2 * 3_600_000)
      : new Date(Date.now() + 2 * 3_600_000);
    const meeting = await createMeeting(agent, {
      leadId: lead.id,
      scheduledAt,
      type: "CONSULTATION",
      channel: "IN_PERSON",
      location: "Синтетическая переговорная",
      durationMinutes: 60,
    }, meta(`${scenario.key}:meeting`));
    const confirmed = await updateMeetingStatus(agent, meeting.id, {
      status: "CONFIRMED",
      version: meeting.version,
    }, meta(`${scenario.key}:meeting-confirmed`));

    if (scenario.key === "family") {
      const preparation = await db.task.findFirstOrThrow({
        where: { organizationId, caseId: canonicalCase.id, type: "PREPARATION", status: "OPEN" },
      });
      await assignTask(manager, preparation.id, {
        assigneeMembershipId: null,
        reason: "Синтетический UAT: руководитель должен назначить исполнителя",
        version: preparation.version,
      }, meta(`${scenario.key}:unassign`));
    } else {
      const quoteTask = await db.task.findFirstOrThrow({
        where: { organizationId, caseId: canonicalCase.id, type: "QUOTE_SEND", status: "OPEN" },
      });
      await waitTask(agent, quoteTask.id, {
        waitingReason: "Синтетический UAT: ожидаем подтверждение состава",
        version: quoteTask.version,
      }, meta(`${scenario.key}:waiting`));
    }

    pilotRows.push({ key: scenario.key, leadId: lead.id, caseId: canonicalCase.id, meetingId: confirmed.id });
  }

  const cremation = pilotRows.find((row) => row.key === "cremation")!;
  await createTask(agent, {
    leadId: cremation.leadId,
    title: "Синтетический UAT: срочное действие",
    dueAt: new Date(Date.now() - 30 * 60_000),
    priority: "CRITICAL",
    expectedOutcome: "Результат зафиксирован",
  }, meta("cremation:overdue"));
  await ensurePastMeetingEscalations(manager, new Date());

  const reconciliation = await reconcileOperations(organizationId, new Date());
  if (reconciliation.discrepancies !== 0) throw new Error("M1 UAT fixture reconciliation failed");
  process.stdout.write(`${JSON.stringify({
    status: "READY",
    organizationId,
    agentEmail,
    assignedAgentEmail,
    managerEmail,
    pilots: pilotRows,
    reconciliation: reconciliation.discrepancies,
  })}\n`);
}

async function createIdentity(
  tx: Prisma.TransactionClient,
  tierId: number,
  suffix: string,
  name: string,
  email: string,
  role: MembershipRole,
  passwordHash: string,
) {
  const user = await tx.user.create({ data: { email, name, passwordHash } });
  const agent = await tx.agent.create({
    data: { userId: user.id, tierId, status: "ACTIVE", selfEmployed: false, onboardingCompleted: true, notifyEnabled: false },
  });
  const membership = await tx.membership.create({
    data: {
      id: `m1-uat-membership:${runId}:${suffix}`,
      organizationId,
      userId: user.id,
      agentId: agent.id,
      role,
      status: "ACTIVE",
    },
  });
  return { user, agent, membership };
}

function operationalContext(identity: Awaited<ReturnType<typeof createIdentity>>, role: MembershipRole, name: string): OperationalContext {
  return {
    userId: identity.user.id,
    agentId: identity.agent.id,
    membershipId: identity.membership.id,
    organizationId,
    role,
    timezone: "Europe/Moscow",
    name,
    platformRole: "USER",
  };
}

function caseContext(context: OperationalContext, suffix: string) {
  const operation = `m1-uat:${runId}:${suffix}`;
  return {
    organizationId,
    membershipId: context.membershipId,
    agentId: context.agentId,
    actorId: context.agentId,
    idempotencyKey: operation,
    correlationId: `m1-uat:${runId}`,
  };
}

function meta(suffix: string) {
  const operation = `m1-uat:${runId}:${suffix}`;
  return { idempotencyKey: operation, correlationId: `m1-uat:${runId}` };
}

async function status() {
  const [organizations, memberships, cases, tasks, meetings, auditEvents] = await Promise.all([
    db.organization.count({ where: { id: organizationId } }),
    db.membership.count({ where: { organizationId } }),
    db.case.count({ where: { tenantId: organizationId } }),
    db.task.count({ where: { organizationId } }),
    db.meeting.count({ where: { organizationId } }),
    db.operationalAuditEvent.count({ where: { organizationId } }),
  ]);
  return { status: organizations === 1 ? "READY" : "ABSENT", organizationId, memberships, cases, tasks, meetings, auditEvents };
}

async function cleanup() {
  const organization = await db.organization.findUnique({ where: { id: organizationId } });
  if (!organization) return;
  if (!isLocalTarget(directUrl) && process.env.M1_ALLOW_REMOTE_FIXTURE_CLEANUP !== "YES") {
    throw new Error("Remote M1 fixture cleanup requires deletion of the isolated database resource, not row cleanup");
  }
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    const memberships = await tx.membership.findMany({ where: { organizationId }, select: { id: true, userId: true, agentId: true } });
    const membershipIds = memberships.map((row) => row.id);
    const userIds = memberships.map((row) => row.userId);
    const agentIds = memberships.flatMap((row) => row.agentId == null ? [] : [row.agentId]);
    const cases = await tx.case.findMany({ where: { tenantId: organizationId }, select: { id: true, leadId: true } });
    const caseIds = cases.map((row) => row.id);
    const leadIds = cases.map((row) => row.leadId);
    const meetings = await tx.meeting.findMany({ where: { organizationId }, select: { id: true } });
    const meetingIds = meetings.map((row) => row.id);
    const quotes = meetingIds.length
      ? await tx.quote.findMany({ where: { meetingId: { in: meetingIds } }, select: { id: true } })
      : [];
    const quoteIds = quotes.map((row) => row.id);

    if (caseIds.length) await tx.case.updateMany({ where: { id: { in: caseIds } }, data: { publishedQuoteVersionId: null } });
    await tx.operationalAuditEvent.deleteMany({ where: { organizationId } });
    await tx.projectionReceipt.deleteMany({ where: { organizationId } });
    await tx.savedOperationalView.deleteMany({ where: { organizationId } });
    await tx.organizationInvite.deleteMany({ where: { organizationId } });
    await tx.task.deleteMany({ where: { organizationId } });
    if (isLocalTarget(directUrl)) {
      const localIps = ["unknown", "127.0.0.1", "::1", "::ffff:127.0.0.1"];
      const commercialBuckets = ["commercial-client-view", "commercial-client-decision"];
      await tx.securityRateLimitBucket.deleteMany({
        where: {
          keyHash: {
            in: commercialBuckets.flatMap((bucket) =>
              localIps.map((ip) => persistentRateLimitKey(bucket, ip))),
          },
        },
      });
    }
    if (membershipIds.length) {
      await tx.quoteClientLink.deleteMany({ where: { createdByMembershipId: { in: membershipIds } } });
      await tx.quotePresentationSession.deleteMany({ where: { ownerMembershipId: { in: membershipIds } } });
    }
    if (caseIds.length) await tx.caseEvent.deleteMany({ where: { caseId: { in: caseIds } } });
    if (meetingIds.length) await tx.agentSession.deleteMany({ where: { meetingId: { in: meetingIds } } });
    if (quoteIds.length) {
      await tx.quote.updateMany({
        where: { id: { in: quoteIds } },
        data: { activeDraftVersionId: null, latestPublishedVersionId: null },
      });
      await tx.quotePresentationSession.deleteMany({ where: { quoteId: { in: quoteIds } } });
      await tx.quoteClientDecision.deleteMany({ where: { quoteVersion: { quoteId: { in: quoteIds } } } });
      await tx.quoteClientLink.deleteMany({ where: { quoteVersion: { quoteId: { in: quoteIds } } } });
      await tx.quoteLineItem.deleteMany({ where: { quoteVersion: { quoteId: { in: quoteIds } } } });
      await tx.quoteVersion.deleteMany({ where: { quoteId: { in: quoteIds } } });
      await tx.quote.deleteMany({ where: { id: { in: quoteIds } } });
    }
    if (meetingIds.length) await tx.meeting.deleteMany({ where: { id: { in: meetingIds } } });
    if (caseIds.length) await tx.case.deleteMany({ where: { id: { in: caseIds } } });
    if (leadIds.length) {
      await tx.document.deleteMany({ where: { leadId: { in: leadIds } } });
      await tx.casePayment.deleteMany({ where: { leadId: { in: leadIds } } });
      await tx.caseNote.deleteMany({ where: { leadId: { in: leadIds } } });
      await tx.clientLead.deleteMany({ where: { id: { in: leadIds } } });
    }
    if (membershipIds.length) await tx.membership.deleteMany({ where: { id: { in: membershipIds } } });
    if (agentIds.length) await tx.agent.deleteMany({ where: { id: { in: agentIds } } });
    if (userIds.length) await tx.user.deleteMany({ where: { id: { in: userIds } } });
    await tx.organization.delete({ where: { id: organizationId } });
  }, { timeout: 120_000, maxWait: 30_000 });
  await db.agentTier.deleteMany({ where: { name: "M1 Synthetic UAT", agents: { none: {} } } });
}

function isLocalTarget(value: string | undefined) {
  if (!value) return false;
  const url = new URL(value);
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}
