import { PrismaClient, type MembershipRole, type Prisma } from "@prisma/client";
import { assertExpectedMigrationTarget, inspectDirectMigrationUrl } from "../../lib/migrationTarget";
import {
  assertIsolatedUatFingerprint,
  assertOnlyRecognisedSyntheticData,
  censusOfTarget,
  m1UatNamespace,
  m2UatNamespace,
} from "./uatFixtureGuard";
import { hashPassword } from "../../lib/password";
import { hashPlatformActivationToken, isPlatformActivationTokenShape } from "../../lib/platformActivation";
import { encryptPlatformMfaSecret } from "../../lib/platformMfa";
import {
  hashPlatformOwnerRecoveryToken,
  isPlatformOwnerRecoveryTokenShape,
} from "../../lib/platformOwnerRecovery";
import { persistentRateLimitKey } from "../../lib/persistentRateLimit";

const command = process.argv[2];
const runId = (process.env.M2_UAT_RUN_ID ?? "mission-2").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
const directUrl = process.env.DATABASE_URL_UNPOOLED;
const target = inspectDirectMigrationUrl(directUrl);
const productionFingerprint = process.env.M2_PRODUCTION_DATABASE_FINGERPRINT;
const organizationA = `m2-uat-${runId}-a`;
const organizationB = `m2-uat-${runId}-b`;
const emails = {
  platform: `m2-platform-${runId}@synthetic.invalid`,
  activation: `m2-activation-${runId}@synthetic.invalid`,
  admin: `m2-admin-${runId}@synthetic.invalid`,
  manager: `m2-manager-${runId}@synthetic.invalid`,
  agent: `m2-agent-${runId}@synthetic.invalid`,
  second: `m2-second-${runId}@synthetic.invalid`,
};

if (process.env.M2_UAT_FIXTURE !== "1") throw new Error("M2_UAT_FIXTURE=1 is required");
assertExpectedMigrationTarget(target, process.env.EXPECTED_DATABASE_FINGERPRINT);
if (productionFingerprint && target.fingerprint === productionFingerprint) {
  throw new Error("Refusing to manage M2 UAT fixtures on production");
}
if (!isLocalTarget(directUrl) && !productionFingerprint) {
  throw new Error("Remote M2 UAT requires reviewed production fingerprint exclusion");
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
    throw new Error("M2 UAT target identity mismatch");
  }
  if (!isLocalTarget(directUrl)) {
    assertIsolatedUatFingerprint(target.fingerprint, {
      expected: process.env.EXPECTED_DATABASE_FINGERPRINT,
      production: productionFingerprint,
      label: "M2 UAT",
    });
    const allowed = [m2UatNamespace(runId)];
    const siblingRunId = process.env.M1_UAT_RUN_ID;
    if (siblingRunId) allowed.push(m1UatNamespace(siblingRunId));
    assertOnlyRecognisedSyntheticData(await censusOfTarget(db), allowed, "M2 UAT");
  }
}

async function provision() {
  await cleanup();
  const password = process.env.M2_UAT_PASSWORD;
  const activationToken = process.env.M2_UAT_ACTIVATION_TOKEN;
  const recoveryToken = process.env.M2_UAT_RECOVERY_TOKEN;
  const mfaSecret = process.env.M2_UAT_MFA_SECRET;
  if (!password || password.length < 32) throw new Error("M2_UAT_PASSWORD must contain at least 32 characters");
  if (!activationToken || !isPlatformActivationTokenShape(activationToken)) {
    throw new Error("M2_UAT_ACTIVATION_TOKEN must be a 32-byte base64url token");
  }
  if (!recoveryToken || !isPlatformOwnerRecoveryTokenShape(recoveryToken)) {
    throw new Error("M2_UAT_RECOVERY_TOKEN must be a 32-byte base64url token");
  }
  if (!mfaSecret || !/^[A-Z2-7]{32}$/.test(mfaSecret)) {
    throw new Error("M2_UAT_MFA_SECRET must be a 20-byte base32 secret");
  }
  const mfaSecretEncrypted = encryptPlatformMfaSecret(mfaSecret);
  const passwordHash = hashPassword(password);
  const platformPreviousPasswordHash = hashPassword(`${password}-previous`);
  const tier = await db.agentTier.upsert({
    where: { name: "M2 Synthetic UAT" },
    update: {},
    create: { name: "M2 Synthetic UAT", commissionPct: "0.00" },
  });
  await db.$transaction(async (tx) => {
    await tx.organization.create({ data: { id: organizationA, slug: `m2-uat-${runId}-a`, name: "Синтетическое агентство M2", status: "ACTIVE" } });
    await tx.organization.create({ data: { id: organizationB, slug: `m2-uat-${runId}-b`, name: "Другая синтетическая организация", status: "ACTIVE" } });
    const platform = await tx.user.create({
      data: {
        email: emails.platform,
        name: "Владелец платформы M2",
        passwordHash: platformPreviousPasswordHash,
        platformRole: "SUPER_ADMIN",
        platformMfaSecretEncrypted: mfaSecretEncrypted,
        platformMfaEnabledAt: new Date(),
      },
    });
    await tx.platformAuditEvent.create({
      data: {
        actorUserId: platform.id,
        action: "PLATFORM_ROLE_BOOTSTRAPPED",
        targetType: "user",
        targetId: String(platform.id),
        metadata: { source: "isolated-e2e-fixture" },
      },
    });
    const recovery = await tx.platformAccountActivation.create({
      data: {
        userId: platform.id,
        purpose: "OWNER_RECOVERY",
        tokenHash: hashPlatformOwnerRecoveryToken(recoveryToken),
        mfaSecretEncrypted,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    await tx.platformAuditEvent.create({
      data: {
        actorUserId: platform.id,
        action: "PLATFORM_OWNER_RECOVERY_CREATED",
        targetType: "activation",
        targetId: recovery.id,
        metadata: { source: "isolated-e2e-fixture" },
      },
    });
    const activationUser = await tx.user.create({
      data: {
        email: emails.activation,
        name: "Первичная активация M2",
        passwordHash: null,
        platformRole: "SUPER_ADMIN",
      },
    });
    const activation = await tx.platformAccountActivation.create({
      data: {
        userId: activationUser.id,
        tokenHash: hashPlatformActivationToken(activationToken),
        mfaSecretEncrypted,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    await tx.platformAuditEvent.create({
      data: {
        actorUserId: activationUser.id,
        action: "PLATFORM_ACCOUNT_ACTIVATION_CREATED",
        targetType: "activation",
        targetId: activation.id,
        metadata: { source: "isolated-e2e-fixture" },
      },
    });
    await createOperationalIdentity(tx, tier.id, organizationA, "admin", emails.admin, "Администратор M2", "ADMIN", passwordHash);
    await createOperationalIdentity(tx, tier.id, organizationA, "manager", emails.manager, "Руководитель M2", "MANAGER", passwordHash);
    await createOperationalIdentity(tx, tier.id, organizationA, "agent", emails.agent, "Агент M2", "AGENT", passwordHash);
    await createOperationalIdentity(tx, tier.id, organizationB, "second", emails.second, "Сотрудник другой организации", "ADMIN", passwordHash);
    // This fixture explicitly supports a remote, isolated UAT target (see the production
    // fingerprint exclusion above). Prisma's 5s default interactive-transaction timeout is
    // a local-latency assumption: provisioning two organizations and six identities over a
    // remote Postgres exceeds it and aborts mid-way. The work is unchanged; only the
    // allowance for round-trip latency is.
  }, { timeout: 120_000, maxWait: 30_000 });
  process.stdout.write(`${JSON.stringify({ status: "READY", organizations: 2, users: 6, emails })}\n`);
}

async function createOperationalIdentity(
  tx: Prisma.TransactionClient,
  tierId: number,
  organizationId: string,
  suffix: string,
  email: string,
  name: string,
  role: MembershipRole,
  passwordHash: string,
) {
  const user = await tx.user.create({ data: { email, name, passwordHash } });
  const agent = await tx.agent.create({
    data: { userId: user.id, tierId, status: "ACTIVE", selfEmployed: false, onboardingCompleted: true, notifyEnabled: false },
  });
  await tx.membership.create({
    data: {
      id: `m2-uat-membership:${runId}:${suffix}`,
      organizationId,
      userId: user.id,
      agentId: agent.id,
      role,
      status: "ACTIVE",
    },
  });
}

async function cleanup() {
  const loopbackAddresses = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
  const rateLimitKeys = loopbackAddresses.flatMap((ip) => [
    persistentRateLimitKey("platform-activation-verify", ip),
    persistentRateLimitKey("platform-activation-consume", ip),
    persistentRateLimitKey("platform-owner-recovery-verify", ip),
    persistentRateLimitKey("platform-owner-recovery-consume", ip),
  ]);
  const organizations = await db.organization.findMany({
    where: { id: { in: [organizationA, organizationB] } },
    select: { id: true, memberships: { select: { id: true, userId: true, agentId: true } } },
  });
  const memberships = organizations.flatMap((organization) => organization.memberships);
  const userIds = memberships.map((membership) => membership.userId);
  const agentIds = memberships.flatMap((membership) => membership.agentId == null ? [] : [membership.agentId]);
  const platformUsers = await db.user.findMany({
    where: { email: { in: [emails.platform, emails.activation] } },
    select: { id: true },
  });
  const platformUserIds = platformUsers.map((user) => user.id);
  const organizationIds = organizations.map((organization) => organization.id);
  if (organizationIds.length) {
    await db.operationalAuditEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await db.organizationInvite.deleteMany({ where: { organizationId: { in: organizationIds } } });
  }
  if (platformUserIds.length) await db.platformAuditEvent.deleteMany({ where: { actorUserId: { in: platformUserIds } } });
  if (memberships.length) await db.membership.deleteMany({ where: { id: { in: memberships.map((membership) => membership.id) } } });
  if (agentIds.length) await db.agent.deleteMany({ where: { id: { in: agentIds } } });
  if (userIds.length || platformUserIds.length) await db.user.deleteMany({ where: { id: { in: [...userIds, ...platformUserIds] } } });
  if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await db.securityRateLimitBucket.deleteMany({ where: { keyHash: { in: rateLimitKeys } } });
  await db.agentTier.deleteMany({ where: { name: "M2 Synthetic UAT", agents: { none: {} } } });
  process.stdout.write(`${JSON.stringify({ status: "CLEAN" })}\n`);
}

async function status() {
  const [organizations, users, memberships, audit] = await Promise.all([
    db.organization.count({ where: { id: { in: [organizationA, organizationB] } } }),
    db.user.count({ where: { email: { in: Object.values(emails) } } }),
    db.membership.count({ where: { organizationId: { in: [organizationA, organizationB] } } }),
    db.platformAuditEvent.count({ where: { actor: { email: emails.platform } } }),
  ]);
  return { status: organizations === 2 && users === 6 ? "READY" : "ABSENT", organizations, users, memberships, audit };
}

function isLocalTarget(value: string | undefined) {
  if (!value) return false;
  const url = new URL(value);
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "M2 fixture failed"}\n`);
  process.exitCode = 1;
});
