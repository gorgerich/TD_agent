import type { Prisma } from "@prisma/client";
import type { OperationalContext } from "@/lib/operationalAuth";

type AuditActor = Pick<OperationalContext, "organizationId" | "membershipId">;

type AuditInput = {
  entityType: "task" | "meeting" | "case" | "membership" | "saved_view";
  entityId: string;
  action: string;
  before: Prisma.InputJsonValue;
  after: Prisma.InputJsonValue;
  reason?: string | null;
  correlationId: string;
  causationId?: string | null;
  idempotencyKey: string;
  result: Prisma.InputJsonValue;
};

export async function appendOperationalAudit(
  tx: Prisma.TransactionClient,
  context: AuditActor,
  input: AuditInput,
) {
  return tx.operationalAuditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorMembershipId: context.membershipId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      before: input.before,
      after: input.after,
      reason: input.reason,
      correlationId: input.correlationId,
      causationId: input.causationId,
      idempotencyKey: input.idempotencyKey,
      result: input.result,
    },
  });
}

export async function findOperationalReplay(
  tx: Prisma.TransactionClient,
  organizationId: string,
  idempotencyKey: string,
) {
  return tx.operationalAuditEvent.findUnique({
    where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
  });
}
