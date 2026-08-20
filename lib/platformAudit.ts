import type { Prisma } from "@prisma/client";

const SECRET_KEY = /password|hash|token|cookie|otp|secret|document|deceased|family/i;

export function sanitizePlatformAuditMetadata(value: unknown): Prisma.InputJsonValue {
  return sanitize(value) as Prisma.InputJsonValue;
}

function sanitize(value: unknown): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value !== "object") return String(value);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, nested]) => [key, sanitize(nested)]),
  );
}

export async function appendPlatformAudit(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId: number;
    action:
      | "PLATFORM_ADMIN_USER_PROVISIONED"
      | "PLATFORM_ROLE_BOOTSTRAPPED"
      | "PLATFORM_ACCOUNT_ACTIVATION_CREATED"
      | "PLATFORM_ACCOUNT_ACTIVATED"
      | "PLATFORM_ACCOUNT_ACTIVATION_REVOKED"
      | "PLATFORM_OWNER_RECOVERY_CREATED"
      | "PLATFORM_OWNER_RECOVERY_REVOKED"
      | "PLATFORM_OWNER_PASSWORD_RECOVERED"
      | "PLATFORM_MFA_ENABLED"
      | "PLATFORM_SESSIONS_REVOKED"
      | "M3_POLICIES_ACTIVATED"
      | "ORGANIZATION_SUSPENDED"
      | "ORGANIZATION_REACTIVATED";
    targetType: "user" | "organization" | "activation" | "session";
    targetId?: string | null;
    metadata: unknown;
  },
) {
  return tx.platformAuditEvent.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: sanitizePlatformAuditMetadata(input.metadata),
    },
  });
}
