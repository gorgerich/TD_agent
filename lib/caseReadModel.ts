import { type CaseScenario, type CaseStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SCENARIO_CLOSURE_GUARDS,
  isSupportedScenario,
  projectCaseRisk,
  projectNextAction,
  type CanonicalCaseFacts,
  type CaseGuardState,
  type CaseRiskProjection,
  type NextActionProjection,
} from "@/lib/caseDomain";
import { tenantIdForAgent } from "@/lib/caseService";
import type { Stage } from "@/lib/case";
import type { StatusTone, WaitingOn } from "@/lib/caseStatus";
import type { OperationalContext } from "@/lib/operationalAuth";

export type CanonicalCaseReadModel = {
  caseId: string;
  publicRef: string;
  leadId: number;
  tenantId: string;
  ownerId: number;
  name: string;
  phone: string;
  source: string;
  stage: CaseStage;
  legacyStage: Stage;
  scenarioId: CaseScenario;
  version: number;
  statusLabel: string;
  statusTone: StatusTone;
  waiting: WaitingOn;
  nextAction: NextActionProjection;
  risk: CaseRiskProjection;
  lastActivityAt: Date;
  ceremonyAt: Date | null;
  nextMeetingAt: Date | null;
  firstMeetingId: number | null;
  cobrowseCode: string | null;
  publishedQuote: {
    versionId: number;
    totalKopecks: number;
  } | null;
  payment: {
    totalKopecks: number | null;
    paidKopecks: number;
    balanceKopecks: number | null;
  };
  documents: {
    uploaded: number;
    required: number;
    verified: number;
    ready: boolean;
  };
  openTaskCount: number;
  overdueTaskCount: number;
  quoteVersionCount: number;
};

export async function getCanonicalCases(scope: number | OperationalContext, now = new Date()): Promise<CanonicalCaseReadModel[]> {
  const where = caseScope(scope);
  if (!where) return [];
  const records = await prisma.case.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 400,
    include: caseReadInclude,
  });
  return records.map((record) => toReadModel(record, now));
}

export async function getCanonicalCase(scope: number | OperationalContext, leadId: number, now = new Date()): Promise<CanonicalCaseReadModel | null> {
  const where = caseScope(scope);
  if (!where) return null;
  const record = await prisma.case.findFirst({
    where: { ...where, leadId },
    include: caseReadInclude,
  });
  return record ? toReadModel(record, now) : null;
}

const caseReadInclude = Prisma.validator<Prisma.CaseInclude>()({
  publishedQuoteVersion: { select: { id: true, total: true } },
  events: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
  tasks: {
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, dueAt: true, completedAt: true, createdAt: true },
  },
  lead: {
    include: {
      documents: { orderBy: { createdAt: "desc" }, select: { category: true, createdAt: true } },
      notes: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      payments: { orderBy: { paidAt: "desc" }, select: { amountKopecks: true, paidAt: true } },
      meetings: {
        orderBy: { scheduledAt: "desc" },
        select: {
          id: true,
          scheduledAt: true,
          startedAt: true,
          endedAt: true,
          cobrowseCode: true,
          quotes: { select: { versions: { select: { id: true } } } },
          orders: { select: { status: true, totalAmount: true } },
        },
      },
    },
  },
});

type CaseRecord = Prisma.CaseGetPayload<{ include: typeof caseReadInclude }>;

function toReadModel(record: CaseRecord, now: Date): CanonicalCaseReadModel {
  const guardState = normalizeGuardState(record.guardState);
  const openTasks = record.tasks.filter((task) => task.status === "OPEN");
  const overdueTaskCount = openTasks.filter((task) => task.dueAt && task.dueAt < now).length;
  const nextOpenTaskDueAt = openTasks
    .map((task) => task.dueAt)
    .filter((dueAt): dueAt is Date => dueAt instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const futureMeetings = record.lead.meetings
    .map((meeting) => meeting.scheduledAt)
    .filter((date): date is Date => date instanceof Date && date >= now)
    .sort((a, b) => a.getTime() - b.getTime());
  const quoteVersionCount = record.lead.meetings.reduce(
    (total, meeting) => total + meeting.quotes.reduce((sum, quote) => sum + quote.versions.length, 0),
    0,
  );
  const paidKopecks = record.lead.payments.reduce((sum, payment) => sum + payment.amountKopecks, 0);
  const totalKopecks = record.publishedQuoteVersion?.total ?? null;
  const requiredGuards = isSupportedScenario(record.scenarioId) ? SCENARIO_CLOSURE_GUARDS[record.scenarioId] : [];
  const requiredDocumentGuards = requiredGuards.filter((guard) => guard.includes("document") || guard.includes("identity") || guard.includes("authorization") || guard.includes("entitlement") || guard.includes("relationship"));
  const verifiedDocumentCount = requiredDocumentGuards.filter((guard) => guardState[guard]).length;
  const facts: CanonicalCaseFacts = {
    updatedAt: record.updatedAt,
    ceremonyAt: record.lead.ceremonyAt,
    nextOpenTaskDueAt,
    openTaskCount: openTasks.length,
    overdueTaskCount,
    meetingsCount: record.lead.meetings.length,
    quoteVersionCount,
    publishedQuoteVersionId: record.publishedQuoteVersionId,
    clientTotalKopecks: totalKopecks,
    paidKopecks,
    uploadedDocumentCount: record.lead.documents.length,
    requiredDocumentCount: requiredDocumentGuards.length,
    guardState,
  };
  const nextAction = projectNextAction({ stage: record.stage, ownerId: record.ownerId, facts });
  const risk = projectCaseRisk({ stage: record.stage, scenarioId: record.scenarioId, nextAction, facts, now });
  const lastActivityAt = latestDate(
    record.createdAt,
    record.updatedAt,
    record.events[0]?.createdAt,
    record.lead.documents[0]?.createdAt,
    record.tasks[0]?.createdAt,
    record.lead.notes[0]?.createdAt,
    record.lead.payments[0]?.paidAt,
    ...record.lead.meetings.flatMap((meeting) => [meeting.scheduledAt, meeting.startedAt, meeting.endedAt]),
  );
  const presentation = stagePresentation(record.stage);

  return {
    caseId: record.id,
    publicRef: record.publicRef,
    leadId: record.leadId,
    tenantId: record.tenantId,
    ownerId: record.ownerId,
    name: record.lead.name,
    phone: record.lead.phone,
    source: record.lead.source,
    stage: record.stage,
    legacyStage: presentation.legacyStage,
    scenarioId: record.scenarioId,
    version: record.version,
    statusLabel: presentation.label,
    statusTone: presentation.tone,
    waiting: presentation.waiting,
    nextAction,
    risk,
    lastActivityAt,
    ceremonyAt: record.lead.ceremonyAt,
    nextMeetingAt: futureMeetings[0] ?? null,
    firstMeetingId: record.lead.meetings.at(-1)?.id ?? null,
    cobrowseCode: record.lead.meetings.find((meeting) => meeting.cobrowseCode)?.cobrowseCode ?? null,
    publishedQuote: record.publishedQuoteVersion
      ? { versionId: record.publishedQuoteVersion.id, totalKopecks: record.publishedQuoteVersion.total }
      : null,
    payment: {
      totalKopecks,
      paidKopecks,
      balanceKopecks: totalKopecks == null ? null : Math.max(0, totalKopecks - paidKopecks),
    },
    documents: {
      uploaded: record.lead.documents.length,
      required: requiredDocumentGuards.length,
      verified: verifiedDocumentCount,
      ready: requiredDocumentGuards.length > 0 && verifiedDocumentCount === requiredDocumentGuards.length,
    },
    openTaskCount: openTasks.length,
    overdueTaskCount,
    quoteVersionCount,
  };
}

function caseScope(scope: number | OperationalContext): Prisma.CaseWhereInput | null {
  if (typeof scope === "number") {
    return scope > 0 ? { tenantId: tenantIdForAgent(scope), ownerId: scope } : null;
  }
  if (scope.agentId <= 0) return null;
  return {
    tenantId: scope.organizationId,
    ...(scope.role === "ADMIN" || scope.role === "MANAGER"
      ? {}
      : {
          OR: [
            { ownerId: scope.agentId },
            { tasks: { some: { assigneeMembershipId: scope.membershipId } } },
          ],
        }),
  };
}

function stagePresentation(stage: CaseStage): { label: string; tone: StatusTone; waiting: WaitingOn; legacyStage: Stage } {
  switch (stage) {
    case "INTAKE": return { label: "Новый кейс", tone: "neutral", waiting: "info", legacyStage: "Лид" };
    case "PLANNING": return { label: "Планирование", tone: "neutral", waiting: "info", legacyStage: "Документы" };
    case "QUOTING": return { label: "Смета в работе", tone: "info", waiting: null, legacyStage: "Смета" };
    case "AGREEMENT": return { label: "Смета опубликована", tone: "info", waiting: "client", legacyStage: "Смета" };
    case "CONTRACTING": return { label: "Оформление договора", tone: "accent", waiting: null, legacyStage: "Договор" };
    case "PAYMENT": return { label: "Ожидаем оплату", tone: "warning", waiting: "payment", legacyStage: "Оплата" };
    case "EXECUTION": return { label: "Исполнение", tone: "accent", waiting: null, legacyStage: "Оплата" };
    case "CLOSED": return { label: "Кейс завершён", tone: "success", waiting: null, legacyStage: "Завершено" };
  }
}

function normalizeGuardState(value: Prisma.JsonValue): CaseGuardState {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

function latestDate(...values: Array<Date | null | undefined>): Date {
  const dates = values.filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}
