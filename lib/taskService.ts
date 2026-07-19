import { Prisma, type TaskPriority, type TaskStatus, type TaskType } from "@prisma/client";
import { appendOperationalAudit, findOperationalReplay } from "@/lib/operationalAudit";
import { assertCapability, type OperationalContext } from "@/lib/operationalAuth";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";
import { prisma } from "@/lib/prisma";

export type TaskCommandMeta = {
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;
};

export type TaskResult = {
  id: number;
  caseId: string;
  leadId: number;
  status: TaskStatus;
  version: number;
  assigneeMembershipId: string | null;
  dueAt: string | null;
  waitingReason: string | null;
  completedAt: string | null;
  replayed: boolean;
};

type CreateTaskInput = {
  leadId: number;
  title: string;
  dueAt?: Date | null;
  type?: TaskType;
  priority?: TaskPriority;
  expectedOutcome?: string | null;
  waitingReason?: string | null;
  assigneeMembershipId?: string | null;
};

export async function createTask(
  context: OperationalContext,
  input: CreateTaskInput,
  meta: TaskCommandMeta,
): Promise<TaskResult> {
  assertCapability(context, "work:mutate-own");
  validateMeta(meta);

  return runTaskCommand(context.organizationId, meta.idempotencyKey, "task.created", undefined, async (tx) => {
    const replay = await commandReplay(tx, context.organizationId, meta.idempotencyKey, "task.created");
    if (replay) return replay;

    const canonicalCase = await tx.case.findFirst({
      where: {
        leadId: input.leadId,
        tenantId: context.organizationId,
        ...(context.role === "AGENT" ? { ownerId: context.agentId } : {}),
      },
      select: { id: true, leadId: true },
    });
    if (!canonicalCase) throw new OperationalCommandError(404, "Кейс не найден");

    const assigneeMembershipId = input.assigneeMembershipId === undefined
      ? context.membershipId
      : input.assigneeMembershipId;
    if (context.role === "AGENT" && assigneeMembershipId !== context.membershipId) {
      throw new OperationalCommandError(403, "Агент может назначить задачу только себе");
    }
    const assignee = assigneeMembershipId
      ? await activeAssignee(tx, context.organizationId, assigneeMembershipId)
      : null;

    const task = await tx.task.create({
      data: {
        leadId: canonicalCase.leadId,
        agentId: assignee?.agentId ?? context.agentId,
        organizationId: context.organizationId,
        caseId: canonicalCase.id,
        assigneeMembershipId,
        createdByMembershipId: context.membershipId,
        title: input.title.trim(),
        dueAt: input.dueAt ?? null,
        type: input.type ?? "MANUAL",
        priority: input.priority ?? "NORMAL",
        expectedOutcome: input.expectedOutcome?.trim() || null,
        waitingReason: input.waitingReason?.trim() || null,
        idempotencyKey: meta.idempotencyKey,
      },
    });
    const result = toTaskResult(task, false);
    await appendOperationalAudit(tx, context, {
      entityType: "task",
      entityId: String(task.id),
      action: "task.created",
      before: {},
      after: taskSnapshot(task),
      correlationId: meta.correlationId,
      causationId: meta.causationId,
      idempotencyKey: meta.idempotencyKey,
      result: json(result),
    });
    return result;
  });
}

export async function completeTask(
  context: OperationalContext,
  taskId: number,
  input: { outcome: string; version: number },
  meta: TaskCommandMeta,
): Promise<TaskResult> {
  assertCapability(context, "work:mutate-own");
  validateMeta(meta);
  if (!input.outcome.trim()) throw new OperationalCommandError(422, "Зафиксируйте результат задачи");

  return changeTask(context, taskId, input.version, meta, "task.completed", async (tx, current) => {
    if (current.status === "COMPLETED") return current;
    if (current.status !== "OPEN") throw new OperationalCommandError(409, "Задача уже закрыта другим действием");
    return tx.task.update({
      where: { id: current.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        outcome: input.outcome.trim(),
        waitingReason: null,
        version: { increment: 1 },
      },
    });
  });
}

export async function cancelTask(
  context: OperationalContext,
  taskId: number,
  input: { reason: string; version: number },
  meta: TaskCommandMeta,
): Promise<TaskResult> {
  assertCapability(context, "work:mutate-own");
  validateMeta(meta);
  if (!input.reason.trim()) throw new OperationalCommandError(422, "Укажите причину отмены");

  return changeTask(context, taskId, input.version, meta, "task.cancelled", async (tx, current) => {
    if (current.status !== "OPEN") throw new OperationalCommandError(409, "Закрытую задачу нельзя отменить");
    return tx.task.update({
      where: { id: current.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        outcome: input.reason.trim(),
        waitingReason: null,
        version: { increment: 1 },
      },
    });
  }, input.reason);
}

export async function assignTask(
  context: OperationalContext,
  taskId: number,
  input: { assigneeMembershipId: string | null; reason: string; version: number },
  meta: TaskCommandMeta,
): Promise<TaskResult> {
  assertCapability(context, "team:assign");
  validateMeta(meta);
  if (!input.reason.trim()) throw new OperationalCommandError(422, "Укажите причину назначения");

  return changeTask(context, taskId, input.version, meta, "task.assigned", async (tx, current) => {
    if (current.status !== "OPEN") throw new OperationalCommandError(409, "Назначить можно только открытую задачу");
    const assignee = input.assigneeMembershipId
      ? await activeAssignee(tx, context.organizationId, input.assigneeMembershipId)
      : null;
    return tx.task.update({
      where: { id: current.id },
      data: {
        assigneeMembershipId: input.assigneeMembershipId,
        agentId: assignee?.agentId ?? current.agentId,
        version: { increment: 1 },
      },
    });
  }, input.reason);
}

export async function rescheduleTask(
  context: OperationalContext,
  taskId: number,
  input: { dueAt: Date | null; reason: string; version: number },
  meta: TaskCommandMeta,
): Promise<TaskResult> {
  assertCapability(context, "work:mutate-own");
  validateMeta(meta);
  if (!input.reason.trim()) throw new OperationalCommandError(422, "Укажите причину переноса");
  return changeTask(context, taskId, input.version, meta, "task.rescheduled", async (tx, current) => {
    if (current.status !== "OPEN") throw new OperationalCommandError(409, "Перенести можно только открытую задачу");
    return tx.task.update({
      where: { id: current.id },
      data: { dueAt: input.dueAt, version: { increment: 1 } },
    });
  }, input.reason);
}

export async function waitTask(
  context: OperationalContext,
  taskId: number,
  input: { waitingReason: string; version: number },
  meta: TaskCommandMeta,
): Promise<TaskResult> {
  assertCapability(context, "work:mutate-own");
  validateMeta(meta);
  if (!input.waitingReason.trim()) throw new OperationalCommandError(422, "Укажите, что блокирует задачу");
  return changeTask(context, taskId, input.version, meta, "task.waiting", async (tx, current) => {
    if (current.status !== "OPEN") throw new OperationalCommandError(409, "Ожидание можно включить только для открытой задачи");
    return tx.task.update({
      where: { id: current.id },
      data: { waitingReason: input.waitingReason.trim(), version: { increment: 1 } },
    });
  }, input.waitingReason);
}

export async function resumeTask(
  context: OperationalContext,
  taskId: number,
  input: { reason: string; version: number },
  meta: TaskCommandMeta,
): Promise<TaskResult> {
  assertCapability(context, "work:mutate-own");
  validateMeta(meta);
  if (!input.reason.trim()) throw new OperationalCommandError(422, "Укажите причину возобновления");
  return changeTask(context, taskId, input.version, meta, "task.resumed", async (tx, current) => {
    if (current.status !== "OPEN") throw new OperationalCommandError(409, "Возобновить можно только открытую задачу");
    if (!current.waitingReason) throw new OperationalCommandError(409, "Задача не находится в ожидании");
    return tx.task.update({
      where: { id: current.id },
      data: { waitingReason: null, version: { increment: 1 } },
    });
  }, input.reason);
}

async function changeTask(
  context: OperationalContext,
  taskId: number,
  expectedVersion: number,
  meta: TaskCommandMeta,
  action: string,
  change: (tx: Prisma.TransactionClient, current: LoadedTask) => Promise<LoadedTask>,
  reason?: string,
): Promise<TaskResult> {
  return runTaskCommand(context.organizationId, meta.idempotencyKey, action, String(taskId), async (tx) => {
    const replay = await commandReplay(tx, context.organizationId, meta.idempotencyKey, action, String(taskId));
    if (replay) return replay;
    const current = await loadTask(tx, context, taskId, action === "task.assigned");
    if (!current) throw new OperationalCommandError(404, "Задача не найдена");
    if (current.type === "MEETING_ESCALATION" && action !== "task.assigned") {
      throw new OperationalCommandError(
        409,
        "Эскалация встречи закрывается только через фиксацию исхода встречи",
        "MEETING_OUTCOME_REQUIRED",
      );
    }
    if (current.version !== expectedVersion) {
      throw new OperationalCommandError(409, "Задача уже изменена. Обновите список и повторите действие.", "VERSION_CONFLICT");
    }
    const updated = await change(tx, current);
    const result = toTaskResult(updated, false);
    await appendOperationalAudit(tx, context, {
      entityType: "task",
      entityId: String(taskId),
      action,
      before: taskSnapshot(current),
      after: taskSnapshot(updated),
      reason,
      correlationId: meta.correlationId,
      causationId: meta.causationId,
      idempotencyKey: meta.idempotencyKey,
      result: json(result),
    });
    return result;
  });
}

async function runTaskCommand(
  organizationId: string,
  idempotencyKey: string,
  action: string,
  entityId: string | undefined,
  command: (tx: Prisma.TransactionClient) => Promise<TaskResult>,
) {
  try {
    return await runOperationalTransaction(command);
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const replay = await prisma.$transaction((tx) => commandReplay(tx, organizationId, idempotencyKey, action, entityId));
    if (replay) return replay;
    throw error;
  }
}

async function loadTask(tx: Prisma.TransactionClient, context: OperationalContext, taskId: number, allowTeamScope = false) {
  return tx.task.findFirst({
    where: {
      id: taskId,
      organizationId: context.organizationId,
      ...(context.role === "ADMIN" || allowTeamScope ? {} : { assigneeMembershipId: context.membershipId }),
    },
  });
}

type LoadedTask = NonNullable<Awaited<ReturnType<typeof loadTask>>>;

async function activeAssignee(tx: Prisma.TransactionClient, organizationId: string, membershipId: string) {
  const membership = await tx.membership.findFirst({
    where: { id: membershipId, organizationId, status: "ACTIVE", agentId: { not: null } },
    select: { id: true, agentId: true },
  });
  if (!membership) throw new OperationalCommandError(422, "Исполнитель не входит в активную команду");
  return membership;
}

async function commandReplay(
  tx: Prisma.TransactionClient,
  organizationId: string,
  idempotencyKey: string,
  expectedAction: string,
  expectedEntityId?: string,
): Promise<TaskResult | null> {
  const replay = await findOperationalReplay(tx, organizationId, idempotencyKey);
  if (!replay) return null;
  if (
    replay.action !== expectedAction
    || replay.entityType !== "task"
    || (expectedEntityId !== undefined && replay.entityId !== expectedEntityId)
  ) {
    throw new OperationalCommandError(409, "Idempotency key уже использован другой командой", "IDEMPOTENCY_CONFLICT");
  }
  const result = replay.result as Record<string, unknown>;
  return {
    id: Number(result.id),
    caseId: String(result.caseId),
    leadId: Number(result.leadId),
    status: result.status as TaskStatus,
    version: Number(result.version),
    assigneeMembershipId: typeof result.assigneeMembershipId === "string" ? result.assigneeMembershipId : null,
    dueAt: typeof result.dueAt === "string" ? result.dueAt : null,
    waitingReason: typeof result.waitingReason === "string" ? result.waitingReason : null,
    completedAt: typeof result.completedAt === "string" ? result.completedAt : null,
    replayed: true,
  };
}

function validateMeta(meta: TaskCommandMeta) {
  if (!meta.idempotencyKey.trim() || !meta.correlationId.trim()) {
    throw new OperationalCommandError(400, "Нужны Idempotency-Key и X-Correlation-Id");
  }
}

function toTaskResult(task: LoadedTask, replayed: boolean): TaskResult {
  return {
    id: task.id,
    caseId: task.caseId,
    leadId: task.leadId,
    status: task.status,
    version: task.version,
    assigneeMembershipId: task.assigneeMembershipId,
    dueAt: task.dueAt?.toISOString() ?? null,
    waitingReason: task.waitingReason,
    completedAt: task.completedAt?.toISOString() ?? null,
    replayed,
  };
}

function taskSnapshot(task: LoadedTask): Prisma.InputJsonValue {
  return {
    status: task.status,
    type: task.type,
    priority: task.priority,
    assigneeMembershipId: task.assigneeMembershipId,
    dueAt: task.dueAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    cancelledAt: task.cancelledAt?.toISOString() ?? null,
    outcome: task.outcome,
    waitingReason: task.waitingReason,
    version: task.version,
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
