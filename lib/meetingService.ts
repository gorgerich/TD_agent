import { Prisma, type MeetingChannel, type OperationalMeetingStatus, type OperationalMeetingType } from "@prisma/client";
import { appendOperationalAudit, findOperationalReplay } from "@/lib/operationalAudit";
import { assertCapability, type OperationalContext } from "@/lib/operationalAuth";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";
import { closeMeetingEscalationInTransaction, projectPastMeetingEscalationInTransaction } from "@/lib/operationsProjection";
import { prisma } from "@/lib/prisma";

export type MeetingCommandMeta = {
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;
};

export type MeetingResult = {
  id: number;
  caseId: string;
  leadId: number;
  status: OperationalMeetingStatus;
  version: number;
  scheduledAt: string | null;
  ownerMembershipId: string;
  replayed: boolean;
};

export async function createMeeting(
  context: OperationalContext,
  input: {
    leadId: number;
    scheduledAt?: Date | null;
    ownerMembershipId?: string;
    type?: OperationalMeetingType;
    channel?: MeetingChannel;
    location?: string | null;
    durationMinutes?: number | null;
    attendees?: Prisma.InputJsonValue;
  },
  meta: MeetingCommandMeta,
): Promise<MeetingResult> {
  assertCapability(context, "work:mutate-own");
  validateMeta(meta);

  return runMeetingCommand(context, meta.idempotencyKey, "meeting.created", undefined, async (tx) => {
    const replay = await commandReplay(tx, context, meta.idempotencyKey, "meeting.created");
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

    const ownerMembershipId = input.ownerMembershipId ?? context.membershipId;
    if (context.role === "AGENT" && ownerMembershipId !== context.membershipId) {
      throw new OperationalCommandError(403, "Агент может назначить встречу только себе");
    }
    const owner = await activeOwner(tx, context.organizationId, ownerMembershipId);
    const scheduledAt = input.scheduledAt ?? null;
    const status: OperationalMeetingStatus = scheduledAt ? "SCHEDULED" : "TENTATIVE";
    const cobrowseCode = Buffer.from(crypto.getRandomValues(new Uint8Array(5))).toString("hex").toUpperCase();

    const meeting = await tx.meeting.create({
      data: {
        leadId: canonicalCase.leadId,
        agentId: owner.agentId,
        organizationId: context.organizationId,
        caseId: canonicalCase.id,
        ownerMembershipId,
        status: "SCHEDULED",
        operationalStatus: status,
        scheduledAt,
        type: input.type ?? "CONSULTATION",
        channel: input.channel ?? "IN_PERSON",
        location: input.location?.trim() || null,
        durationMinutes: input.durationMinutes ?? null,
        timezone: context.timezone,
        attendees: input.attendees ?? [],
        idempotencyKey: meta.idempotencyKey,
        cobrowseCode,
      },
    });
    const result = toMeetingResult(meeting, false);
    await appendOperationalAudit(tx, context, {
      entityType: "meeting",
      entityId: String(meeting.id),
      action: "meeting.created",
      before: {},
      after: meetingSnapshot(meeting),
      correlationId: meta.correlationId,
      causationId: meta.causationId,
      idempotencyKey: meta.idempotencyKey,
      result: json(result),
    });
    return result;
  });
}

export async function updateMeetingStatus(
  context: OperationalContext,
  meetingId: number,
  input: { status: "CONFIRMED" | "COMPLETED" | "NO_SHOW" | "CANCELLED"; outcome?: string; reason?: string; version: number },
  meta: MeetingCommandMeta,
): Promise<MeetingResult> {
  assertCapability(context, "work:mutate-own");
  validateMeta(meta);

  const explanation = input.status === "CANCELLED" ? input.reason : input.outcome;
  if (["COMPLETED", "NO_SHOW", "CANCELLED"].includes(input.status) && !explanation?.trim()) {
    throw new OperationalCommandError(422, "Зафиксируйте результат или причину");
  }

  return changeMeeting(
    context,
    meetingId,
    input.version,
    meta,
    `meeting.${input.status.toLowerCase()}`,
    async (tx, current) => {
      assertMeetingTransition(current.operationalStatus, input.status);
      const terminal = ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(input.status);
      if (!terminal) {
        await cancelStaleMeetingEscalations(tx, context, current, meta, "task.cancelled_by_meeting_status_change");
      }
      const updated = await tx.meeting.update({
        where: { id: current.id },
        data: {
          operationalStatus: input.status,
          status: input.status === "COMPLETED" ? "COMPLETED" : input.status === "CANCELLED" || input.status === "NO_SHOW" ? "CANCELLED" : "SCHEDULED",
          outcome: explanation?.trim() || null,
          outcomeRecordedAt: terminal ? new Date() : null,
          endedAt: terminal ? new Date() : current.endedAt,
          version: { increment: 1 },
        },
      });
      if (terminal) {
        await closeMeetingEscalationInTransaction(
          tx,
          { ...context, correlationId: meta.correlationId },
          meetingId,
          explanation!.trim(),
          `${meta.idempotencyKey}:escalation`,
        );
      } else if (input.status === "CONFIRMED") {
        await projectPastMeetingEscalationInTransaction(tx, context.organizationId, meetingId, new Date());
      }
      return updated;
    },
  );
}

export async function rescheduleMeeting(
  context: OperationalContext,
  meetingId: number,
  input: { scheduledAt: Date | null; durationMinutes?: number | null; reason: string; version: number },
  meta: MeetingCommandMeta,
): Promise<MeetingResult> {
  assertCapability(context, "work:mutate-own");
  validateMeta(meta);
  if (!input.reason.trim()) throw new OperationalCommandError(422, "Укажите причину переноса");

  return changeMeeting(context, meetingId, input.version, meta, "meeting.rescheduled", async (tx, current) => {
    if (["COMPLETED", "NO_SHOW", "CANCELLED"].includes(current.operationalStatus)) {
      throw new OperationalCommandError(409, "Завершённую встречу нельзя перенести");
    }
    await cancelStaleMeetingEscalations(tx, context, current, meta, "task.cancelled_by_meeting_reschedule");
    return tx.meeting.update({
      where: { id: current.id },
      data: {
        scheduledAt: input.scheduledAt,
        durationMinutes: input.durationMinutes === undefined ? current.durationMinutes : input.durationMinutes,
        operationalStatus: input.scheduledAt ? "SCHEDULED" : "TENTATIVE",
        status: "SCHEDULED",
        version: { increment: 1 },
      },
    });
  });
}

async function changeMeeting(
  context: OperationalContext,
  meetingId: number,
  expectedVersion: number,
  meta: MeetingCommandMeta,
  action: string,
  change: (tx: Prisma.TransactionClient, current: LoadedMeeting) => Promise<LoadedMeeting>,
) {
  return runMeetingCommand(context, meta.idempotencyKey, action, String(meetingId), async (tx) => {
    const replay = await commandReplay(tx, context, meta.idempotencyKey, action, String(meetingId));
    if (replay) return replay;
    const current = await loadMeeting(tx, context, meetingId);
    if (!current) throw new OperationalCommandError(404, "Встреча не найдена");
    if (current.version !== expectedVersion) {
      throw new OperationalCommandError(409, "Встреча уже изменена. Обновите страницу и повторите действие.", "VERSION_CONFLICT");
    }
    const updated = await change(tx, current);
    const result = toMeetingResult(updated, false);
    await appendOperationalAudit(tx, context, {
      entityType: "meeting",
      entityId: String(meetingId),
      action,
      before: meetingSnapshot(current),
      after: meetingSnapshot(updated),
      correlationId: meta.correlationId,
      causationId: meta.causationId,
      idempotencyKey: meta.idempotencyKey,
      result: json(result),
    });
    return result;
  });
}

async function runMeetingCommand(
  context: OperationalContext,
  idempotencyKey: string,
  action: string,
  entityId: string | undefined,
  command: (tx: Prisma.TransactionClient) => Promise<MeetingResult>,
) {
  try {
    return await runOperationalTransaction(command);
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const replay = await prisma.$transaction((tx) => commandReplay(tx, context, idempotencyKey, action, entityId));
    if (replay) return replay;
    throw error;
  }
}

async function loadMeeting(tx: Prisma.TransactionClient, context: OperationalContext, meetingId: number) {
  return tx.meeting.findFirst({
    where: {
      id: meetingId,
      organizationId: context.organizationId,
      ...(context.role === "ADMIN" ? {} : { ownerMembershipId: context.membershipId }),
    },
  });
}

type LoadedMeeting = NonNullable<Awaited<ReturnType<typeof loadMeeting>>>;

async function activeOwner(tx: Prisma.TransactionClient, organizationId: string, membershipId: string) {
  const owner = await tx.membership.findFirst({
    where: { id: membershipId, organizationId, status: "ACTIVE", agentId: { not: null } },
    select: { id: true, agentId: true },
  });
  if (!owner?.agentId) throw new OperationalCommandError(422, "Владелец встречи не входит в активную команду");
  return { ...owner, agentId: owner.agentId };
}

function assertMeetingTransition(from: OperationalMeetingStatus, to: OperationalMeetingStatus) {
  const allowed: Record<OperationalMeetingStatus, OperationalMeetingStatus[]> = {
    TENTATIVE: ["SCHEDULED", "CANCELLED"],
    SCHEDULED: ["CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"],
    CONFIRMED: ["COMPLETED", "NO_SHOW", "CANCELLED"],
    COMPLETED: [],
    NO_SHOW: [],
    CANCELLED: [],
  };
  if (!allowed[from].includes(to)) {
    throw new OperationalCommandError(409, `Переход ${from} -> ${to} запрещён`);
  }
}

async function commandReplay(
  tx: Prisma.TransactionClient,
  context: OperationalContext,
  idempotencyKey: string,
  expectedAction: string,
  expectedEntityId?: string,
): Promise<MeetingResult | null> {
  const replay = await findOperationalReplay(tx, context.organizationId, idempotencyKey);
  if (!replay) return null;
  if (
    replay.action !== expectedAction
    || replay.entityType !== "meeting"
    || (expectedEntityId !== undefined && replay.entityId !== expectedEntityId)
  ) {
    throw new OperationalCommandError(409, "Idempotency key уже использован другой командой", "IDEMPOTENCY_CONFLICT");
  }
  const result = replay.result as Record<string, unknown>;
  const authorized = expectedEntityId === undefined
    ? await tx.case.findFirst({
        where: {
          id: String(result.caseId),
          tenantId: context.organizationId,
          ...(context.role === "AGENT" ? { ownerId: context.agentId } : {}),
        },
        select: { id: true },
      })
    : await loadMeeting(tx, context, Number(expectedEntityId));
  if (!authorized) throw new OperationalCommandError(404, "Встреча не найдена");
  return {
    id: Number(result.id),
    caseId: String(result.caseId),
    leadId: Number(result.leadId),
    status: result.status as OperationalMeetingStatus,
    version: Number(result.version),
    scheduledAt: typeof result.scheduledAt === "string" ? result.scheduledAt : null,
    ownerMembershipId: String(result.ownerMembershipId),
    replayed: true,
  };
}

function validateMeta(meta: MeetingCommandMeta) {
  if (!meta.idempotencyKey.trim() || !meta.correlationId.trim()) {
    throw new OperationalCommandError(400, "Нужны Idempotency-Key и X-Correlation-Id");
  }
}

function toMeetingResult(meeting: LoadedMeeting, replayed: boolean): MeetingResult {
  return {
    id: meeting.id,
    caseId: meeting.caseId,
    leadId: meeting.leadId,
    status: meeting.operationalStatus,
    version: meeting.version,
    scheduledAt: meeting.scheduledAt?.toISOString() ?? null,
    ownerMembershipId: meeting.ownerMembershipId,
    replayed,
  };
}

function meetingSnapshot(meeting: LoadedMeeting): Prisma.InputJsonValue {
  return {
    status: meeting.operationalStatus,
    type: meeting.type,
    ownerMembershipId: meeting.ownerMembershipId,
    scheduledAt: meeting.scheduledAt?.toISOString() ?? null,
    durationMinutes: meeting.durationMinutes,
    timezone: meeting.timezone,
    channel: meeting.channel,
    hasLocation: Boolean(meeting.location),
    hasOutcome: Boolean(meeting.outcome),
    outcomeRecordedAt: meeting.outcomeRecordedAt?.toISOString() ?? null,
    version: meeting.version,
  };
}

async function cancelStaleMeetingEscalations(
  tx: Prisma.TransactionClient,
  context: OperationalContext,
  meeting: LoadedMeeting,
  meta: MeetingCommandMeta,
  action: "task.cancelled_by_meeting_reschedule" | "task.cancelled_by_meeting_status_change",
) {
  const tasks = await tx.task.findMany({
    where: {
      organizationId: context.organizationId,
      type: "MEETING_ESCALATION",
      status: "OPEN",
      sourceEventId: { startsWith: `meeting:${meeting.id}:past-due:v` },
    },
  });
  for (const task of tasks) {
    const updated = await tx.task.update({
      where: { id: task.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        waitingReason: null,
        version: { increment: 1 },
      },
    });
    await appendOperationalAudit(tx, context, {
      entityType: "task",
      entityId: String(task.id),
      action,
      before: meetingEscalationSnapshot(task),
      after: meetingEscalationSnapshot(updated),
      correlationId: meta.correlationId,
      causationId: String(meeting.id),
      idempotencyKey: `${meta.idempotencyKey}:escalation:${task.id}`,
      result: { taskId: task.id, status: updated.status },
    });
  }
}

function meetingEscalationSnapshot(task: {
  status: string;
  type: string;
  priority: string;
  assigneeMembershipId: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  outcome: string | null;
  waitingReason: string | null;
  version: number;
}): Prisma.InputJsonValue {
  return {
    status: task.status,
    type: task.type,
    priority: task.priority,
    assigneeMembershipId: task.assigneeMembershipId,
    dueAt: task.dueAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    cancelledAt: task.cancelledAt?.toISOString() ?? null,
    hasOutcome: Boolean(task.outcome),
    isWaiting: Boolean(task.waitingReason),
    version: task.version,
  };
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
