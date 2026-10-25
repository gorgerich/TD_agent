import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { PlatformContext } from "@/lib/platformAuth";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import { sanitizePlatformAuditMetadata } from "@/lib/platformAudit";
import { isReleaseWriteFreezeActive } from "@/lib/releaseWriteFreeze";
import { decryptPlatformMfaSecret, encryptPlatformMfaSecret, generatePlatformMfaSecret, platformMfaUri, verifyPlatformMfaCode } from "@/lib/platformMfa";
import { STAFF_RECOVERY_CONFIRMATION } from "@/lib/staffRecoveryConfirmation";
import { assertClientCommandKey } from "@/lib/commandNamespace";
export { STAFF_RECOVERY_CONFIRMATION } from "@/lib/staffRecoveryConfirmation";

export const STAFF_RECOVERY_TTL_MS = 15 * 60_000;
export const STAFF_RECOVERY_INVALID_MESSAGE = "Ссылка недействительна, истекла или уже была использована.";
const PRODUCTION_ORIGIN = "https://td-agent.vercel.app";

export function staffRecoveryOrigin(env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL === "1" && env.VERCEL_ENV === "production") return PRODUCTION_ORIGIN;
  if (env.VERCEL === "1" && env.VERCEL_ENV === "preview"
    && ["mission/m3-fulfilment-money-trust", "fix/m3-intake-transaction", "fix/m3-cpo-audit-repair"].includes(env.VERCEL_GIT_COMMIT_REF ?? "")) {
    const host = env.VERCEL_URL ?? "";
    if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(host)
      && `https://${host}` !== PRODUCTION_ORIGIN) return `https://${host}`;
  }
  // This exception is explicit, local-only, and never accepted on Vercel or in
  // its Production environment, even if ALLOW_DB_TESTS was accidentally set.
  if (env.VERCEL !== "1" && env.VERCEL_ENV !== "production" && env.ALLOW_DB_TESTS === "1"
    && env.TEST_DATABASE_URL && env.DATABASE_URL === env.TEST_DATABASE_URL && env.DATABASE_URL_UNPOOLED === env.TEST_DATABASE_URL) {
    try {
      const database = new URL(env.TEST_DATABASE_URL);
      const origin = new URL(env.STAFF_RECOVERY_LOCAL_ORIGIN ?? "");
      if (["postgres:", "postgresql:"].includes(database.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(database.hostname)
        && ["/td_agent_test", "/td_agent_m1_local_20260718", "/td_agent_m2_test", "/td_agent_m3_20260811_a", "/td_agent_m3_20260811_b"].includes(database.pathname)
        && origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
        && !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash) return origin.origin;
    } catch { /* An invalid local configuration must never fall back to Production. */ }
  }
  throw new OperationalCommandError(503, "Адрес восстановления для этого окружения не настроен");
}

export class StaffAccountRecoveryError extends Error {
  constructor() { super(STAFF_RECOVERY_INVALID_MESSAGE); this.name = "StaffAccountRecoveryError"; }
}

export function hashStaffRecoveryToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isStaffRecoveryToken(token: string): boolean { return /^[A-Za-z0-9_-]{43}$/.test(token); }

export function buildStaffRecoveryUrl(token: string, env: Record<string, string | undefined> = process.env): string {
  if (!isStaffRecoveryToken(token)) throw new StaffAccountRecoveryError();
  const url = new URL("/setup/staff-recovery", staffRecoveryOrigin(env));
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

function assertUnfrozen() {
  if (isReleaseWriteFreezeActive()) throw new OperationalCommandError(503, "Изменения временно приостановлены");
}

function assertIssuerInput(context: PlatformContext, reason: string, confirmation: string) {
  if (context.platformRole !== "SUPER_ADMIN" || !context.platformMfaEnabled || !context.mfaVerified) {
    throw new OperationalCommandError(403, "Требуется SUPER_ADMIN с подтверждённой MFA");
  }
  if (confirmation !== STAFF_RECOVERY_CONFIRMATION || reason.trim().length < 3 || reason.trim().length > 240) {
    throw new OperationalCommandError(422, "Укажите причину и подтвердите восстановление доступа");
  }
}

// Match tenant -> user -> membership lock ordering. Every recovery writer locks
// the subject user, so issuance, revocation and consume cannot cross each other.
async function lockTarget(tx: Prisma.TransactionClient, organizationId: string, membershipId: string, issuer?: PlatformContext) {
  assertUnfrozen();
  const candidate = await tx.membership.findFirst({ where: { id: membershipId, organizationId }, select: { userId: true, agentId: true } });
  if (!candidate?.agentId) throw new StaffAccountRecoveryError();
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} OR "id" = ${issuer?.userId ?? candidate.userId} ORDER BY "id" FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "id" = ${membershipId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Agent" WHERE "id" = ${candidate.agentId} FOR UPDATE`;
  if (issuer) {
    const actor = await tx.user.findUnique({ where: { id: issuer.userId }, select: { platformRole: true, platformMfaEnabledAt: true, sessionVersion: true } });
    if (!actor || actor.platformRole !== "SUPER_ADMIN" || !actor.platformMfaEnabledAt || actor.sessionVersion !== issuer.sessionVersion) {
      throw new OperationalCommandError(403, "Полномочия владельца платформы изменились; войдите снова");
    }
  }
  const member = await tx.membership.findFirst({
    where: { id: membershipId, organizationId, userId: candidate.userId, agentId: candidate.agentId,
      status: "ACTIVE", organization: { status: "ACTIVE" }, agent: { status: "ACTIVE", userId: candidate.userId },
      user: { platformRole: "USER", passwordHash: { not: null } } },
    include: { user: { select: { sessionVersion: true } } },
  });
  if (!member) throw new StaffAccountRecoveryError();
  return member;
}

async function audit(tx: Prisma.TransactionClient, actorUserId: number, action: string, id: string, metadata: Record<string, unknown>) {
  await tx.platformAuditEvent.create({ data: {
    actorUserId, action, targetType: "staff-recovery", targetId: id,
    metadata: sanitizePlatformAuditMetadata(metadata),
  } });
}

export async function issueStaffAccountRecovery(tx: Prisma.TransactionClient, issuer: PlatformContext,
  input: { organizationId: string; membershipId: string; reason: string; confirmation: string; idempotencyKey: string },
  options: { now?: Date; ttlMs?: number } = {}) {
  assertIssuerInput(issuer, input.reason, input.confirmation);
  if (!input.idempotencyKey || input.idempotencyKey.length > 200 || input.idempotencyKey !== input.idempotencyKey.trim()) {
    throw new OperationalCommandError(400, "Нужен корректный Idempotency-Key");
  }
  assertClientCommandKey(input.idempotencyKey);
  const origin = staffRecoveryOrigin();
  const ttl = options.ttlMs ?? STAFF_RECOVERY_TTL_MS;
  if (!Number.isInteger(ttl) || ttl <= 0 || ttl > STAFF_RECOVERY_TTL_MS) throw new StaffAccountRecoveryError();
  const member = await lockTarget(tx, input.organizationId, input.membershipId, issuer);
  const commandId = `staff-recovery-issue:${hashStaffRecoveryToken(JSON.stringify([issuer.userId, input.organizationId, input.idempotencyKey]))}`;
  const fingerprint = hashStaffRecoveryToken(JSON.stringify([issuer.userId, input.organizationId, input.membershipId, input.reason.trim(), input.confirmation, ttl, origin]));
  const replay = await tx.platformAuditEvent.findUnique({ where: { id: commandId } });
  if (replay) {
    const metadata = replay.metadata as Record<string, unknown>;
    if (replay.actorUserId !== issuer.userId || replay.action !== "STAFF_RECOVERY_ISSUED" || replay.targetType !== "staff-recovery" || metadata.commandFingerprint !== fingerprint) {
      throw new OperationalCommandError(409, "Ключ повтора уже использован другой командой", "IDEMPOTENCY_CONFLICT");
    }
    const issued = await tx.staffAccountRecovery.findFirst({ where: { id: replay.targetId ?? "", membershipId: member.id, userId: member.userId, organizationId: member.organizationId } });
    if (!issued) throw new StaffAccountRecoveryError();
    return { id: issued.id, url: undefined, expiresAt: issued.expiresAt, resetMfa: issued.resetMfa, replayed: true };
  }
  const now = options.now ?? new Date();
  const prior = await tx.staffAccountRecovery.findMany({ where: { userId: member.userId, consumedAt: null, revokedAt: null }, select: { id: true } });
  await tx.staffAccountRecovery.updateMany({ where: { userId: member.userId, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
  for (const old of prior) await audit(tx, issuer.userId, "STAFF_RECOVERY_REVOKED", old.id, { source: "replacement-issuance", subjectUserId: member.userId });
  const token = randomBytes(32).toString("base64url");
  const recovery = await tx.staffAccountRecovery.create({ data: {
    userId: member.userId, membershipId: member.id, organizationId: member.organizationId, issuedByUserId: issuer.userId,
    issuedSessionVersion: member.user.sessionVersion, issuedRole: member.role, resetMfa: member.role === "FINANCE",
    tokenHash: hashStaffRecoveryToken(token), mfaSecretEncrypted: encryptPlatformMfaSecret(generatePlatformMfaSecret()),
    createdAt: now, expiresAt: new Date(now.getTime() + ttl),
  } });
  await tx.platformAuditEvent.create({ data: { id: commandId, actorUserId: issuer.userId, action: "STAFF_RECOVERY_ISSUED", targetType: "staff-recovery", targetId: recovery.id, metadata: sanitizePlatformAuditMetadata({
    organizationId: member.organizationId, membershipId: member.id, subjectUserId: member.userId,
    reasonFingerprint: hashStaffRecoveryToken(input.reason.trim()), expiresAt: recovery.expiresAt.toISOString(), resetMfa: recovery.resetMfa,
    commandFingerprint: fingerprint,
  }) } });
  const url = new URL("/setup/staff-recovery", origin);
  url.hash = new URLSearchParams({ token }).toString();
  return { id: recovery.id, url: url.toString(), expiresAt: recovery.expiresAt, resetMfa: recovery.resetMfa, replayed: false };
}

export async function revokeStaffAccountRecovery(tx: Prisma.TransactionClient, issuer: PlatformContext,
  input: { organizationId: string; membershipId: string; recoveryId: string; reason: string; confirmation: string }) {
  assertIssuerInput(issuer, input.reason, input.confirmation);
  const member = await lockTarget(tx, input.organizationId, input.membershipId, issuer);
  const revoked = await tx.staffAccountRecovery.updateMany({
    where: { id: input.recoveryId, userId: member.userId, membershipId: member.id, organizationId: member.organizationId, consumedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count !== 1) throw new StaffAccountRecoveryError();
  await audit(tx, issuer.userId, "STAFF_RECOVERY_REVOKED", input.recoveryId, {
    organizationId: member.organizationId, membershipId: member.id, reasonFingerprint: hashStaffRecoveryToken(input.reason.trim()),
  });
}

async function eligibleRecovery(tx: Prisma.TransactionClient, token: string, at?: Date) {
  assertUnfrozen();
  if (!isStaffRecoveryToken(token)) throw new StaffAccountRecoveryError();
  const candidate = await tx.staffAccountRecovery.findUnique({ where: { tokenHash: hashStaffRecoveryToken(token) } });
  if (!candidate) throw new StaffAccountRecoveryError();
  const member = await lockTarget(tx, candidate.organizationId, candidate.membershipId);
  const recovery = await tx.staffAccountRecovery.findUnique({ where: { id: candidate.id } });
  const now = at ?? new Date();
  if (!recovery || recovery.userId !== member.userId || recovery.organizationId !== member.organizationId
    || recovery.issuedRole !== member.role || recovery.issuedSessionVersion !== member.user.sessionVersion
    || recovery.expiresAt <= now || recovery.consumedAt || recovery.revokedAt) throw new StaffAccountRecoveryError();
  return { recovery, member, now };
}

export async function verifyStaffAccountRecovery(tx: Prisma.TransactionClient, token: string, at?: Date) {
  const { recovery, now } = await eligibleRecovery(tx, token, at);
  const secret = decryptPlatformMfaSecret(recovery.mfaSecretEncrypted);
  const uri = new URL(platformMfaUri(secret));
  uri.pathname = `/${encodeURIComponent("Тихий дом:Сотрудник")}`;
  await audit(tx, recovery.userId, "STAFF_RECOVERY_VERIFIED", recovery.id, { source: "recovery-bearer", verifiedAt: now.toISOString() });
  return { secret, uri: uri.toString(), resetMfa: recovery.resetMfa };
}

export async function consumeStaffAccountRecovery(tx: Prisma.TransactionClient,
  input: { token: string; passwordHash: string; mfaCode: string; now?: Date }) {
  const { recovery, member, now } = await eligibleRecovery(tx, input.token, input.now);
  const secret = decryptPlatformMfaSecret(recovery.mfaSecretEncrypted);
  if (!verifyPlatformMfaCode(secret, input.mfaCode, now.getTime())) throw new StaffAccountRecoveryError();
  const consumed = await tx.staffAccountRecovery.updateMany({ where: {
    id: recovery.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now },
  }, data: { consumedAt: now } });
  if (consumed.count !== 1) throw new StaffAccountRecoveryError();
  const updated = await tx.user.updateMany({ where: {
    id: recovery.userId, platformRole: "USER", sessionVersion: recovery.issuedSessionVersion, passwordHash: { not: null },
  }, data: {
    passwordHash: input.passwordHash, sessionVersion: { increment: 1 },
    ...(recovery.resetMfa ? { platformMfaSecretEncrypted: recovery.mfaSecretEncrypted, platformMfaEnabledAt: now } : {}),
  } });
  if (updated.count !== 1) throw new StaffAccountRecoveryError();
  await audit(tx, recovery.userId, "STAFF_ACCOUNT_RECOVERED", recovery.id, {
    organizationId: recovery.organizationId, membershipId: member.id, source: "recovery-bearer", sessionsRevoked: true, resetMfa: recovery.resetMfa,
  });
  return { userId: recovery.userId, membershipId: member.id, role: member.role, sessionVersion: recovery.issuedSessionVersion + 1,
    mfaVerified: recovery.resetMfa };
}
