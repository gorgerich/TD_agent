import type { Prisma } from "@prisma/client";
import type { OperationalContext } from "@/lib/operationalAuth";

type AuditActor = Pick<OperationalContext, "organizationId"> & { membershipId?: string | null };

type AuditInput = {
  entityType:
    | "task"
    | "meeting"
    | "case"
    | "membership"
    | "saved_view"
    | "catalog_item"
    | "quote"
    | "quote_version"
    | "quote_client_decision"
    | "case_party"
    | "document_requirement"
    | "document_version"
    | "document_access"
    | "contract_version"
    | "payment_obligation"
    | "payment_ledger_entry"
    | "payment_ledger_approval";
  entityId: string;
  action: string;
  before: Prisma.InputJsonValue;
  after: Prisma.InputJsonValue;
  reason?: string | null;
  correlationId: string;
  causationId?: string | null;
  idempotencyKey: string;
  result: Prisma.InputJsonValue;
  actorType?: string;
};

export async function appendOperationalAudit(
  tx: Prisma.TransactionClient,
  context: AuditActor,
  input: AuditInput,
) {
  return tx.operationalAuditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorMembershipId: context.membershipId ?? null,
      actorType: input.actorType ?? "member",
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
