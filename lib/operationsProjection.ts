import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { serverCommandKey } from "@/lib/commandNamespace";
import type { CaseCommandContext } from "@/lib/caseService";
import { prisma } from "@/lib/prisma";
import { runOperationalTransaction } from "@/lib/operationalTransaction";
import { hasTeamOperationalScope, type OperationalContext } from "@/lib/operationalAuth";

type CaseProjectionInput = {
  eventId: string;
  eventType: string;
  caseId: string;
  leadId: number;
};

export async function projectCaseEventInTransaction(
  tx: Prisma.TransactionClient,
  context: CaseCommandContext,
  input: CaseProjectionInput,
) {
  const existing = await tx.projectionReceipt.findUnique({
    where: {
      organizationId_projector_sourceEventId: {
        organizationId: context.organizationId,
        projector: "m1.case-work.v1",
        sourceEventId: input.eventId,
      },
    },
  });
  if (existing) return existing.result;
  return projectNewCaseEventInTransaction(tx, context, input);
}

// Only call immediately after inserting this source event in the same transaction.
// A duplicate event/receipt aborts all projected writes, including task audits.
export async function projectNewCaseEventInTransaction(
  tx: Prisma.TransactionClient,
  context: CaseCommandContext,
  input: CaseProjectionInput,
) {
  const affectedTaskIds: number[] = [];
  if (input.eventType === "scenario.selected.v1") {
    const tasks = await createProjectedTasks(tx, context, input, [
      {
        type: "PREPARATION",
        title: "Подготовить сценарный чек-лист",
        expectedOutcome: "Все обязательные действия до встречи распределены",
        priority: "HIGH",
      },
      {
        type: "QUOTE_SEND",
        title: "Подготовить и отправить смету",
        expectedOutcome: "Смета опубликована для клиента",
        priority: "HIGH",
      },
    ]);
    return { affectedTaskIds: tasks.map((task) => task.id), affectedCount: tasks.length };
  }

  if (input.eventType === "quote.published.v1" || input.eventType === "quote.republished.v1") {
    const task = await tx.task.findFirst({
      where: {
        organizationId: context.organizationId,
        caseId: input.caseId,
        type: "QUOTE_SEND",
        status: "OPEN",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (task) {
      const updated = await tx.task.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          outcome: "Смета опубликована для клиента",
          waitingReason: null,
          version: { increment: 1 },
        },
      });
      affectedTaskIds.push(task.id);
      await tx.operationalAuditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorMembershipId: context.membershipId,
          entityType: "task",
          entityId: String(task.id),
          action: "task.completed_by_event",
          before: projectionTaskSnapshot(task),
          after: projectionTaskSnapshot(updated),
          correlationId: context.correlationId,
          causationId: input.eventId,
          idempotencyKey: `projection:${input.eventId}:quote-send-complete`,
          result: { taskId: task.id, status: updated.status },
        },
      });
    }
  }

  const result = { affectedTaskIds, affectedCount: affectedTaskIds.length };
  await tx.projectionReceipt.create({
    data: {
      organizationId: context.organizationId,
      projector: "m1.case-work.v1",
      sourceEventId: input.eventId,
      result,
    },
  });
  return result;
}

export async function ensurePastMeetingEscalations(scope: string | OperationalContext, now = new Date()) {
  const organizationId = typeof scope === "string" ? scope : scope.organizationId;
  const meetings = await prisma.meeting.findMany({
    where: {
      organizationId,
      ...(typeof scope !== "string" && !hasTeamOperationalScope(scope.role)
        ? { ownerMembershipId: scope.membershipId }
        : {}),
      operationalStatus: { in: ["SCHEDULED", "CONFIRMED"] },
      scheduledAt: { lt: now },
      outcomeRecordedAt: null,
    },
    select: {
      id: true,
      caseId: true,
      leadId: true,
      agentId: true,
      ownerMembershipId: true,
      scheduledAt: true,
    },
  });

  let created = 0;
  for (const meeting of meetings) {
    if (await projectPastMeetingEscalation(organizationId, meeting.id, now)) created += 1;
  }
  return { scanned: meetings.length, created };
}

export async function projectPastMeetingEscalation(organizationId: string, meetingId: number, now: Date) {
  let sourceEventId: string | null = null;
  try {
    return await runOperationalTransaction(async (tx) => {
      const projected = await projectPastMeetingEscalationInTransaction(
        tx,
        organizationId,
        meetingId,
        now,
        (projectedSourceEventId) => {
          sourceEventId = projectedSourceEventId;
        },
      );
      sourceEventId = projected.sourceEventId;
      return projected.created;
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    if (!sourceEventId) throw error;
    const receipt = await prisma.projectionReceipt.findUnique({
      where: {
        organizationId_projector_sourceEventId: {
          organizationId,
          projector: "m1.meeting-escalation.v1",
          sourceEventId,
        },
      },
    });
    if (!receipt) throw error;
    return false;
  }
}

export async function projectPastMeetingEscalationInTransaction(
  tx: Prisma.TransactionClient,
  organizationId: string,
  meetingId: number,
  now: Date,
  onSourceEventId?: (sourceEventId: string) => void,
) {
  const [current] = await tx.$queryRaw<Array<{
    id: number;
    caseId: string;
    leadId: number;
    agentId: number;
    ownerMembershipId: string;
    scheduledAt: Date | null;
    operationalStatus: string;
    outcomeRecordedAt: Date | null;
    version: number;
  }>>(Prisma.sql`
    SELECT
      "id", "caseId", "leadId", "agentId", "ownerMembershipId",
      "scheduledAt", "operationalStatus", "outcomeRecordedAt", "version"
    FROM "Meeting"
    WHERE "id" = ${meetingId} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `);
  if (
    !current
    || !["SCHEDULED", "CONFIRMED"].includes(current.operationalStatus)
    || !current.scheduledAt
    || current.scheduledAt >= now
    || current.outcomeRecordedAt
  ) {
    return { created: false, sourceEventId: null };
  }

  const sourceEventId = `meeting:${meetingId}:past-due:v${current.version}`;
  onSourceEventId?.(sourceEventId);
  const receipt = await tx.projectionReceipt.findUnique({
    where: {
      organizationId_projector_sourceEventId: {
        organizationId,
        projector: "m1.meeting-escalation.v1",
        sourceEventId,
      },
    },
  });
  if (receipt) return { created: false, sourceEventId };

  const task = await tx.task.create({
    data: {
      organizationId,
      caseId: current.caseId,
      leadId: current.leadId,
      agentId: current.agentId,
      assigneeMembershipId: current.ownerMembershipId,
      createdByMembershipId: current.ownerMembershipId,
      type: "MEETING_ESCALATION",
      priority: "CRITICAL",
      status: "OPEN",
      sourceEventId,
      idempotencyKey: `projection:${sourceEventId}:task`,
      title: "Зафиксировать итог прошедшей встречи",
      expectedOutcome: "Указан результат: завершена, клиент не пришёл или отменена",
      dueAt: now,
    },
  });
  await tx.operationalAuditEvent.create({
    data: {
      organizationId,
      actorType: "system",
      entityType: "task",
      entityId: String(task.id),
      action: "task.escalated_from_meeting",
      before: {},
      after: projectionTaskSnapshot(task),
      correlationId: sourceEventId,
      causationId: sourceEventId,
      idempotencyKey: `projection:${sourceEventId}:audit`,
      result: { taskId: task.id },
    },
  });
  await tx.projectionReceipt.create({
    data: {
      organizationId,
      projector: "m1.meeting-escalation.v1",
      sourceEventId,
      result: { taskId: task.id },
    },
  });
  return { created: true, sourceEventId };
}

export async function closeMeetingEscalationInTransaction(
  tx: Prisma.TransactionClient,
  context: Pick<CaseCommandContext, "organizationId" | "membershipId" | "correlationId">,
  meetingId: number,
  outcome: string,
  idempotencyKey: string,
) {
  const tasks = await tx.task.findMany({
    where: {
      organizationId: context.organizationId,
      sourceEventId: { startsWith: `meeting:${meetingId}:past-due:v` },
      type: "MEETING_ESCALATION",
      status: "OPEN",
    },
    orderBy: { id: "asc" },
  });
  let firstUpdated = null;
  for (const task of tasks) {
    const updated = await tx.task.update({
      where: { id: task.id },
      data: { status: "COMPLETED", completedAt: new Date(), outcome, version: { increment: 1 } },
    });
    firstUpdated ??= updated;
    await tx.operationalAuditEvent.create({
      data: {
        organizationId: context.organizationId,
        actorMembershipId: context.membershipId,
        entityType: "task",
        entityId: String(task.id),
        action: "task.completed_by_meeting_outcome",
        before: projectionTaskSnapshot(task),
        after: projectionTaskSnapshot(updated),
        correlationId: context.correlationId,
        causationId: task.sourceEventId,
        idempotencyKey: serverCommandKey("meeting-outcome-audit", `${idempotencyKey}:${task.id}`),
        result: { taskId: task.id, status: updated.status },
      },
    });
  }
  return firstUpdated;
}

async function createProjectedTasks(
  tx: Prisma.TransactionClient,
  context: CaseCommandContext,
  input: CaseProjectionInput,
  tasks: Array<{
    type: "PREPARATION" | "QUOTE_SEND";
    title: string;
    expectedOutcome: string;
    priority: "HIGH";
  }>,
) {
  const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  // Tasks, append-only audits and the fresh-event receipt commit in one statement.
  const source = JSON.stringify(tasks.map((task, position) => ({ ...task, position, auditId: `audit_${randomUUID().replaceAll("-", "")}` })));
  const receiptId = `receipt_${randomUUID().replaceAll("-", "")}`;
  const created = await tx.$queryRaw<Array<{ id: number; type: string }>>`
    WITH source AS (
      SELECT * FROM jsonb_to_recordset(${source}::jsonb)
        AS item(type text, title text, "expectedOutcome" text, priority text, position integer, "auditId" text)
    ), created AS (
      INSERT INTO "Task" ("organizationId", "caseId", "leadId", "agentId", "assigneeMembershipId",
        "createdByMembershipId", type, priority, status, "sourceEventId", "idempotencyKey", title, "expectedOutcome", "dueAt")
      SELECT ${context.organizationId}, ${input.caseId}, ${input.leadId}, ${context.agentId}, ${context.membershipId},
        ${context.membershipId}, source.type::"TaskType", source.priority::"TaskPriority", 'OPEN'::"TaskStatus",
        ${input.eventId}, 'projection:' || ${input.eventId} || ':' || lower(source.type),
        source.title, source."expectedOutcome", ${dueAt}
      FROM source RETURNING *
    ), audited AS (
      INSERT INTO "OperationalAuditEvent" (id, "organizationId", "actorMembershipId", "entityType", "entityId",
        action, before, after, "correlationId", "causationId", "idempotencyKey", result)
      SELECT source."auditId", task."organizationId", ${context.membershipId}, 'task', task.id::text,
        'task.created_by_event', '{}'::jsonb,
        jsonb_build_object('status', task.status, 'type', task.type, 'priority', task.priority,
          'assigneeMembershipId', task."assigneeMembershipId",
          'dueAt', to_char(task."dueAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'completedAt', NULL, 'hasOutcome', false, 'version', task.version),
        ${context.correlationId}, ${input.eventId}, task."idempotencyKey" || ':audit', jsonb_build_object('taskId', task.id)
      FROM created task JOIN source ON source.type = task.type::text RETURNING id
    ), receipted AS (
      INSERT INTO "ProjectionReceipt" (id, "organizationId", projector, "sourceEventId", result)
      SELECT ${receiptId}, ${context.organizationId}, 'm1.case-work.v1', ${input.eventId},
        jsonb_build_object('affectedTaskIds', jsonb_agg(task.id ORDER BY source.position), 'affectedCount', count(*)::integer)
      FROM created task JOIN source ON source.type = task.type::text RETURNING id
    ) SELECT id, type::text FROM created
  `;
  return tasks.map(task => created.find(record => record.type === task.type)!);
}

function projectionTaskSnapshot(task: {
  status: string;
  type: string;
  priority: string;
  assigneeMembershipId: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  outcome: string | null;
  version: number;
}): Prisma.InputJsonValue {
  return {
    status: task.status,
    type: task.type,
    priority: task.priority,
    assigneeMembershipId: task.assigneeMembershipId,
    dueAt: task.dueAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    hasOutcome: Boolean(task.outcome),
    version: task.version,
  };
}
