import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { normalizeEmail } from "@/lib/agentAuth";
import { appendPlatformAudit } from "@/lib/platformAudit";
import {
  decryptPlatformMfaSecret,
  encryptPlatformMfaSecret,
  generatePlatformMfaSecret,
  platformMfaUri,
  verifyPlatformMfaCode,
} from "@/lib/platformMfa";

export const PLATFORM_OWNER_RECOVERY_TTL_MS = 15 * 60 * 1000;
export const PLATFORM_OWNER_RECOVERY_ORIGIN = "https://td-agent.vercel.app";
export const PLATFORM_OWNER_RECOVERY_INVALID_MESSAGE =
  "Ссылка недействительна, истекла или уже была использована.";
const PLATFORM_OWNER_RECOVERY_LOCK_NAMESPACE = 1_867_769_221;
export const PLATFORM_OWNER_RECOVERY_MFA_PENDING = "__OWNER_RECOVERY_MFA_PENDING__";

export class PlatformOwnerRecoveryError extends Error {
  constructor(
    message = PLATFORM_OWNER_RECOVERY_INVALID_MESSAGE,
    public readonly status: 400 | 422 = 400,
  ) {
    super(message);
    this.name = "PlatformOwnerRecoveryError";
  }
}

export function generatePlatformOwnerRecoveryToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPlatformOwnerRecoveryToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isPlatformOwnerRecoveryTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function buildPlatformOwnerRecoveryUrl(
  token: string,
  configuredOrigin = PLATFORM_OWNER_RECOVERY_ORIGIN,
): string {
  if (!isPlatformOwnerRecoveryTokenShape(token)) {
    throw new PlatformOwnerRecoveryError("Recovery token shape is invalid");
  }
  const base = new URL(configuredOrigin);
  if (
    base.origin !== PLATFORM_OWNER_RECOVERY_ORIGIN
    || base.username
    || base.password
  ) {
    throw new PlatformOwnerRecoveryError(
      `Platform owner recovery origin must be ${PLATFORM_OWNER_RECOVERY_ORIGIN}`,
    );
  }
  const url = new URL("/setup/platform-owner-recovery", PLATFORM_OWNER_RECOVERY_ORIGIN);
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

export async function issuePlatformOwnerRecovery(
  tx: Prisma.TransactionClient,
  emailInput: string,
  options: { now?: Date; ttlMs?: number } = {},
): Promise<{ activationId: string; userId: number; email: string; token: string; expiresAt: Date }> {
  const email = normalizeEmail(emailInput);
  if (!email || !email.includes("@")) throw new PlatformOwnerRecoveryError("Valid PLATFORM_OWNER_EMAIL is required");
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? PLATFORM_OWNER_RECOVERY_TTL_MS;
  if (ttlMs <= 0 || ttlMs > PLATFORM_OWNER_RECOVERY_TTL_MS) {
    throw new PlatformOwnerRecoveryError("Recovery TTL must be between 1 ms and 15 minutes");
  }

  const user = await tx.user.findUnique({
    where: { email },
    select: { id: true, platformRole: true, passwordHash: true },
  });
  if (!user || user.platformRole !== "SUPER_ADMIN" || !user.passwordHash) {
    throw new PlatformOwnerRecoveryError("Existing password-enabled Platform SUPER_ADMIN is required");
  }

  // Serialize recovery issuance per owner. Concurrent operator invocations
  // cannot leave two unconsumed bearer links valid after commit.
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${PLATFORM_OWNER_RECOVERY_LOCK_NAMESPACE}::integer,
      ${user.id}::integer
    ) IS NULL AS "locked"
  `;
  const lockedUser = await tx.user.findUnique({
    where: { id: user.id },
    select: { id: true, platformRole: true, passwordHash: true },
  });
  if (!lockedUser || lockedUser.platformRole !== "SUPER_ADMIN" || !lockedUser.passwordHash) {
    throw new PlatformOwnerRecoveryError("Existing password-enabled Platform SUPER_ADMIN is required");
  }

  await revokeOpenPlatformOwnerRecoveries(tx, user.id, now);

  const token = generatePlatformOwnerRecoveryToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const activation = await tx.platformAccountActivation.create({
    data: {
      userId: user.id,
      purpose: "OWNER_RECOVERY",
      tokenHash: hashPlatformOwnerRecoveryToken(token),
      // The trusted operator does not receive the runtime encryption key.
      // MFA material is generated and encrypted on first verified use inside
      // the production runtime.
      mfaSecretEncrypted: PLATFORM_OWNER_RECOVERY_MFA_PENDING,
      expiresAt,
    },
    select: { id: true },
  });
  await appendPlatformAudit(tx, {
    actorUserId: user.id,
    action: "PLATFORM_OWNER_RECOVERY_CREATED",
    targetType: "activation",
    targetId: activation.id,
    metadata: { source: "trusted-operator", expiresAt: expiresAt.toISOString() },
  });
  return { activationId: activation.id, userId: user.id, email, token, expiresAt };
}

export async function revokePlatformOwnerRecovery(
  tx: Prisma.TransactionClient,
  activationId: string,
  userId: number,
  now = new Date(),
): Promise<void> {
  const revoked = await tx.platformAccountActivation.updateMany({
    where: {
      id: activationId,
      userId,
      purpose: "OWNER_RECOVERY",
      consumedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
  if (revoked.count !== 1) return;
  await appendPlatformAudit(tx, {
    actorUserId: userId,
    action: "PLATFORM_OWNER_RECOVERY_REVOKED",
    targetType: "activation",
    targetId: activationId,
    metadata: { source: "trusted-operator", revokedAt: now.toISOString() },
  });
}

export async function verifyPlatformOwnerRecovery(
  tx: Prisma.TransactionClient,
  token: string,
  now = new Date(),
): Promise<{ secret: string; uri: string } | null> {
  if (!isPlatformOwnerRecoveryTokenShape(token)) return null;
  const activation = await tx.platformAccountActivation.findUnique({
    where: { tokenHash: hashPlatformOwnerRecoveryToken(token) },
    select: {
      id: true,
      userId: true,
      purpose: true,
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      mfaSecretEncrypted: true,
      user: { select: { platformRole: true, passwordHash: true } },
    },
  });
  const valid = Boolean(
    activation
    && activation.purpose === "OWNER_RECOVERY"
    && activation.expiresAt > now
    && activation.consumedAt == null
    && activation.revokedAt == null
    && activation.user.platformRole === "SUPER_ADMIN"
    && activation.user.passwordHash != null,
  );
  if (!valid || !activation) return null;

  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(
      ${PLATFORM_OWNER_RECOVERY_LOCK_NAMESPACE}::integer,
      ${activation.userId}::integer
    ) IS NULL AS "locked"
  `;
  const lockedActivation = await tx.platformAccountActivation.findUnique({
    where: { id: activation.id },
    select: {
      purpose: true,
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      mfaSecretEncrypted: true,
      user: { select: { platformRole: true, passwordHash: true } },
    },
  });
  const stillValid = Boolean(
    lockedActivation
    && lockedActivation.purpose === "OWNER_RECOVERY"
    && lockedActivation.expiresAt > now
    && lockedActivation.consumedAt == null
    && lockedActivation.revokedAt == null
    && lockedActivation.user.platformRole === "SUPER_ADMIN"
    && lockedActivation.user.passwordHash != null,
  );
  if (!stillValid || !lockedActivation) return null;

  let encryptedSecret = lockedActivation.mfaSecretEncrypted;
  if (encryptedSecret === PLATFORM_OWNER_RECOVERY_MFA_PENDING) {
    const initialized = await tx.platformAccountActivation.updateMany({
      where: {
        id: activation.id,
        purpose: "OWNER_RECOVERY",
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
        mfaSecretEncrypted: PLATFORM_OWNER_RECOVERY_MFA_PENDING,
      },
      data: {
        mfaSecretEncrypted: encryptPlatformMfaSecret(generatePlatformMfaSecret()),
      },
    });
    if (initialized.count !== 1) return null;
    encryptedSecret = (await tx.platformAccountActivation.findUniqueOrThrow({
      where: { id: activation.id },
      select: { mfaSecretEncrypted: true },
    })).mfaSecretEncrypted;
  }

  const secret = decryptPlatformMfaSecret(encryptedSecret);
  if (!secret) throw new Error("Platform owner recovery MFA secret is unavailable");
  return { secret, uri: platformMfaUri(secret) };
}

export async function consumePlatformOwnerRecovery(
  tx: Prisma.TransactionClient,
  input: {
    token: string;
    passwordHash: string;
    mfaCode: string;
    now?: Date;
  },
): Promise<{ userId: number; sessionVersion: number }> {
  const now = input.now ?? new Date();
  if (!isPlatformOwnerRecoveryTokenShape(input.token)) throw new PlatformOwnerRecoveryError();
  const activation = await tx.platformAccountActivation.findUnique({
    where: { tokenHash: hashPlatformOwnerRecoveryToken(input.token) },
    select: {
      id: true,
      userId: true,
      purpose: true,
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      mfaSecretEncrypted: true,
      user: { select: { platformRole: true, passwordHash: true } },
    },
  });
  if (
    !activation
    || activation.purpose !== "OWNER_RECOVERY"
    || activation.expiresAt <= now
    || activation.consumedAt != null
    || activation.revokedAt != null
    || activation.user.platformRole !== "SUPER_ADMIN"
    || activation.user.passwordHash == null
    || activation.mfaSecretEncrypted === PLATFORM_OWNER_RECOVERY_MFA_PENDING
  ) {
    throw new PlatformOwnerRecoveryError();
  }
  const mfaSecret = decryptPlatformMfaSecret(activation.mfaSecretEncrypted);
  if (!mfaSecret || !verifyPlatformMfaCode(mfaSecret, input.mfaCode, now.getTime())) {
    throw new PlatformOwnerRecoveryError("Проверьте код из приложения-аутентификатора.", 422);
  }

  const consumed = await tx.platformAccountActivation.updateMany({
    where: {
      id: activation.id,
      purpose: "OWNER_RECOVERY",
      consumedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw new PlatformOwnerRecoveryError();

  const credentialUpdate = await tx.user.updateMany({
    where: {
      id: activation.userId,
      platformRole: "SUPER_ADMIN",
      passwordHash: { not: null },
    },
    data: {
      passwordHash: input.passwordHash,
      platformMfaSecretEncrypted: activation.mfaSecretEncrypted,
      platformMfaEnabledAt: now,
      sessionVersion: { increment: 1 },
    },
  });
  if (credentialUpdate.count !== 1) throw new PlatformOwnerRecoveryError();
  const credential = await tx.user.findUniqueOrThrow({
    where: { id: activation.userId },
    select: { sessionVersion: true },
  });

  await appendPlatformAudit(tx, {
    actorUserId: activation.userId,
    action: "PLATFORM_OWNER_PASSWORD_RECOVERED",
    targetType: "activation",
    targetId: activation.id,
    metadata: { source: "owner-recovery", recoveredAt: now.toISOString(), sessionsRevoked: true },
  });
  return { userId: activation.userId, sessionVersion: credential.sessionVersion };
}

async function revokeOpenPlatformOwnerRecoveries(
  tx: Prisma.TransactionClient,
  userId: number,
  now: Date,
) {
  const open = await tx.platformAccountActivation.findMany({
    where: {
      userId,
      purpose: "OWNER_RECOVERY",
      consumedAt: null,
      revokedAt: null,
    },
    select: { id: true },
  });
  for (const activation of open) {
    await revokePlatformOwnerRecovery(tx, activation.id, userId, now);
  }
}
