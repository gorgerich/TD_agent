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

type DbClient = PrismaClient | Prisma.TransactionClient;

export type CaseCommandContext = {
  agentId: number;
  actorId: number;
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
  religion: string | null;
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
  agentId: number;
  actorId: number;
  scenarioId?: CaseScenario;
  stage?: CaseStage;
  idempotencyKey?: string;
  correlationId?: string;
}, db: DbClient = prisma): Promise<CaseCommandResult> {
  const existing = await db.case.findUnique({ where: { leadId: input.leadId } });
  if (existing) return caseResult(existing, `existing:${existing.id}`, true);

  const tenantId = tenantIdForAgent(input.agentId);
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
  const tenantId = tenantIdForAgent(input.context.agentId);
  const payload = input.payload ?? {};

  try {
    return await prisma.$transaction(
      (tx) => transitionCaseInTransaction(tx, { ...input, payload }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
  const tenantId = tenantIdForAgent(input.context.agentId);
  const eventType = "case.intake_saved.v1";

  try {
    return await prisma.$transaction(async (tx) => {
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

      const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
      const result = caseResult(aggregate, eventId, false);
      const snapshot = caseSnapshot(aggregate);
      await tx.caseEvent.create({
        data: {
          id: eventId,
          caseId: aggregate.id,
          tenantId,
          actorId: input.context.actorId,
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

async function transitionCaseInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    leadId: number;
    eventType: CaseTransitionEvent;
    payload: CaseTransitionPayload;
    context: CaseCommandContext;
  },
): Promise<CaseCommandResult> {
  const tenantId = tenantIdForAgent(input.context.agentId);
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
    },
  });
}

type LoadedAggregate = NonNullable<Awaited<ReturnType<typeof loadAggregate>>>;

function transitionFacts(aggregate: LoadedAggregate): CaseTransitionFacts {
  const orders = aggregate.lead.meetings.flatMap((meeting) => meeting.orders);
  const availableQuoteVersionIds = aggregate.lead.meetings.flatMap((meeting) =>
    meeting.quotes.flatMap((quote) => quote.versions.map((version) => version.id)),
  );
  const paidKopecks = aggregate.lead.payments.reduce((sum, payment) => sum + payment.amountKopecks, 0);
  const obligation = orders.reduce((max, order) => Math.max(max, order.totalAmount), 0);
  const paidByOrderState = orders.some((order) => ["PAID", "COMPLETED"].includes(order.status.toUpperCase()));

  return {
    intakeComplete: Boolean(aggregate.lead.name.trim()) && Boolean(aggregate.lead.phone.trim()) && Boolean(aggregate.lead.deceasedName),
    availableQuoteVersionIds,
    publishedQuoteVersionId: aggregate.publishedQuoteVersionId,
    contractSigned: orders.some((order) => ["SIGNED", "PAID", "COMPLETED"].includes(order.status.toUpperCase())),
    paymentSatisfied: paidByOrderState || (obligation > 0 && paidKopecks >= obligation),
    guardState: normalizedGuardState(aggregate.guardState),
  };
}

function validateCommandContext(context: CaseCommandContext): void {
  if (!context.agentId || !context.actorId || !context.idempotencyKey.trim() || !context.correlationId.trim()) {
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
