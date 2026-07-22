import { prisma } from "@/lib/prisma";

export type OperationsReconciliation = {
  organizationId: string;
  pastMeetingsWithoutEscalation: number;
  openEscalationsForTerminalMeetings: number;
  openEscalationsForIneligibleMeetings: number;
  falseOverdueClosedTasks: number;
  sourceTaskDuplicates: number;
  tenantMismatches: number;
  discrepancies: number;
};

export async function reconcileOperations(organizationId: string, now = new Date()): Promise<OperationsReconciliation> {
  const [meetings, openEscalations, closedOverdue, sourceGroups, taskTenantMismatch, meetingTenantMismatch] = await Promise.all([
    prisma.meeting.findMany({
      where: { organizationId },
      select: { id: true, version: true, operationalStatus: true, scheduledAt: true, outcomeRecordedAt: true },
    }),
    prisma.task.findMany({
      where: {
        organizationId,
        type: "MEETING_ESCALATION",
        status: "OPEN",
        sourceEventId: { startsWith: "meeting:" },
      },
      select: { sourceEventId: true },
    }),
    prisma.task.count({
      where: {
        organizationId,
        dueAt: { lt: now },
        OR: [
          { status: "COMPLETED", completedAt: null },
          { status: "CANCELLED", cancelledAt: null },
        ],
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

  const meetingById = new Map(meetings.map((meeting) => [meeting.id, meeting]));
  const eligibleMeetings = meetings.filter((meeting) => (
    ["SCHEDULED", "CONFIRMED"].includes(meeting.operationalStatus)
    && meeting.scheduledAt !== null
    && meeting.scheduledAt < now
    && meeting.outcomeRecordedAt === null
  ));
  const openSources = new Set(openEscalations.map((task) => task.sourceEventId).filter((source): source is string => Boolean(source)));
  const pastMeetingsWithoutEscalation = eligibleMeetings.filter(
    (meeting) => !openSources.has(`meeting:${meeting.id}:past-due:v${meeting.version}`),
  ).length;
  let openTerminal = 0;
  let openIneligible = 0;
  for (const task of openEscalations) {
    const parsed = parseMeetingEscalationSource(task.sourceEventId);
    const meeting = parsed ? meetingById.get(parsed.meetingId) : null;
    const eligible = Boolean(
      meeting
      && parsed
      && meeting.version === parsed.version
      && ["SCHEDULED", "CONFIRMED"].includes(meeting.operationalStatus)
      && meeting.scheduledAt
      && meeting.scheduledAt < now
      && meeting.outcomeRecordedAt === null,
    );
    if (!eligible) openIneligible += 1;
    if (meeting && ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(meeting.operationalStatus)) openTerminal += 1;
  }
  const tenantMismatches = Number(taskTenantMismatch[0]?.count ?? 0n) + Number(meetingTenantMismatch[0]?.count ?? 0n);
  const sourceTaskDuplicates = sourceGroups.reduce((sum, group) => sum + Math.max(0, group._count._all - 1), 0);
  const discrepancies = pastMeetingsWithoutEscalation + openIneligible + closedOverdue + sourceTaskDuplicates + tenantMismatches;

  return {
    organizationId,
    pastMeetingsWithoutEscalation,
    openEscalationsForTerminalMeetings: openTerminal,
    openEscalationsForIneligibleMeetings: openIneligible,
    falseOverdueClosedTasks: closedOverdue,
    sourceTaskDuplicates,
    tenantMismatches,
    discrepancies,
  };
}

function parseMeetingEscalationSource(source: string | null) {
  const match = source?.match(/^meeting:(\d+):past-due:v(\d+)$/);
  return match ? { meetingId: Number(match[1]), version: Number(match[2]) } : null;
}
