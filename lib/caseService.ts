import { randomUUID } from "node:crypto";
import { CaseScenario, CaseStage, Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CaseDomainError,
  evaluateCaseTransition,
  type CaseGuardState,
  type CaseTransitionEvent,
  type CaseTransitionFacts,
  type CaseTransitionPayload,
} from "@/lib/caseDomain";
import { projectCaseEventInTransaction } from "@/lib/operationsProjection";
import {
  lockDocumentRequirementPolicyScenario,
  materializeCaseRequirementsInTransaction,
  refreshCaseRequirementApplicabilityInTransaction,
} from "@/lib/documentRequirementService";
import { deriveCaseDocumentTruth, deriveLedgerSummary } from "@/lib/m3Domain";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CaseCommandContext = {
  organizationId: string;
  membershipId: string;
  agentId: number;
  actorId: number;
  actorType?: string;
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;
};

export type CaseCommandResult = {
  caseId: string;
  publicRef: string;
  leadId: number;
  stage: CaseStage;
  scenarioId: CaseScenario;
  version: number;
  eventId: string;
  replayed: boolean;
};

export type CaseIntakeUpdate = {
  ceremonyType: string | null;
  budget: string | null;
  needs: string | null;
  deceasedName: string | null;
  deceasedDate: Date | null;
  morgue: string | null;
  ceremonyAt: Date | null;
  ceremonyPlace: string | null;
};

export function tenantIdForAgent(agentId: number): string {
  return `agent:${agentId}`;
}

export function scenarioFromCeremonyType(value?: string | null): CaseScenario {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("крем")) return CaseScenario.CREMATION_V1;
  if (normalized.includes("погреб")) return CaseScenario.FAMILY_PLOT_BURIAL_V1;
  return CaseScenario.UNSELECTED;
}

export async function ensureCanonicalCaseForLead(input: {
  leadId: number;
  organizationId: string;
  agentId: number;
  actorId: number;
  scenarioId?: CaseScenario;
  stage?: CaseStage;
  idempotencyKey?: string;
  correlationId?: string;
}, db: DbClient = prisma): Promise<CaseCommandResult> {
  const existing = await db.case.findUnique({ where: { leadId: input.leadId } });
  if (existing) return caseResult(existing, `existing:${existing.id}`, true);

  const tenantId = input.organizationId;
  const caseId = `case_${randomUUID().replaceAll("-", "")}`;
  const publicRef = `TD-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
  const stage = input.stage ?? CaseStage.INTAKE;
  const scenarioId = input.scenarioId ?? CaseScenario.UNSELECTED;
  const idempotencyKey = input.idempotencyKey ?? `case.created:${input.leadId}`;
  const correlationId = input.correlationId ?? `lead:${input.leadId}`;
  const snapshot = { stage, scenarioId, version: 1 };
  const result: CaseCommandResult = {
    caseId,
    publicRef,
    leadId: input.leadId,
    stage,
    scenarioId,
    version: 1,
    eventId,
    replayed: false,
  };

  try {
    const created = await db.case.create({
      data: {
        id: caseId,
        publicRef,
        leadId: input.leadId,
        tenantId,
        ownerId: input.agentId,
        scenarioId,
        stage,
        events: {
          create: {
            id: eventId,
            tenantId,
            actorId: input.actorId,
            eventType: "case.created.v1",
            idempotencyKey,
            correlationId,
            fromStage: stage,
            toStage: stage,
            before: {},
            after: snapshot,
            payload: { leadId: input.leadId },
            result: jsonValue(result),
          },
        },
      },
    });
    return caseResult(created, eventId, false);
  } catch (error) {
    if (isUniqueConstraint(error)) {
      const replay = await db.case.findUnique({ where: { leadId: input.leadId } });
      if (replay) return caseResult(replay, `existing:${replay.id}`, true);
    }
    throw error;
  }
}

export async function transitionCase(input: {
  leadId: number;
  eventType: CaseTransitionEvent;
  payload?: CaseTransitionPayload;
  context: CaseCommandContext;
}): Promise<CaseCommandResult> {
  validateCommandContext(input.context);
  const tenantId = input.context.organizationId;
  const payload = input.payload ?? {};

  try {
    return await runCaseTransaction((tx) => transitionCaseInTransaction(tx, { ...input, payload }));
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return replayAfterUniqueRace({
        leadId: input.leadId,
        agentId: input.context.agentId,
        tenantId,
        idempotencyKey: input.context.idempotencyKey,
        eventType: input.eventType,
      });
    }
    throw error;
  }
}

export async function saveCaseIntake(input: {
  leadId: number;
  data: CaseIntakeUpdate;
  context: CaseCommandContext;
}): Promise<CaseCommandResult> {
  validateCommandContext(input.context);
  const tenantId = input.context.organizationId;
  const eventType = "case.intake_saved.v1";

  try {
    return await runCaseTransaction(async (tx) => {
      const lockedCaseId = await lockCaseForCommand(tx, input.leadId, tenantId, input.context.agentId);
      if (!lockedCaseId) throw new CaseDomainError("NOT_FOUND", "Кейс не найден");
      const requestedScenario = scenarioFromCeremonyType(input.data.ceremonyType);
      if (requestedScenario === "CREMATION_V1" || requestedScenario === "FAMILY_PLOT_BURIAL_V1") {
        await lockDocumentRequirementPolicyScenario(tx, requestedScenario);
      }
      let aggregate = await loadAggregate(tx, input.leadId, tenantId, input.context.agentId);
      if (!aggregate) throw new CaseDomainError("NOT_FOUND", "Кейс не найден");

      const replay = await findCommandReplay(tx, aggregate.id, tenantId, input.context.idempotencyKey, eventType);
      if (replay) return replayResult(replay.result);

      const updatedLead = await tx.clientLead.update({ where: { id: input.leadId }, data: input.data });
      if (aggregate.stage === CaseStage.INTAKE && updatedLead.deceasedName) {
        await transitionCaseInTransaction(tx, {
          leadId: input.leadId,
          eventType: "intake.completed.v1",
          payload: {},
          context: derivedContext(input.context, "intake-completed"),
        });
        aggregate = await loadAggregate(tx, input.leadId, tenantId, input.context.agentId);
        if (!aggregate) throw new CaseDomainError("NOT_FOUND", "Кейс не найден после интейка");
      }

      const scenarioId = scenarioFromCeremonyType(updatedLead.ceremonyType);
      if (aggregate.stage === CaseStage.PLANNING && scenarioId !== CaseScenario.UNSELECTED) {
        await transitionCaseInTransaction(tx, {
          leadId: input.leadId,
          eventType: "scenario.selected.v1",
          payload: { scenarioId },
          context: derivedContext(input.context, "scenario-selected"),
        });
        aggregate = await loadAggregate(tx, input.leadId, tenantId, input.context.agentId);
        if (!aggregate) throw new CaseDomainError("NOT_FOUND", "Кейс не найден после выбора сценария");
      }

      await refreshCaseRequirementApplicabilityInTransaction(
        tx,
        { organizationId: tenantId, membershipId: input.context.membershipId },
        aggregate.id,
        { idempotencyKey: input.context.idempotencyKey, correlationId: input.context.correlationId },
      );

      const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
      const result = caseResult(aggregate, eventId, false);
      const snapshot = caseSnapshot(aggregate);
      await tx.caseEvent.create({
        data: {
          id: eventId,
          caseId: aggregate.id,
          tenantId,
          actorId: input.context.actorId,
          actorType: input.context.actorType ?? "agent",
          eventType,
          idempotencyKey: input.context.idempotencyKey,
          correlationId: input.context.correlationId,
          causationId: input.context.causationId,
          fromStage: aggregate.stage,
          toStage: aggregate.stage,
          before: jsonValue(snapshot),
          after: jsonValue(snapshot),
          payload: { changedFields: Object.keys(input.data) },
          result: jsonValue(result),
        },
      });
      return result;
    });
  } catch (error) {
    if (isUniqueConstraint(error)) {
      return replayAfterUniqueRace({
        leadId: input.leadId,
        agentId: input.context.agentId,
        tenantId,
        idempotencyKey: input.context.idempotencyKey,
        eventType,
      });
    }
    throw error;
  }
}

export async function transitionCaseInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    leadId: number;
    eventType: CaseTransitionEvent;
    payload: CaseTransitionPayload;
    context: CaseCommandContext;
  },
): Promise<CaseCommandResult> {
  const tenantId = input.context.organizationId;
  const lockedCaseId = await lockCaseForCommand(tx, input.leadId, tenantId, input.context.agentId);
  if (!lockedCaseId) throw new CaseDomainError("NOT_FOUND", "Кейс не найден");
  if (
    input.eventType === "scenario.selected.v1"
    && (input.payload.scenarioId === "CREMATION_V1" || input.payload.scenarioId === "FAMILY_PLOT_BURIAL_V1")
  ) {
    await lockDocumentRequirementPolicyScenario(tx, input.payload.scenarioId);
  }
  const aggregate = await loadAggregate(tx, input.leadId, tenantId, input.context.agentId);
  if (!aggregate) throw new CaseDomainError("NOT_FOUND", "Кейс не найден");

  const replay = await findCommandReplay(tx, aggregate.id, tenantId, input.context.idempotencyKey, input.eventType);
  if (replay) return replayResult(replay.result);

  const evaluated = evaluateCaseTransition({
    stage: aggregate.stage,
    scenarioId: aggregate.scenarioId,
    eventType: input.eventType,
    payload: input.payload,
    facts: transitionFacts(aggregate),
  });
  const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
  const nextScenario = evaluated.scenarioId ?? aggregate.scenarioId;
  const nextPublishedQuoteVersionId = evaluated.publishedQuoteVersionId ?? aggregate.publishedQuoteVersionId;
  const guardState = normalizedGuardState(aggregate.guardState);
  if (input.eventType === "contract.signed.v1") guardState.contract_signed = true;
  if (input.eventType === "payment.requirement_satisfied.v1") guardState.payment_satisfied = true;
  if (input.eventType === "execution.confirmed.v1") {
    if (aggregate.scenarioId === "CREMATION_V1") guardState.crematorium_confirmed = true;
    if (aggregate.scenarioId === "FAMILY_PLOT_BURIAL_V1") guardState.cemetery_confirmed = true;
  }
  const before = caseSnapshot(aggregate);
  const after = {
    stage: evaluated.toStage,
    scenarioId: nextScenario,
    version: aggregate.version + 1,
    publishedQuoteVersionId: nextPublishedQuoteVersionId,
    guardState,
  };

  const updated = await tx.case.update({
    where: { id: aggregate.id },
    data: {
      stage: evaluated.toStage as CaseStage,
      scenarioId: nextScenario as CaseScenario,
      publishedQuoteVersionId: nextPublishedQuoteVersionId,
      guardState,
      version: { increment: 1 },
      closedAt: evaluated.toStage === "CLOSED" ? new Date() : aggregate.closedAt,
    },
  });
  const result = caseResult(updated, eventId, false);
  await tx.caseEvent.create({
    data: {
      id: eventId,
      caseId: aggregate.id,
      tenantId,
      actorId: input.context.actorId,
      actorType: input.context.actorType ?? "agent",
      eventType: input.eventType,
      idempotencyKey: input.context.idempotencyKey,
      correlationId: input.context.correlationId,
      causationId: input.context.causationId,
      fromStage: aggregate.stage,
      toStage: evaluated.toStage as CaseStage,
      before: jsonValue(before),
      after: jsonValue(after),
      payload: jsonValue(input.payload),
      result: jsonValue(result),
    },
  });
  if (input.eventType === "scenario.selected.v1") {
    await materializeCaseRequirementsInTransaction(
      tx,
      { organizationId: tenantId, membershipId: input.context.membershipId },
      aggregate.id,
      nextScenario,
      {
        idempotencyKey: input.context.idempotencyKey,
        correlationId: input.context.correlationId,
      },
    );
  }
  await projectCaseEventInTransaction(tx, input.context, {
    eventId,
    eventType: input.eventType,
    caseId: aggregate.id,
    leadId: input.leadId,
  });
  return result;
}

async function findCommandReplay(
  tx: Prisma.TransactionClient,
  caseId: string,
  tenantId: string,
  idempotencyKey: string,
  eventType: string,
) {
  const replay = await tx.caseEvent.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
  });
  if (replay && (replay.caseId !== caseId || replay.eventType !== eventType)) {
    throw new CaseDomainError("IDEMPOTENCY_CONFLICT", "Idempotency key уже использован другой командой");
  }
  return replay;
}

async function replayAfterUniqueRace(input: {
  leadId: number;
  agentId: number;
  tenantId: string;
  idempotencyKey: string;
  eventType: string;
}): Promise<CaseCommandResult> {
  const [aggregate, replay] = await Promise.all([
    prisma.case.findFirst({ where: { leadId: input.leadId, tenantId: input.tenantId, ownerId: input.agentId }, select: { id: true } }),
    prisma.caseEvent.findUnique({ where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } } }),
  ]);
  if (aggregate && replay && replay.caseId === aggregate.id && replay.eventType === input.eventType) {
    return replayResult(replay.result);
  }
  throw new CaseDomainError("IDEMPOTENCY_CONFLICT", "Idempotency key уже использован другой командой");
}

function derivedContext(context: CaseCommandContext, suffix: string): CaseCommandContext {
  return { ...context, idempotencyKey: `${context.idempotencyKey}:${suffix}`, causationId: context.idempotencyKey };
}

async function runCaseTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt === maxAttempts) {
        throw new CaseDomainError("IDEMPOTENCY_CONFLICT", "Конфликт параллельных изменений. Обновите кейс и повторите действие");
      }
      await delay(10 * 2 ** (attempt - 1));
    }
  }
  throw new CaseDomainError("IDEMPOTENCY_CONFLICT", "Не удалось завершить команду кейса");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadAggregate(tx: Prisma.TransactionClient, leadId: number, tenantId: string, ownerId: number) {
  return tx.case.findFirst({
    where: { leadId, tenantId, ownerId },
    include: {
      lead: {
        select: {
          name: true,
          phone: true,
          deceasedName: true,
          meetings: {
            select: {
              quotes: { select: { versions: { select: { id: true } } } },
              orders: { select: { status: true, totalAmount: true } },
            },
          },
          payments: { select: { amountKopecks: true } },
        },
      },
      documentRequirements: {
        select: {
          stableKey: true,
          blockingStage: true,
          isApplicable: true,
          satisfactionStatus: true,
          document: {
            select: {
              versions: {
                select: { versionNumber: true, status: true, scanStatus: true, expiresAt: true },
              },
            },
          },
        },
      },
      contract: {
        select: {
          versions: {
            select: {
              id: true,
              status: true,
              validUntil: true,
              quoteVersionId: true,
              supersededBy: { select: { id: true } },
            },
          },
        },
      },
      paymentObligations: {
        select: {
          contractVersionId: true,
          currency: true,
          ledgerEntries: {
            select: {
              id: true,
              type: true,
              direction: true,
              amountKopecks: true,
              relatedEntryId: true,
              approvalRequired: true,
              approval: { select: { decision: true } },
            },
          },
        },
      },
    },
  });
}

async function lockCaseForCommand(
  tx: Prisma.TransactionClient,
  leadId: number,
  tenantId: string,
  ownerId: number,
): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Case"
    WHERE "leadId" = ${leadId}
      AND "tenantId" = ${tenantId}
      AND "ownerId" = ${ownerId}
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0]?.id ?? null;
}

type LoadedAggregate = NonNullable<Awaited<ReturnType<typeof loadAggregate>>>;

function transitionFacts(aggregate: LoadedAggregate): CaseTransitionFacts {
  const availableQuoteVersionIds = aggregate.lead.meetings.flatMap((meeting) =>
    meeting.quotes.flatMap((quote) => quote.versions.map((version) => version.id)),
  );
  const now = new Date();
  const signedContract = aggregate.contract?.versions.find((version) =>
    version.status === "SIGNED"
    && version.supersededBy == null
    && (version.validUntil == null || version.validUntil > now)
    && version.quoteVersionId === aggregate.publishedQuoteVersionId,
  ) ?? null;
  const obligation = signedContract
    ? aggregate.paymentObligations.find((candidate) => candidate.contractVersionId === signedContract.id)
    : null;
  const ledgerSummary = obligation
    ? deriveLedgerSummary(
        obligation.ledgerEntries.map((entry) => ({
          id: entry.id,
          type: entry.type,
          direction: entry.direction,
          amountKopecks: entry.amountKopecks,
          relatedEntryId: entry.relatedEntryId,
          effective: !entry.approvalRequired || entry.approval?.decision === "APPROVED",
        })),
        obligation.currency,
      )
    : null;
  const pendingFinancialAdjustments = obligation?.ledgerEntries.filter((entry) => (
    entry.approvalRequired && entry.approval?.decision == null
  )).length ?? 0;
  const documentTruth = deriveCaseDocumentTruth(aggregate.documentRequirements.filter((requirement) => requirement.isApplicable).map((requirement) => ({
    stableKey: requirement.stableKey,
    blockingStage: requirement.blockingStage,
    versions: requirement.document?.versions ?? [],
  })), now);
  const guardState = normalizedGuardState(aggregate.guardState);
  Object.assign(guardState, documentTruth.guardState);
  guardState.contract_signed = signedContract != null;
  const paymentSatisfied = pendingFinancialAdjustments === 0
    && (ledgerSummary?.status === "PAID" || ledgerSummary?.status === "OVERPAID");
  guardState.payment_satisfied = paymentSatisfied;

  return {
    intakeComplete: Boolean(aggregate.lead.name.trim()) && Boolean(aggregate.lead.phone.trim()) && Boolean(aggregate.lead.deceasedName),
    availableQuoteVersionIds,
    publishedQuoteVersionId: aggregate.publishedQuoteVersionId,
    contractSigned: signedContract != null,
    paymentSatisfied,
    documentsReadyForExecution: documentTruth.readyForExecution,
    guardState,
  };
}

function validateCommandContext(context: CaseCommandContext): void {
  if (!context.organizationId.trim() || !context.membershipId.trim() || !context.agentId || !context.actorId || !context.idempotencyKey.trim() || !context.correlationId.trim()) {
    throw new CaseDomainError("GUARD_FAILED", "Команда требует tenant, actor, idempotency key и correlation ID");
  }
}

function normalizedGuardState(value: Prisma.JsonValue): CaseGuardState {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

function caseSnapshot(value: {
  stage: CaseStage;
  scenarioId: CaseScenario;
  version: number;
  publishedQuoteVersionId: number | null;
  guardState: Prisma.JsonValue;
}) {
  return {
    stage: value.stage,
    scenarioId: value.scenarioId,
    version: value.version,
    publishedQuoteVersionId: value.publishedQuoteVersionId,
    guardState: normalizedGuardState(value.guardState),
  };
}

function caseResult(value: {
  id: string;
  publicRef: string;
  leadId: number;
  stage: CaseStage;
  scenarioId: CaseScenario;
  version: number;
}, eventId: string, replayed: boolean): CaseCommandResult {
  return {
    caseId: value.id,
    publicRef: value.publicRef,
    leadId: value.leadId,
    stage: value.stage,
    scenarioId: value.scenarioId,
    version: value.version,
    eventId,
    replayed,
  };
}

function replayResult(value: Prisma.JsonValue): CaseCommandResult {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new CaseDomainError("IDEMPOTENCY_CONFLICT", "Сохранённый результат команды повреждён");
  }
  const parsed = value as Record<string, unknown>;
  return {
    caseId: String(parsed.caseId),
    publicRef: String(parsed.publicRef),
    leadId: Number(parsed.leadId),
    stage: parsed.stage as CaseStage,
    scenarioId: parsed.scenarioId as CaseScenario,
    version: Number(parsed.version),
    eventId: String(parsed.eventId),
    replayed: true,
  };
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
