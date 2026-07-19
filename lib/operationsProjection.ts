import { Prisma } from "@prisma/client";
import type { CaseCommandContext } from "@/lib/caseService";
import { prisma } from "@/lib/prisma";
import { runOperationalTransaction } from "@/lib/operationalTransaction";
import type { OperationalContext } from "@/lib/operationalAuth";

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

  const affectedTaskIds: number[] = [];
  if (input.eventType === "scenario.selected.v1") {
    const tasks = await Promise.all([
      createProjectedTask(tx, context, input, {
        type: "PREPARATION",
        title: "Подготовить сценарный чек-лист",
        expectedOutcome: "Все обязательные действия до встречи распределены",
        priority: "HIGH",
      }),
      createProjectedTask(tx, context, input, {
        type: "QUOTE_SEND",
        title: "Подготовить и отправить смету",
        expectedOutcome: "Смета опубликована для клиента",
        priority: "HIGH",
      }),
    ]);
    affectedTaskIds.push(...tasks.map((task) => task.id));
  }

  if (input.eventType === "quote.published.v1") {
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
      ...(typeof scope !== "string" && scope.role === "AGENT"
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
  const sourceEventId = `meeting:${meetingId}:past-due:v1`;
  try {
    return await runOperationalTransaction(async (tx) => {
        const receipt = await tx.projectionReceipt.findUnique({
          where: {
            organizationId_projector_sourceEventId: {
              organizationId,
              projector: "m1.meeting-escalation.v1",
              sourceEventId,
            },
          },
        });
        if (receipt) return false;

        const [current] = await tx.$queryRaw<Array<{
          id: number;
          caseId: string;
          leadId: number;
          agentId: number;
          ownerMembershipId: string;
          scheduledAt: Date | null;
          operationalStatus: string;
          outcomeRecordedAt: Date | null;
        }>>(Prisma.sql`
          SELECT
            "id", "caseId", "leadId", "agentId", "ownerMembershipId",
            "scheduledAt", "operationalStatus", "outcomeRecordedAt"
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
          return false;
        }

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
        return true;
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
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

export async function closeMeetingEscalationInTransaction(
  tx: Prisma.TransactionClient,
  context: Pick<CaseCommandContext, "organizationId" | "membershipId" | "correlationId">,
  meetingId: number,
  outcome: string,
  idempotencyKey: string,
) {
  const sourceEventId = `meeting:${meetingId}:past-due:v1`;
  const task = await tx.task.findFirst({
    where: { organizationId: context.organizationId, sourceEventId, type: "MEETING_ESCALATION", status: "OPEN" },
  });
  if (!task) return null;
  const updated = await tx.task.update({
    where: { id: task.id },
    data: { status: "COMPLETED", completedAt: new Date(), outcome, version: { increment: 1 } },
  });
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
      causationId: sourceEventId,
      idempotencyKey,
      result: { taskId: task.id, status: updated.status },
    },
  });
  return updated;
}

async function createProjectedTask(
  tx: Prisma.TransactionClient,
  context: CaseCommandContext,
  input: CaseProjectionInput,
  task: {
    type: "PREPARATION" | "QUOTE_SEND";
    title: string;
    expectedOutcome: string;
    priority: "HIGH";
  },
) {
  const created = await tx.task.create({
    data: {
      organizationId: context.organizationId,
      caseId: input.caseId,
      leadId: input.leadId,
      agentId: context.agentId,
      assigneeMembershipId: context.membershipId,
      createdByMembershipId: context.membershipId,
      type: task.type,
      priority: task.priority,
      status: "OPEN",
      sourceEventId: input.eventId,
      idempotencyKey: `projection:${input.eventId}:${task.type.toLowerCase()}`,
      title: task.title,
      expectedOutcome: task.expectedOutcome,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  await tx.operationalAuditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorMembershipId: context.membershipId,
      entityType: "task",
      entityId: String(created.id),
      action: "task.created_by_event",
      before: {},
      after: projectionTaskSnapshot(created),
      correlationId: context.correlationId,
      causationId: input.eventId,
      idempotencyKey: `projection:${input.eventId}:${task.type.toLowerCase()}:audit`,
      result: { taskId: created.id },
    },
  });
  return created;
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
    outcome: task.outcome,
    version: task.version,
  };
}
