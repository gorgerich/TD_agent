import type { OperationalMeetingStatus, TaskPriority, TaskType } from "@prisma/client";
import { assertCapability, type OperationalContext } from "@/lib/operationalAuth";
import { prisma } from "@/lib/prisma";

export type QueueGroup = "OVERDUE" | "TODAY" | "UPCOMING" | "WAITING";
export type QueueItem = {
  key: string;
  kind: "TASK" | "MEETING";
  id: number;
  caseId: string;
  leadId: number;
  clientName: string;
  title: string;
  ownerName: string;
  dueAt: string | null;
  ceremonyAt: string | null;
  group: QueueGroup;
  priority: TaskPriority | "CRITICAL";
  status: string;
  source: string;
  expectedOutcome: string;
  reason: string | null;
  actionLabel: string;
  href: string;
  riskScore: number;
  version: number;
};

export type OperationsQueue = {
  generatedAt: string;
  timezone: string;
  groups: Record<QueueGroup, QueueItem[]>;
  counts: Record<QueueGroup, number>;
};

export type ControlTowerMember = {
  membershipId: string;
  name: string;
  role: string;
  open: number;
  overdue: number;
  today: number;
  meetings: number;
  workload: number;
  capacity: "AVAILABLE" | "BALANCED" | "OVERLOADED";
};

export type ControlTowerAuditEvent = {
  id: string;
  action: string;
  entityType: string;
  actorName: string;
  reason: string | null;
  createdAt: string;
};

export type ControlTowerCase = {
  caseId: string;
  leadId: number;
  clientName: string;
  ownerName: string;
  stage: string;
  ceremonyAt: string | null;
  overdue: number;
  open: number;
  unassigned: number;
  risk: "CRITICAL" | "ATTENTION" | "NORMAL";
  href: string;
};

export type TeamControlTower = {
  timezone: string;
  members: ControlTowerMember[];
  cases: ControlTowerCase[];
  tasks: ControlTowerTask[];
  auditEvents: ControlTowerAuditEvent[];
  totals: { open: number; overdue: number; unassigned: number; ceremoniesSoon: number };
};

export type ControlTowerTask = {
  id: number;
  leadId: number;
  caseId: string;
  title: string;
  clientName: string;
  assigneeMembershipId: string | null;
  ownerName: string;
  dueAt: string | null;
  priority: string;
  version: number;
  expectedOutcome: string | null;
};

const PRIORITY_SCORE: Record<TaskPriority | "CRITICAL", number> = {
  LOW: 10,
  NORMAL: 20,
  HIGH: 40,
  CRITICAL: 70,
};

export async function getOperationsQueue(context: OperationalContext, now = new Date()): Promise<OperationsQueue> {
  assertCapability(context, "work:read");
  const ownerFilter = context.role === "ADMIN" ? {} : { assigneeMembershipId: context.membershipId };
  const meetingOwnerFilter = context.role === "ADMIN" ? {} : { ownerMembershipId: context.membershipId };
  const [tasks, meetings] = await Promise.all([
    prisma.task.findMany({
      where: {
        organizationId: context.organizationId,
        status: "OPEN",
        ...ownerFilter,
      },
      include: {
        lead: {
          select: {
            name: true,
            ceremonyAt: true,
            meetings: { orderBy: { id: "desc" }, take: 1, select: { id: true } },
          },
        },
        assignee: { select: { user: { select: { name: true } } } },
      },
      take: 500,
    }),
    prisma.meeting.findMany({
      where: {
        organizationId: context.organizationId,
        operationalStatus: { in: ["TENTATIVE", "SCHEDULED", "CONFIRMED"] },
        ...meetingOwnerFilter,
      },
      include: {
        lead: { select: { name: true, ceremonyAt: true } },
        ownerMembership: { select: { user: { select: { name: true } } } },
      },
      take: 500,
    }),
  ]);

  const projectedMeetingIds = new Set(
    tasks
      .filter((task) => task.type === "MEETING_ESCALATION")
      .map((task) => meetingIdFromSource(task.sourceEventId))
      .filter((meetingId): meetingId is number => meetingId !== null),
  );
  const items: QueueItem[] = [
    ...tasks.map((task) => taskQueueItem(task, context.timezone, now)),
    ...meetings
      .filter((meeting) => !projectedMeetingIds.has(meeting.id))
      .map((meeting) => meetingQueueItem(meeting, context.timezone, now)),
  ];
  items.sort(compareQueueItems);

  const groups: Record<QueueGroup, QueueItem[]> = { OVERDUE: [], TODAY: [], UPCOMING: [], WAITING: [] };
  for (const item of items) groups[item.group].push(item);
  return {
    generatedAt: now.toISOString(),
    timezone: context.timezone,
    groups,
    counts: {
      OVERDUE: groups.OVERDUE.length,
      TODAY: groups.TODAY.length,
      UPCOMING: groups.UPCOMING.length,
      WAITING: groups.WAITING.length,
    },
  };
}

export async function getTeamControlTower(context: OperationalContext, now = new Date()): Promise<TeamControlTower> {
  assertCapability(context, "team:read");
  const [memberships, tasks, meetings, cases, auditEvents] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId: context.organizationId, status: "ACTIVE", agentId: { not: null } },
      select: { id: true, role: true, user: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.task.findMany({
      where: { organizationId: context.organizationId, status: "OPEN" },
      select: {
        id: true,
        leadId: true,
        caseId: true,
        title: true,
        assigneeMembershipId: true,
        dueAt: true,
        waitingReason: true,
        priority: true,
        version: true,
        expectedOutcome: true,
        lead: { select: { name: true } },
        assignee: { select: { user: { select: { name: true } } } },
      },
    }),
    prisma.meeting.findMany({
      where: {
        organizationId: context.organizationId,
        operationalStatus: { in: ["TENTATIVE", "SCHEDULED", "CONFIRMED"] },
      },
      select: { ownerMembershipId: true },
    }),
    prisma.case.findMany({
      where: { tenantId: context.organizationId, closedAt: null },
      select: {
        id: true,
        leadId: true,
        stage: true,
        lead: { select: { name: true, ceremonyAt: true } },
        owner: { select: { user: { select: { name: true } } } },
      },
      take: 500,
    }),
    prisma.operationalAuditEvent.findMany({
      where: { organizationId: context.organizationId },
      select: {
        id: true,
        action: true,
        entityType: true,
        reason: true,
        createdAt: true,
        actor: { select: { user: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  const today = zonedDateKey(now, context.timezone);
  const members = memberships.map((membership) => {
    const ownTasks = tasks.filter((task) => task.assigneeMembershipId === membership.id);
    const overdue = ownTasks.filter((task) => task.dueAt && task.dueAt < now).length;
    const todayCount = ownTasks.filter((task) => task.dueAt && task.dueAt >= now && zonedDateKey(task.dueAt, context.timezone) === today).length;
    const open = ownTasks.length;
    const meetingCount = meetings.filter((meeting) => meeting.ownerMembershipId === membership.id).length;
    const workload = open + meetingCount * 2;
    return {
      membershipId: membership.id,
      name: membership.user.name ?? "Без имени",
      role: membership.role,
      open,
      overdue,
      today: todayCount,
      meetings: meetingCount,
      workload,
      capacity: workload >= 12 || overdue >= 4 ? "OVERLOADED" : workload >= 6 ? "BALANCED" : "AVAILABLE",
    } satisfies ControlTowerMember;
  });

  const caseRows = cases.map((item) => {
    const caseTasks = tasks.filter((task) => task.caseId === item.id);
    const overdue = caseTasks.filter((task) => task.dueAt && task.dueAt < now).length;
    const unassigned = caseTasks.filter((task) => !task.assigneeMembershipId).length;
    const ceremonyRisk = item.lead.ceremonyAt ? futureHoursUntil(item.lead.ceremonyAt, now) : null;
    const risk = overdue > 0 || (ceremonyRisk !== null && ceremonyRisk <= 24)
      ? "CRITICAL"
      : unassigned > 0 || (ceremonyRisk !== null && ceremonyRisk <= 72)
        ? "ATTENTION"
        : "NORMAL";
    return {
      caseId: item.id,
      leadId: item.leadId,
      clientName: item.lead.name,
      ownerName: item.owner.user.name ?? "Без владельца",
      stage: item.stage,
      ceremonyAt: item.lead.ceremonyAt?.toISOString() ?? null,
      overdue,
      open: caseTasks.length,
      unassigned,
      risk,
      href: `/agent/cases/${item.leadId}?tab=work`,
    } satisfies ControlTowerCase;
  }).sort((a, b) => riskWeight(b.risk) - riskWeight(a.risk) || b.overdue - a.overdue || a.clientName.localeCompare(b.clientName, "ru"));

  return {
    timezone: context.timezone,
    members,
    cases: caseRows,
    tasks: tasks
      .filter((task) => !task.assigneeMembershipId || (task.dueAt && zonedDateKey(task.dueAt, context.timezone) <= today))
      .map((task) => ({
        id: task.id,
        leadId: task.leadId,
        caseId: task.caseId,
        title: task.title,
        clientName: task.lead.name,
        assigneeMembershipId: task.assigneeMembershipId,
        ownerName: task.assignee?.user.name ?? "Не назначено",
        dueAt: task.dueAt?.toISOString() ?? null,
        priority: task.priority,
        version: task.version,
        expectedOutcome: task.expectedOutcome,
      }))
      .sort((a, b) => Number(!b.assigneeMembershipId) - Number(!a.assigneeMembershipId) || nullableTime(a.dueAt) - nullableTime(b.dueAt)),
    auditEvents: auditEvents.map((event) => ({
      id: event.id,
      action: auditActionLabel(event.action),
      entityType: auditEntityLabel(event.entityType),
      actorName: event.actor?.user.name ?? "Система",
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
    totals: {
      open: tasks.length,
      overdue: tasks.filter((task) => task.dueAt && task.dueAt < now).length,
      unassigned: tasks.filter((task) => !task.assigneeMembershipId).length,
      ceremoniesSoon: cases.filter((item) => {
        const hours = item.lead.ceremonyAt ? futureHoursUntil(item.lead.ceremonyAt, now) : null;
        return hours !== null && hours <= 72;
      }).length,
    },
  };
}

type TaskRow = Awaited<ReturnType<typeof prisma.task.findMany<{
  include: {
    lead: { select: { name: true; ceremonyAt: true; meetings: { orderBy: { id: "desc" }; take: 1; select: { id: true } } } };
    assignee: { select: { user: { select: { name: true } } } };
  };
}>>>[number];

type MeetingRow = Awaited<ReturnType<typeof prisma.meeting.findMany<{
  include: {
    lead: { select: { name: true; ceremonyAt: true } };
    ownerMembership: { select: { user: { select: { name: true } } } };
  };
}>>>[number];

function taskQueueItem(task: TaskRow, timezone: string, now: Date): QueueItem {
  const group = task.type === "MEETING_ESCALATION"
    ? "OVERDUE"
    : task.waitingReason
      ? "WAITING"
      : queueGroup(task.dueAt, timezone, now);
  const escalationMeetingId = task.type === "MEETING_ESCALATION" ? meetingIdFromSource(task.sourceEventId) : null;
  const quoteMeetingId = task.type === "QUOTE_SEND" ? task.lead.meetings[0]?.id ?? null : null;
  return {
    key: `task:${task.id}`,
    kind: "TASK",
    id: task.id,
    caseId: task.caseId,
    leadId: task.leadId,
    clientName: task.lead.name,
    title: task.title,
    ownerName: task.assignee?.user.name ?? "Не назначено",
    dueAt: task.dueAt?.toISOString() ?? null,
    ceremonyAt: task.lead.ceremonyAt?.toISOString() ?? null,
    group,
    priority: task.priority,
    status: task.status,
    source: taskSourceLabel(task.type),
    expectedOutcome: task.expectedOutcome ?? defaultTaskOutcome(task.type),
    reason: task.waitingReason ?? taskReason(task.type),
    actionLabel: taskActionLabel(task.type),
    href: escalationMeetingId
      ? `/agent/meetings/${escalationMeetingId}?from=today`
      : quoteMeetingId
        ? `/agent/meetings/${quoteMeetingId}/quote?from=today&task=${task.id}`
        : `/agent/cases/${task.leadId}?tab=work&task=${task.id}`,
    riskScore: queueRiskScore(group, task.priority, task.dueAt, task.lead.ceremonyAt, now),
    version: task.version,
  };
}

function meetingQueueItem(meeting: MeetingRow, timezone: string, now: Date): QueueItem {
  const past = Boolean(meeting.scheduledAt && meeting.scheduledAt < now);
  const group: QueueGroup = meeting.operationalStatus === "TENTATIVE"
    ? "WAITING"
    : past
      ? "OVERDUE"
      : queueGroup(meeting.scheduledAt, timezone, now);
  const title = meeting.operationalStatus === "TENTATIVE"
    ? "Уточнить время встречи"
    : past
      ? "Зафиксировать итог прошедшей встречи"
      : meetingTitle(meeting.operationalStatus);
  return {
    key: `meeting:${meeting.id}`,
    kind: "MEETING",
    id: meeting.id,
    caseId: meeting.caseId,
    leadId: meeting.leadId,
    clientName: meeting.lead.name,
    title,
    ownerName: meeting.ownerMembership.user.name ?? "Без владельца",
    dueAt: meeting.scheduledAt?.toISOString() ?? null,
    ceremonyAt: meeting.lead.ceremonyAt?.toISOString() ?? null,
    group,
    priority: past ? "CRITICAL" : "HIGH",
    status: meeting.operationalStatus,
    source: "Встреча",
    expectedOutcome: past ? "Результат: завершена, неявка или отмена" : "Встреча проведена и результат зафиксирован",
    reason: meeting.operationalStatus === "TENTATIVE"
      ? "Время ещё не согласовано"
      : past
        ? "Встреча прошла, но итог ещё не зафиксирован"
        : "Запланированная встреча по активному кейсу",
    actionLabel: past ? "Зафиксировать исход" : meeting.operationalStatus === "TENTATIVE" ? "Назначить время" : "Открыть встречу",
    href: `/agent/meetings/${meeting.id}?from=today`,
    riskScore: queueRiskScore(group, past ? "CRITICAL" : "HIGH", meeting.scheduledAt, meeting.lead.ceremonyAt, now),
    version: meeting.version,
  };
}

function queueGroup(value: Date | null, timezone: string, now: Date): QueueGroup {
  if (!value) return "UPCOMING";
  if (value < now) return "OVERDUE";
  const key = zonedDateKey(value, timezone);
  const today = zonedDateKey(now, timezone);
  if (key === today) return "TODAY";
  return "UPCOMING";
}

export function zonedDateKey(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function queueRiskScore(group: QueueGroup, priority: TaskPriority | "CRITICAL", dueAt: Date | null, ceremonyAt: Date | null, now: Date) {
  const groupScore = group === "OVERDUE" ? 80 : group === "TODAY" ? 50 : group === "WAITING" ? 30 : 10;
  const overdueHours = dueAt && dueAt < now ? Math.min(48, Math.floor((now.getTime() - dueAt.getTime()) / 3_600_000)) : 0;
  const ceremonyHours = ceremonyAt ? futureHoursUntil(ceremonyAt, now) : null;
  const ceremonyScore = ceremonyHours !== null && ceremonyHours <= 24 ? 50 : ceremonyHours !== null && ceremonyHours <= 72 ? 25 : 0;
  return groupScore + PRIORITY_SCORE[priority] + overdueHours + ceremonyScore;
}

function compareQueueItems(a: QueueItem, b: QueueItem) {
  return b.riskScore - a.riskScore
    || nullableTime(a.dueAt) - nullableTime(b.dueAt)
    || a.clientName.localeCompare(b.clientName, "ru");
}

function nullableTime(value: string | null) {
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
}

function hoursUntil(value: Date, now: Date) {
  return (value.getTime() - now.getTime()) / 3_600_000;
}

function futureHoursUntil(value: Date, now: Date) {
  const hours = hoursUntil(value, now);
  return hours >= 0 ? hours : null;
}

function riskWeight(value: ControlTowerCase["risk"]) {
  return value === "CRITICAL" ? 3 : value === "ATTENTION" ? 2 : 1;
}

function taskSourceLabel(type: TaskType) {
  if (type === "PREPARATION") return "Сценарий кейса";
  if (type === "QUOTE_SEND") return "Смета";
  if (type === "MEETING_ESCALATION") return "Просроченная встреча";
  if (type === "FOLLOW_UP") return "Итог встречи";
  return "Агент";
}

function taskReason(type: TaskType) {
  if (type === "PREPARATION") return "Подготовка нужна для следующего этапа кейса";
  if (type === "QUOTE_SEND") return "Клиенту нужно получить актуальную смету";
  if (type === "MEETING_ESCALATION") return "Прошедшая встреча остаётся без зафиксированного исхода";
  if (type === "FOLLOW_UP") return "После встречи требуется следующий подтверждённый шаг";
  return "Агент зафиксировал обязательное действие по кейсу";
}

function auditActionLabel(action: string) {
  if (action === "task.assigned") return "Исполнитель задачи изменён";
  if (action === "task.completed") return "Задача завершена";
  if (action === "task.completion_noop") return "Повторное завершение подтверждено без изменений";
  if (action === "task.cancelled_by_meeting_reschedule") return "Эскалация закрыта после переноса встречи";
  if (action === "task.created") return "Задача создана";
  if (action === "meeting.status_changed") return "Статус встречи изменён";
  if (action === "case.intake_saved") return "Данные кейса обновлены";
  return action.replaceAll("_", " ").replaceAll(".", " · ");
}

function auditEntityLabel(entityType: string) {
  if (entityType.toLowerCase() === "task") return "Задача";
  if (entityType.toLowerCase() === "meeting") return "Встреча";
  if (entityType.toLowerCase() === "case") return "Кейс";
  if (entityType.toLowerCase() === "savedoperationalview" || entityType.toLowerCase() === "saved_view") return "Сохранённый вид";
  return entityType;
}

function defaultTaskOutcome(type: TaskType) {
  if (type === "PREPARATION") return "Подготовка завершена";
  if (type === "QUOTE_SEND") return "Смета отправлена клиенту";
  if (type === "MEETING_ESCALATION") return "Исход встречи зафиксирован";
  return "Результат действия зафиксирован";
}

function taskActionLabel(type: TaskType) {
  if (type === "PREPARATION") return "Открыть подготовку";
  if (type === "QUOTE_SEND") return "Открыть смету";
  if (type === "MEETING_ESCALATION") return "Зафиксировать исход";
  return "Зафиксировать результат";
}

function meetingTitle(status: OperationalMeetingStatus) {
  return status === "CONFIRMED" ? "Провести подтверждённую встречу" : "Подготовиться к встрече";
}

function meetingIdFromSource(source: string | null) {
  const match = source?.match(/^meeting:(\d+):past-due:v\d+$/);
  return match ? Number(match[1]) : null;
}
