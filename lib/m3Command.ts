import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { hasTeamOperationalScope, type OperationalContext } from "@/lib/operationalAuth";
import { OperationalCommandError } from "@/lib/operationalTransaction";

export type M3CommandMeta = {
  idempotencyKey: string;
  correlationId: string;
  reason?: string | null;
};

export function validateM3CommandMeta(meta: M3CommandMeta): void {
  if (!meta.idempotencyKey.trim() || !meta.correlationId.trim()) {
    throw new OperationalCommandError(400, "Нужны Idempotency-Key и X-Correlation-Id");
  }
  if (meta.idempotencyKey.length > 200 || meta.correlationId.length > 200) {
    throw new OperationalCommandError(400, "Идентификатор команды слишком длинный");
  }
}

export function commandFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function prismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function readReplayResult<T>(
  result: Prisma.JsonValue,
  expectedFingerprint: string,
): T | null {
  if (!result || Array.isArray(result) || typeof result !== "object") return null;
  const value = result as Record<string, unknown>;
  if (value.commandFingerprint !== expectedFingerprint) {
    throw new OperationalCommandError(409, "Idempotency key уже использован другой командой");
  }
  return (value.data ?? null) as T | null;
}

export async function requireTenantCase(
  tx: Prisma.TransactionClient,
  context: OperationalContext,
  caseId: string,
  options: { requireOwnerForAgent?: boolean } = {},
) {
  const record = await tx.case.findFirst({
    where: {
      id: caseId,
      tenantId: context.organizationId,
      ...(options.requireOwnerForAgent && !hasTeamOperationalScope(context.role) ? { ownerId: context.agentId } : {}),
    },
    select: {
      id: true,
      leadId: true,
      tenantId: true,
      ownerId: true,
      scenarioId: true,
      stage: true,
      publishedQuoteVersionId: true,
    },
  });
  if (!record) throw new OperationalCommandError(404, "Кейс не найден");
  return record;
}
