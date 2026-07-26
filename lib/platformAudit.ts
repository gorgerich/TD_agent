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
    action: "PLATFORM_ROLE_BOOTSTRAPPED" | "ORGANIZATION_SUSPENDED" | "ORGANIZATION_REACTIVATED";
    targetType: "user" | "organization";
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
