import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { appendPlatformAudit } from "@/lib/platformAudit";

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
): Promise<boolean> {
  if (!isPlatformActivationTokenShape(token)) return false;
  const activation = await client.platformAccountActivation.findUnique({
    where: { tokenHash: hashPlatformActivationToken(token) },
    select: {
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      user: { select: { platformRole: true, passwordHash: true } },
    },
  });
  return Boolean(
    activation
    && activation.expiresAt > now
    && activation.consumedAt == null
    && activation.revokedAt == null
    && activation.user.platformRole === "SUPER_ADMIN"
    && activation.user.passwordHash == null,
  );
}

export async function consumePlatformActivation(
  tx: Prisma.TransactionClient,
  input: {
    token: string;
    passwordHash: string;
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
      expiresAt: true,
      consumedAt: true,
      revokedAt: true,
      user: { select: { platformRole: true, passwordHash: true } },
    },
  });
  if (
    !activation
    || activation.expiresAt <= now
    || activation.consumedAt != null
    || activation.revokedAt != null
    || activation.user.platformRole !== "SUPER_ADMIN"
    || activation.user.passwordHash != null
  ) {
    throw new PlatformActivationError();
  }

  const consumed = await tx.platformAccountActivation.updateMany({
    where: {
      id: activation.id,
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
    data: { passwordHash: input.passwordHash },
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
