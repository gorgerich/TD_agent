import type { Prisma } from "@prisma/client";
import { normalizeEmail } from "@/lib/agentAuth";
import { appendPlatformAudit } from "@/lib/platformAudit";
import {
  generatePlatformActivationToken,
  hashPlatformActivationToken,
  PLATFORM_ACTIVATION_TTL_MS,
} from "@/lib/platformActivation";
import {
  encryptPlatformMfaSecret,
  generatePlatformMfaSecret,
} from "@/lib/platformMfa";

export class PlatformBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformBootstrapError";
  }
}

export async function bootstrapPlatformSuperAdmin(
  client: Prisma.TransactionClient,
  emailInput: string,
  options: {
    allowActivationOutput?: boolean;
    now?: Date;
    activationTtlMs?: number;
  } = {},
): Promise<{
  userId: number;
  email: string;
  replayed: boolean;
  activation?: { token: string; expiresAt: Date };
}> {
  const email = normalizeEmail(emailInput);
  if (!email || !email.includes("@")) throw new PlatformBootstrapError("Valid PLATFORM_SUPER_ADMIN_EMAIL is required");
  const now = options.now ?? new Date();
  let user = await client.user.findUnique({
    where: { email },
    select: { id: true, platformRole: true, passwordHash: true },
  });

  if (!user) {
    assertActivationOutputAllowed(options.allowActivationOutput);
    user = await client.user.create({
      data: { email, passwordHash: null, platformRole: "SUPER_ADMIN" },
      select: { id: true, platformRole: true, passwordHash: true },
    });
    await appendPlatformAudit(client, {
      actorUserId: user.id,
      action: "PLATFORM_ADMIN_USER_PROVISIONED",
      targetType: "user",
      targetId: String(user.id),
      metadata: { source: "trusted-bootstrap" },
    });
    await appendPlatformAudit(client, {
      actorUserId: user.id,
      action: "PLATFORM_ROLE_BOOTSTRAPPED",
      targetType: "user",
      targetId: String(user.id),
      metadata: { before: null, after: "SUPER_ADMIN", source: "trusted-bootstrap" },
    });
    const activation = await createActivation(client, user.id, now, options.activationTtlMs);
    return { userId: user.id, email, replayed: false, activation };
  }

  let roleChanged = false;
  if (user.platformRole !== "SUPER_ADMIN") {
    await client.user.update({
      where: { id: user.id },
      data: {
        platformRole: "SUPER_ADMIN",
        sessionVersion: { increment: 1 },
      },
    });
    await appendPlatformAudit(client, {
      actorUserId: user.id,
      action: "PLATFORM_ROLE_BOOTSTRAPPED",
      targetType: "user",
      targetId: String(user.id),
      metadata: { before: user.platformRole, after: "SUPER_ADMIN", source: "trusted-bootstrap" },
    });
    roleChanged = true;
  }

  if (user.passwordHash) {
    await revokeOpenActivations(client, user.id, now);
    return { userId: user.id, email, replayed: !roleChanged };
  }

  assertActivationOutputAllowed(options.allowActivationOutput);
  await revokeOpenActivations(client, user.id, now);
  const activation = await createActivation(client, user.id, now, options.activationTtlMs);
  return { userId: user.id, email, replayed: !roleChanged, activation };
}

function assertActivationOutputAllowed(allowed?: boolean) {
  if (!allowed) {
    throw new PlatformBootstrapError(
      "Account activation is required. Set CONFIRM_PLATFORM_ADMIN_ACTIVATION_OUTPUT=YES outside CI.",
    );
  }
}

async function createActivation(
  client: Prisma.TransactionClient,
  userId: number,
  now: Date,
  ttlMs = PLATFORM_ACTIVATION_TTL_MS,
) {
  const token = generatePlatformActivationToken();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const activation = await client.platformAccountActivation.create({
    data: {
      userId,
      tokenHash: hashPlatformActivationToken(token),
      mfaSecretEncrypted: encryptPlatformMfaSecret(generatePlatformMfaSecret()),
      expiresAt,
    },
    select: { id: true },
  });
  await appendPlatformAudit(client, {
    actorUserId: userId,
    action: "PLATFORM_ACCOUNT_ACTIVATION_CREATED",
    targetType: "activation",
    targetId: activation.id,
    metadata: { source: "trusted-bootstrap", expiresAt: expiresAt.toISOString() },
  });
  return { token, expiresAt };
}

async function revokeOpenActivations(
  client: Prisma.TransactionClient,
  userId: number,
  now: Date,
) {
  const open = await client.platformAccountActivation.findMany({
    where: {
      userId,
      consumedAt: null,
      revokedAt: null,
    },
    select: { id: true },
  });
  for (const activation of open) {
    const revoked = await client.platformAccountActivation.updateMany({
      where: { id: activation.id, consumedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    if (revoked.count !== 1) continue;
    await appendPlatformAudit(client, {
      actorUserId: userId,
      action: "PLATFORM_ACCOUNT_ACTIVATION_REVOKED",
      targetType: "activation",
      targetId: activation.id,
      metadata: { source: "trusted-bootstrap", revokedAt: now.toISOString() },
    });
  }
}
