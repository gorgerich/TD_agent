import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { appendPlatformAudit } from "@/lib/platformAudit";
import {
  decryptPlatformMfaSecret,
  platformMfaUri,
  verifyPlatformMfaCode,
} from "@/lib/platformMfa";

export const PLATFORM_ACTIVATION_TTL_MS = 30 * 60 * 1000;
export const PLATFORM_ACTIVATION_INVALID_MESSAGE =
  "Ссылка недействительна, истекла или уже была использована.";

const OBVIOUS_PASSWORDS = new Set([
  "123456789012",
  "adminadminadmin",
  "administrator",
  "password1234",
  "qwertyqwerty",
  "tihiydom2026",
  "тихийдом2026",
]);

export class PlatformActivationError extends Error {
  constructor(
    message = PLATFORM_ACTIVATION_INVALID_MESSAGE,
    public readonly status: 400 | 422 = 400,
  ) {
    super(message);
    this.name = "PlatformActivationError";
  }
}

export function generatePlatformActivationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashPlatformActivationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isPlatformActivationTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function validatePlatformAdminPassword(password: string, confirmation: string): void {
  if (password !== confirmation) {
    throw new PlatformActivationError("Пароли не совпадают.", 422);
  }
  if (password.length < 12 || password.length > 128) {
    throw new PlatformActivationError("Пароль должен содержать от 12 до 128 символов.", 422);
  }
  const normalized = password.toLocaleLowerCase("ru-RU").replace(/\s+/g, "");
  if (
    OBVIOUS_PASSWORDS.has(normalized)
    || /^(.)\1{11,}$/u.test(password)
    || /^(123456|qwerty|password|пароль)/iu.test(normalized)
  ) {
    throw new PlatformActivationError("Выберите менее очевидный пароль.", 422);
  }
}

export async function verifyPlatformActivation(
  client: Prisma.TransactionClient,
  token: string,
  now = new Date(),
): Promise<{ secret: string; uri: string } | null> {
  if (!isPlatformActivationTokenShape(token)) return null;
  const activation = await client.platformAccountActivation.findUnique({
    where: { tokenHash: hashPlatformActivationToken(token) },
    select: {
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
    && activation.purpose === "FIRST_ACCESS"
    && activation.expiresAt > now
    && activation.consumedAt == null
    && activation.revokedAt == null
    && activation.user.platformRole === "SUPER_ADMIN"
    && activation.user.passwordHash == null,
  );
  if (!valid || !activation) return null;
  const secret = decryptPlatformMfaSecret(activation.mfaSecretEncrypted);
  if (!secret) throw new Error("Platform activation MFA secret is unavailable");
  return { secret, uri: platformMfaUri(secret) };
}

export async function consumePlatformActivation(
  tx: Prisma.TransactionClient,
  input: {
    token: string;
    passwordHash: string;
    mfaCode: string;
    now?: Date;
  },
): Promise<{ userId: number }> {
  const now = input.now ?? new Date();
  if (!isPlatformActivationTokenShape(input.token)) throw new PlatformActivationError();
  const tokenHash = hashPlatformActivationToken(input.token);
  const activation = await tx.platformAccountActivation.findUnique({
    where: { tokenHash },
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
    || activation.purpose !== "FIRST_ACCESS"
    || activation.expiresAt <= now
    || activation.consumedAt != null
    || activation.revokedAt != null
    || activation.user.platformRole !== "SUPER_ADMIN"
    || activation.user.passwordHash != null
  ) {
    throw new PlatformActivationError();
  }
  const mfaSecret = decryptPlatformMfaSecret(activation.mfaSecretEncrypted);
  if (!mfaSecret || !verifyPlatformMfaCode(mfaSecret, input.mfaCode, now.getTime())) {
    throw new PlatformActivationError("Проверьте код из приложения-аутентификатора.", 422);
  }

  const consumed = await tx.platformAccountActivation.updateMany({
    where: {
      id: activation.id,
      purpose: "FIRST_ACCESS",
      consumedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) throw new PlatformActivationError();

  const credential = await tx.user.updateMany({
    where: {
      id: activation.userId,
      platformRole: "SUPER_ADMIN",
      passwordHash: null,
    },
    data: {
      passwordHash: input.passwordHash,
      platformMfaSecretEncrypted: activation.mfaSecretEncrypted,
      platformMfaEnabledAt: now,
      sessionVersion: { increment: 1 },
    },
  });
  if (credential.count !== 1) throw new PlatformActivationError();

  await appendPlatformAudit(tx, {
    actorUserId: activation.userId,
    action: "PLATFORM_ACCOUNT_ACTIVATED",
    targetType: "activation",
    targetId: activation.id,
    metadata: { source: "first-access", consumedAt: now.toISOString() },
  });
  return { userId: activation.userId };
}
