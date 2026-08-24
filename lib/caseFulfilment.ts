import { Prisma } from "@prisma/client";
import { CaseDomainError, type CaseTransitionEvent } from "@/lib/caseDomain";
import { transitionCaseInTransaction } from "@/lib/caseService";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";

export type FulfilmentAdvanceResult = {
  stage: string;
  transitioned: CaseTransitionEvent[];
  blockedBy: string | null;
};

export async function advanceCaseFulfilment(
  input: Parameters<typeof advanceCaseFulfilmentInTransaction>[1],
): Promise<FulfilmentAdvanceResult> {
  return runOperationalTransaction(
    (tx) => advanceCaseFulfilmentInTransaction(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

export async function advanceCaseFulfilmentInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    caseId: string;
    actorAgentId: number;
    actorMembershipId: string;
    actorType?: string;
    idempotencyKey: string;
    correlationId: string;
    causationId?: string;
  },
): Promise<FulfilmentAdvanceResult> {
  const record = await tx.case.findFirst({
    where: { id: input.caseId, tenantId: input.organizationId },
    select: { leadId: true, ownerId: true, stage: true },
  });
  if (!record) throw new OperationalCommandError(404, "Кейс не найден");

  let stage: string = record.stage;
  const transitioned: CaseTransitionEvent[] = [];
  let blockedBy: string | null = null;

  if (stage === "CONTRACTING") {
    const outcome = await attemptTransition(tx, {
      leadId: record.leadId,
      eventType: "contract.signed.v1",
      payload: {},
      context: commandContext(input, record.ownerId, "case-contract-signed"),
    });
    if (outcome.transitioned) {
      transitioned.push("contract.signed.v1");
      stage = "PAYMENT";
    } else {
      blockedBy = outcome.blockedBy;
    }
  }

  if (stage === "PAYMENT") {
    const outcome = await attemptTransition(tx, {
      leadId: record.leadId,
      eventType: "payment.requirement_satisfied.v1",
      payload: {},
      context: commandContext(input, record.ownerId, "case-payment-satisfied"),
    });
    if (outcome.transitioned) {
      transitioned.push("payment.requirement_satisfied.v1");
      stage = "EXECUTION";
      blockedBy = null;
    } else {
      blockedBy = outcome.blockedBy;
    }
  }

  return { stage, transitioned, blockedBy };
}

function commandContext(
  input: Parameters<typeof advanceCaseFulfilmentInTransaction>[1],
  ownerId: number,
  suffix: string,
) {
  return {
    organizationId: input.organizationId,
    membershipId: input.actorMembershipId,
    agentId: ownerId,
    actorId: input.actorAgentId,
    actorType: input.actorType,
    idempotencyKey: `${input.idempotencyKey}:${suffix}`,
    correlationId: input.correlationId,
    causationId: input.causationId ?? input.idempotencyKey,
  };
}

async function attemptTransition(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof transitionCaseInTransaction>[1],
) {
  try {
    await transitionCaseInTransaction(tx, input);
    return { transitioned: true as const, blockedBy: null };
  } catch (error) {
    if (error instanceof CaseDomainError && error.code === "GUARD_FAILED") {
      return {
        transitioned: false as const,
        blockedBy: typeof error.details.guard === "string" ? error.details.guard : "guard_failed",
      };
    }
    throw error;
  }
}
