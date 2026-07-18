import { prisma } from "@/lib/prisma";

export type OperationsReconciliation = {
  organizationId: string;
  pastMeetingsWithoutEscalation: number;
  openEscalationsForTerminalMeetings: number;
  falseOverdueClosedTasks: number;
  sourceTaskDuplicates: number;
  tenantMismatches: number;
  discrepancies: number;
};

export async function reconcileOperations(organizationId: string, now = new Date()): Promise<OperationsReconciliation> {
  const [pastMeetings, terminalMeetings, closedOverdue, sourceGroups, taskTenantMismatch, meetingTenantMismatch] = await Promise.all([
    prisma.meeting.findMany({
      where: {
        organizationId,
        operationalStatus: { in: ["SCHEDULED", "CONFIRMED"] },
        scheduledAt: { lt: now },
        outcomeRecordedAt: null,
      },
      select: { id: true },
    }),
    prisma.meeting.findMany({
      where: { organizationId, operationalStatus: { in: ["COMPLETED", "NO_SHOW", "CANCELLED"] } },
      select: { id: true },
    }),
    prisma.task.count({
      where: {
        organizationId,
        status: { in: ["COMPLETED", "CANCELLED", "SUPERSEDED"] },
        dueAt: { lt: now },
        completedAt: null,
        cancelledAt: null,
      },
    }),
    prisma.task.groupBy({
      by: ["sourceEventId", "type"],
      where: { organizationId, sourceEventId: { not: null } },
      _count: { _all: true },
      having: { id: { _count: { gt: 1 } } },
    }),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Task" t
      JOIN "Case" c ON c.id = t."caseId"
      WHERE t."organizationId" = ${organizationId}
        AND c."tenantId" <> t."organizationId"
    `,
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Meeting" m
      JOIN "Case" c ON c.id = m."caseId"
      WHERE m."organizationId" = ${organizationId}
        AND c."tenantId" <> m."organizationId"
    `,
  ]);

  const pastIds = pastMeetings.map((meeting) => `meeting:${meeting.id}:past-due:v1`);
  const terminalIds = terminalMeetings.map((meeting) => `meeting:${meeting.id}:past-due:v1`);
  const [coveredPast, openTerminal] = await Promise.all([
    pastIds.length
      ? prisma.task.count({ where: { organizationId, sourceEventId: { in: pastIds }, type: "MEETING_ESCALATION", status: "OPEN" } })
      : 0,
    terminalIds.length
      ? prisma.task.count({ where: { organizationId, sourceEventId: { in: terminalIds }, type: "MEETING_ESCALATION", status: "OPEN" } })
      : 0,
  ]);
  const pastMeetingsWithoutEscalation = pastMeetings.length - coveredPast;
  const tenantMismatches = Number(taskTenantMismatch[0]?.count ?? 0n) + Number(meetingTenantMismatch[0]?.count ?? 0n);
  const sourceTaskDuplicates = sourceGroups.reduce((sum, group) => sum + Math.max(0, group._count._all - 1), 0);
  const discrepancies = pastMeetingsWithoutEscalation + openTerminal + closedOverdue + sourceTaskDuplicates + tenantMismatches;

  return {
    organizationId,
    pastMeetingsWithoutEscalation,
    openEscalationsForTerminalMeetings: openTerminal,
    falseOverdueClosedTasks: closedOverdue,
    sourceTaskDuplicates,
    tenantMismatches,
    discrepancies,
  };
}
