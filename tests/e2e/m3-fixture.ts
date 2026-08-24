import { createHash } from "node:crypto";
import { PrismaClient, type MembershipRole, type Prisma } from "@prisma/client";
import { hashPassword } from "../../lib/password";
import { encryptPlatformMfaSecret } from "../../lib/platformMfa";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";
import {
  assertIsolatedUatFingerprint,
  assertOnlyRecognisedSyntheticData,
  censusOfTarget,
  m1UatNamespace,
  m2UatNamespace,
  m3UatNamespace,
} from "./uatFixtureGuard";

const command = process.argv[2];
const runId = (process.env.M3_UAT_RUN_ID ?? "mission-3").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const target = inspectDirectMigrationUrl(directUrl);
const productionFingerprint = process.env.M3_PRODUCTION_DATABASE_FINGERPRINT;
const mfaSecret = process.env.M3_UAT_MFA_SECRET ?? "";
const namespace = m3UatNamespace(runId);
const [organizationA, organizationB] = namespace.organizationIds;
const emails = {
  agent: `m3-agent-${runId}@synthetic.invalid`,
  manager: `m3-manager-${runId}@synthetic.invalid`,
  reviewer: `m3-reviewer-${runId}@synthetic.invalid`,
  financeA: `m3-finance-a-${runId}@synthetic.invalid`,
  financeB: `m3-finance-b-${runId}@synthetic.invalid`,
  foreign: `m3-foreign-${runId}@synthetic.invalid`,
};
const policyVersion = 900_000 + Number.parseInt(createHash("sha256").update(runId).digest("hex").slice(0, 6), 16) % 90_000;
const typeCodes = {
  identity: `m3-uat:${runId}:identity`,
  death: `m3-uat:${runId}:death`,
  cremation: `m3-uat:${runId}:cremation`,
  plot: `m3-uat:${runId}:plot`,
  relationship: `m3-uat:${runId}:relationship`,
};

if (process.env.M3_UAT_FIXTURE !== "1") throw new Error("M3_UAT_FIXTURE=1 is required");
if (!mfaSecret || !/^[A-Z2-7]{32,}$/.test(mfaSecret)) throw new Error("M3_UAT_MFA_SECRET must be a valid protected Base32 secret");
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);
if (productionFingerprint && target.fingerprint === productionFingerprint) {
  throw new Error("Refusing to manage M3 UAT fixtures on production");
}
if (!isLocalTarget(directUrl) && !productionFingerprint) {
  throw new Error("Remote M3 UAT requires reviewed production fingerprint exclusion");
}

const db = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  try {
    await verifyTarget();
    if (command === "provision") await provision();
    else if (command === "cleanup") await cleanup();
    else if (command === "status") process.stdout.write(`${JSON.stringify(await status())}\n`);
    else throw new Error("Use provision, status or cleanup");
  } finally {
    await db.$disconnect();
  }
}

async function verifyTarget() {
  const identity = await db.$queryRaw<Array<{ database: string; readOnly: string }>>`
    SELECT current_database() AS database, current_setting('transaction_read_only') AS "readOnly"
  `;
  if (identity.length !== 1 || identity[0].database !== target.database || identity[0].readOnly !== "off") {
    throw new Error("M3 UAT target identity mismatch");
  }
  if (!isLocalTarget(directUrl)) {
    assertIsolatedUatFingerprint(target.fingerprint, {
      expected: process.env.EXPECTED_DATABASE_FINGERPRINT,
      production: productionFingerprint,
      label: "M3 UAT",
    });
    const allowed = [namespace];
    if (process.env.M1_UAT_RUN_ID) allowed.push(m1UatNamespace(process.env.M1_UAT_RUN_ID));
    if (process.env.M2_UAT_RUN_ID) allowed.push(m2UatNamespace(process.env.M2_UAT_RUN_ID));
    assertOnlyRecognisedSyntheticData(await censusOfTarget(db), allowed, "M3 UAT");
  }
}

async function provision() {
  await cleanup();
  const password = process.env.M3_UAT_PASSWORD;
  if (!password || password.length < 32) throw new Error("M3_UAT_PASSWORD must contain at least 32 characters");
  const passwordHash = hashPassword(password);
  const tier = await db.agentTier.upsert({
    where: { name: "M3 Synthetic UAT" },
    update: {},
    create: { name: "M3 Synthetic UAT", commissionPct: "0.00" },
  });

  const fixture = await db.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: organizationA, slug: `m3-uat-${runId}-a`, name: "Синтетическое агентство M3", status: "ACTIVE" } });
    await tx.organization.create({ data: { id: organizationB, slug: `m3-uat-${runId}-b`, name: "Изолированный tenant M3", status: "ACTIVE" } });
    const agent = await createIdentity(tx, tier.id, organizationA, "agent", emails.agent, "Агент M3", "AGENT", passwordHash);
    const manager = await createIdentity(tx, tier.id, organizationA, "manager", emails.manager, "Менеджер M3", "MANAGER", passwordHash);
    const reviewer = await createIdentity(tx, tier.id, organizationA, "reviewer", emails.reviewer, "Проверяющий M3", "DOCUMENT_REVIEWER", passwordHash);
    const financeMfa = encryptPlatformMfaSecret(mfaSecret);
    const financeA = await createIdentity(tx, tier.id, organizationA, "finance-a", emails.financeA, "Финансы M3 A", "FINANCE", passwordHash, financeMfa);
    const financeB = await createIdentity(tx, tier.id, organizationA, "finance-b", emails.financeB, "Финансы M3 B", "FINANCE", passwordHash, financeMfa);
    await createIdentity(tx, tier.id, organizationB, "foreign", emails.foreign, "Другой tenant M3", "AGENT", passwordHash);
    await createPolicies(tx, organizationA, manager.user.id);
    await tx.contractSigningPolicy.create({
      data: {
        organizationId: organizationA,
        version: "SYNTHETIC-UAT-V1",
        status: "APPROVED",
        allowedEvidenceTypes: ["SYNTHETIC_UAT_ACK"],
        source: "SYNTHETIC_UAT_NOT_A_LEGAL_VERDICT",
        approvedByUserId: manager.user.id,
        approvedAt: new Date(),
        effectiveFrom: new Date(Date.now() - 60_000),
      },
    });
    await tx.financialControlPolicy.create({
      data: {
        organizationId: organizationA,
        version: 1,
        status: "APPROVED",
        correctionThresholdKopecks: 1,
        source: "SYNTHETIC_UAT_NOT_A_FINANCE_VERDICT",
        approvedAt: new Date(),
      },
    });
    return { agent, manager, reviewer, financeA, financeB };
  }, { timeout: 120_000, maxWait: 30_000 });

  const cases = [];
  cases.push(await createCaseFixture(fixture.agent, "cremation", "Кремация M3 · синтетика", "CREMATION_V1", 17_600_000));
  cases.push(await createCaseFixture(fixture.agent, "burial", "Родственное захоронение M3 · синтетика", "FAMILY_PLOT_BURIAL_V1", 17_600_000));
  process.stdout.write(`${JSON.stringify({
    status: "READY",
    organizations: 2,
    users: Object.keys(emails).length,
    policyVersion,
    cases,
    emails,
  })}\n`);
}

async function createPolicies(tx: Prisma.TransactionClient, organizationId: string, approverUserId: number) {
  const types = [
    [typeCodes.identity, "Документ, удостоверяющий личность"],
    [typeCodes.death, "Документ о смерти"],
    [typeCodes.cremation, "Основание для кремации"],
    [typeCodes.plot, "Право на родственный участок"],
    [typeCodes.relationship, "Подтверждение родства"],
  ] as const;
  const typeIds = new Map<string, string>();
  for (const [code, name] of types) {
    const documentType = await tx.documentTypeDefinition.create({
      data: {
        organizationId,
        code,
        version: 1,
        name,
        description: "Synthetic isolated UAT document type",
        allowedMimeTypes: ["application/pdf"],
        maxBytes: 1_048_576,
        status: "APPROVED",
        source: "SYNTHETIC_UAT_NOT_A_RITUAL_OR_LEGAL_VERDICT",
      },
      select: { id: true },
    });
    typeIds.set(code, documentType.id);
  }
  const policyInput = [
    {
      scenario: "CREMATION_V1" as const,
      rules: [
        ["identity-record", typeCodes.identity, ["readable", "identity_match"]],
        ["death-record", typeCodes.death, ["readable", "identity_match"]],
        ["cremation-authorization", typeCodes.cremation, ["readable", "authority"]],
      ],
    },
    {
      scenario: "FAMILY_PLOT_BURIAL_V1" as const,
      rules: [
        ["identity-record", typeCodes.identity, ["readable", "identity_match"]],
        ["death-record", typeCodes.death, ["readable", "identity_match"]],
        ["plot-entitlement", typeCodes.plot, ["readable", "authority"]],
        ["relationship-evidence", typeCodes.relationship, ["readable", "identity_match"]],
      ],
    },
  ] as const;
  for (const input of policyInput) {
    await tx.documentRequirementPolicy.create({
      data: {
        organizationId,
        scenario: input.scenario,
        version: policyVersion,
        status: "APPROVED",
        source: "SYNTHETIC_UAT_NOT_A_RITUAL_OR_LEGAL_VERDICT",
        approvedByUserId: approverUserId,
        approvedAt: new Date(),
        effectiveFrom: new Date(Date.now() - 60_000),
        rules: {
          create: input.rules.map(([stableKey, documentType, checklist]) => ({
            stableKey,
            kind: "REQUIRED",
            dueOffsetHours: 24,
            ownerRole: "AGENT",
            blockingStage: "EXECUTION",
            acceptedDocumentTypeCodes: [documentType],
            acceptedDocumentTypeVersionIds: [typeIds.get(documentType)!],
            reviewChecklist: checklist,
            source: "SYNTHETIC_UAT_NOT_A_RITUAL_OR_LEGAL_VERDICT",
          })),
        },
      },
    });
  }
}

async function createCaseFixture(
  identity: Awaited<ReturnType<typeof createIdentity>>,
  key: string,
  name: string,
  scenario: "CREMATION_V1" | "FAMILY_PLOT_BURIAL_V1",
  totalKopecks: number,
) {
  const snapshot = JSON.stringify({ schemaVersion: 1, scenario, totalKopecks, source: "synthetic-m3-uat" });
  const row = await db.$transaction(async (tx) => {
    const lead = await tx.clientLead.create({
      data: {
        agentId: identity.agent.id,
        name,
        phone: key === "cremation" ? "+70000000301" : "+70000000302",
        source: "synthetic-uat",
        ceremonyType: scenario === "CREMATION_V1" ? "кремация" : "родственное захоронение",
        deceasedName: "Синтетические данные M3",
        ceremonyAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    const canonicalCase = await tx.case.create({
      data: {
        id: `m3-uat-case:${runId}:${key}`,
        publicRef: `M3-${runId.toUpperCase()}-${key === "cremation" ? "C" : "B"}`,
        leadId: lead.id,
        tenantId: organizationA,
        ownerId: identity.agent.id,
        scenarioId: scenario,
        stage: "CONTRACTING",
        version: 5,
      },
    });
    const meeting = await tx.meeting.create({
      data: {
        leadId: lead.id,
        agentId: identity.agent.id,
        organizationId: organizationA,
        caseId: canonicalCase.id,
        ownerMembershipId: identity.membership.id,
        status: "SCHEDULED",
        type: "CONSULTATION",
        operationalStatus: "CONFIRMED",
        channel: "IN_PERSON",
        timezone: "Europe/Moscow",
        idempotencyKey: `m3-uat:${runId}:${key}:meeting`,
        scheduledAt: new Date(Date.now() + 86_400_000),
      },
    });
    const quote = await tx.quote.create({
      data: {
        meetingId: meeting.id,
        organizationId: organizationA,
        caseId: canonicalCase.id,
        ownerMembershipId: identity.membership.id,
        scenario,
        status: "ACCEPTED",
        currency: "RUB",
      },
    });
    const version = await tx.quoteVersion.create({
      data: {
        quoteId: quote.id,
        versionNumber: 1,
        state: "DRAFT",
        payload: snapshot,
        subtotal: totalKopecks,
        discountTotal: 0,
        total: totalKopecks,
        totalState: "KNOWN",
        currency: "RUB",
        snapshotChecksum: createHash("sha256").update(snapshot).digest("hex"),
        publishedByMembershipId: identity.membership.id,
        publishedAt: new Date(),
        publishReason: "Synthetic isolated M3 UAT baseline",
        publishChannel: "isolated-uat",
        validUntil: new Date(Date.now() + 14 * 86_400_000),
        idempotencyKey: `m3-uat:${runId}:${key}:quote-v1`,
        correlationId: `m3-uat:${runId}:${key}`,
      },
    });
    await tx.quoteLineItem.create({
      data: {
        quoteVersionId: version.id,
        stableKey: `m3-uat:${runId}:${key}:service`,
        position: 0,
        type: "SERVICE",
        serviceCode: `m3-uat-${key}`,
        description: "Синтетическая услуга M3",
        quantity: 1,
        unit: "услуга",
        priceState: "KNOWN",
        clientUnitPrice: totalKopecks,
        costState: "UNKNOWN",
        unitCost: null,
        discountAmount: 0,
        included: false,
        optional: false,
        relationKind: "STANDALONE",
        source: "synthetic-uat",
        sourceVersion: "1",
        scenarioCompatibility: [scenario],
      },
    });
    await tx.quoteVersion.update({ where: { id: version.id }, data: { state: "PUBLISHED" } });
    await tx.quote.update({ where: { id: quote.id }, data: { latestPublishedVersionId: version.id } });
    await tx.case.update({ where: { id: canonicalCase.id }, data: { publishedQuoteVersionId: version.id } });
    return { leadId: lead.id, caseId: canonicalCase.id, quoteVersionId: version.id, key };
  });
  await materializeSyntheticRequirements(row.caseId, scenario, identity.membership.id, key);
  return row;
}

async function materializeSyntheticRequirements(
  caseId: string,
  scenario: "CREMATION_V1" | "FAMILY_PLOT_BURIAL_V1",
  actorMembershipId: string,
  key: string,
) {
  const [policy, reviewer] = await Promise.all([
    db.documentRequirementPolicy.findFirst({
      where: { organizationId: organizationA, scenario, version: policyVersion, status: "APPROVED" },
      include: { rules: { orderBy: { stableKey: "asc" } } },
    }),
    db.membership.findFirst({
      where: { organizationId: organizationA, role: "DOCUMENT_REVIEWER", status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  ]);
  if (!policy || policy.rules.length === 0) throw new Error(`Synthetic M3 policy missing for ${scenario}`);
  const now = new Date();
  const idempotencyKey = `m3-uat:${runId}:${key}:requirements`;
  const [inserted] = await db.$transaction([
    db.caseDocumentRequirement.createMany({
      data: policy.rules.map((rule) => ({
        organizationId: organizationA,
        caseId,
        policyId: policy.id,
        ruleId: rule.id,
        policyVersion: policy.version,
        stableKey: rule.stableKey,
        kind: rule.kind,
        conditionExplanation: rule.conditionExplanation,
        dueAt: rule.dueOffsetHours == null ? null : new Date(now.getTime() + rule.dueOffsetHours * 3_600_000),
        ownerMembershipId: reviewer?.id ?? null,
        ownerRole: rule.ownerRole,
        blockingStage: rule.blockingStage,
        acceptedDocumentTypeCodes: rule.acceptedDocumentTypeCodes as Prisma.InputJsonValue,
        acceptedDocumentTypeVersionIds: rule.acceptedDocumentTypeVersionIds as Prisma.InputJsonValue,
        reviewChecklist: rule.reviewChecklist as Prisma.InputJsonValue,
        satisfactionStatus: "NOT_SATISFIED",
        sourceRule: rule.source,
      })),
      skipDuplicates: true,
    }),
    db.operationalAuditEvent.create({
      data: {
        organizationId: organizationA,
        actorMembershipId,
        actorType: "fixture",
        entityType: "document_requirement",
        entityId: caseId,
        action: "document_requirements.materialized.v1",
        before: {},
        after: { policyId: policy.id, policyVersion: policy.version, scenario, ruleCount: policy.rules.length },
        reason: "Synthetic isolated UAT requirement materialization",
        correlationId: `m3-uat:${runId}:${key}`,
        causationId: idempotencyKey,
        idempotencyKey: `${idempotencyKey}:document-requirements`,
        result: { created: policy.rules.length, existing: 0, notApplicable: 0, policyId: policy.id },
      },
    }),
  ]);
  if (inserted.count !== policy.rules.length) {
    throw new Error(`Synthetic M3 requirement count mismatch for ${scenario}`);
  }
}

async function createIdentity(
  tx: Prisma.TransactionClient,
  tierId: number,
  organizationId: string,
  suffix: string,
  email: string,
  name: string,
  role: MembershipRole,
  passwordHash: string,
  mfaSecretEncrypted?: string,
) {
  const user = await tx.user.create({
    data: {
      email,
      name,
      passwordHash,
      platformMfaSecretEncrypted: mfaSecretEncrypted,
      platformMfaEnabledAt: mfaSecretEncrypted ? new Date() : null,
    },
  });
  const agent = await tx.agent.create({ data: { userId: user.id, tierId, status: "ACTIVE", selfEmployed: false, onboardingCompleted: true, notifyEnabled: false } });
  const membership = await tx.membership.create({
    data: { id: `m3-uat-membership:${runId}:${suffix}`, organizationId, userId: user.id, agentId: agent.id, role, status: "ACTIVE" },
  });
  return { user, agent, membership };
}

async function cleanup() {
  const organizations = await db.organization.findMany({ where: { id: { in: [organizationA, organizationB] } }, select: { id: true } });
  const policies = await db.documentRequirementPolicy.findMany({
    where: { organizationId: { in: [organizationA, organizationB] }, version: policyVersion },
    select: { id: true },
  });
  const types = await db.documentTypeDefinition.findMany({
    where: { organizationId: { in: [organizationA, organizationB] }, code: { in: Object.values(typeCodes) } },
    select: { id: true },
  });
  if (organizations.length === 0 && policies.length === 0 && types.length === 0) return;
  if (!isLocalTarget(directUrl) && process.env.M3_ALLOW_REMOTE_FIXTURE_CLEANUP !== "YES") {
    throw new Error("Remote M3 fixture cleanup requires deletion of the isolated database resource, not row cleanup");
  }
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    const organizationIds = organizations.map((item) => item.id);
    const memberships = await tx.membership.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true, userId: true, agentId: true } });
    const membershipIds = memberships.map((item) => item.id);
    const userIds = memberships.map((item) => item.userId);
    const agentIds = memberships.flatMap((item) => item.agentId == null ? [] : [item.agentId]);
    const cases = await tx.case.findMany({ where: { tenantId: { in: organizationIds } }, select: { id: true, leadId: true } });
    const caseIds = cases.map((item) => item.id);
    const leadIds = cases.map((item) => item.leadId);
    const meetings = await tx.meeting.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true } });
    const meetingIds = meetings.map((item) => item.id);
    const quotes = await tx.quote.findMany({ where: { organizationId: { in: organizationIds } }, select: { id: true } });
    const quoteIds = quotes.map((item) => item.id);
    const versionIds = await tx.quoteVersion.findMany({ where: { quoteId: { in: quoteIds } }, select: { id: true } });
    if (caseIds.length) {
      await tx.case.updateMany({ where: { id: { in: caseIds } }, data: { publishedQuoteVersionId: null } });
      await tx.caseDocumentRequirement.updateMany({ where: { caseId: { in: caseIds } }, data: { satisfactionStatus: "NOT_SATISFIED", satisfiedByVersionId: null } });
      await tx.documentAccessEvent.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.paymentWebhookReceipt.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.paymentLedgerApproval.deleteMany({ where: { ledgerEntry: { caseId: { in: caseIds } } } });
      await tx.paymentLedgerEntry.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.paymentObligation.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.contractVersion.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.contract.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.caseDocumentVersion.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.caseDocument.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.caseDocumentRequirement.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.casePartyRoleAssignment.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.caseParty.deleteMany({ where: { caseId: { in: caseIds } } });
      await tx.caseEvent.deleteMany({ where: { caseId: { in: caseIds } } });
    }
    if (organizationIds.length) {
      if (policies.length) {
        await tx.documentRequirementRule.deleteMany({ where: { policyId: { in: policies.map((item) => item.id) } } });
        await tx.documentRequirementPolicy.deleteMany({ where: { id: { in: policies.map((item) => item.id) } } });
      }
      if (types.length) await tx.documentTypeDefinition.deleteMany({ where: { id: { in: types.map((item) => item.id) } } });
      await tx.contractSigningPolicy.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.financialControlPolicy.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.operationalAuditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.projectionReceipt.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.savedOperationalView.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.organizationInvite.deleteMany({ where: { organizationId: { in: organizationIds } } });
      await tx.task.deleteMany({ where: { organizationId: { in: organizationIds } } });
    }
    if (versionIds.length) {
      const ids = versionIds.map((item) => item.id);
      await tx.quoteClientDecision.deleteMany({ where: { quoteVersionId: { in: ids } } });
      await tx.quoteClientLink.deleteMany({ where: { quoteVersionId: { in: ids } } });
      await tx.quoteLineItem.deleteMany({ where: { quoteVersionId: { in: ids } } });
    }
    if (quoteIds.length) {
      await tx.quotePresentationSession.deleteMany({ where: { quoteId: { in: quoteIds } } });
      await tx.quoteVersion.deleteMany({ where: { quoteId: { in: quoteIds } } });
      await tx.quote.deleteMany({ where: { id: { in: quoteIds } } });
    }
    if (meetingIds.length) {
      await tx.agentSession.deleteMany({ where: { meetingId: { in: meetingIds } } });
      await tx.payment.deleteMany({ where: { meetingId: { in: meetingIds } } });
      await tx.meeting.deleteMany({ where: { id: { in: meetingIds } } });
    }
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
    if (organizationIds.length) await tx.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }, { timeout: 120_000, maxWait: 30_000 });
  await db.agentTier.deleteMany({ where: { name: "M3 Synthetic UAT", agents: { none: {} } } });
  process.stdout.write(`${JSON.stringify({ status: "CLEAN" })}\n`);
}

async function status() {
  const [organizations, users, cases, requirements] = await Promise.all([
    db.organization.count({ where: { id: { in: [organizationA, organizationB] } } }),
    db.user.count({ where: { email: { in: Object.values(emails) } } }),
    db.case.count({ where: { id: { in: [`m3-uat-case:${runId}:cremation`, `m3-uat-case:${runId}:burial`] } } }),
    db.caseDocumentRequirement.count({ where: { organizationId: organizationA } }),
  ]);
  return { status: organizations === 2 && users === 6 && cases === 2 ? "READY" : "ABSENT", organizations, users, cases, requirements };
}

function isLocalTarget(value: string | undefined) {
  if (!value) return false;
  const url = new URL(value);
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "M3 fixture failed"}\n`);
  process.exitCode = 1;
});
