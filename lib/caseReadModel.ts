import { type CaseScenario, type CaseStage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  projectCaseRisk,
  projectNextAction,
  type CanonicalCaseFacts,
  type CaseGuardState,
  type CaseRiskProjection,
  type NextActionProjection,
} from "@/lib/caseDomain";
import { tenantIdForAgent } from "@/lib/caseService";
import { deriveCaseDocumentTruth, deriveLedgerSummary } from "@/lib/m3Domain";
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
  guardState: CaseGuardState;
  statusLabel: string;
  statusTone: StatusTone;
  waiting: WaitingOn;
  nextAction: NextActionProjection;
  risk: CaseRiskProjection;
  lastActivityAt: Date;
  ceremonyAt: Date | null;
  nextMeetingAt: Date | null;
  firstMeetingId: number | null;
  publishedQuote: {
    versionId: number;
    totalKopecks: number;
  } | null;
  payment: {
    totalKopecks: number | null;
    paidKopecks: number | null;
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
  documentRequirements: {
    select: {
      stableKey: true,
      blockingStage: true,
      isApplicable: true,
      createdAt: true,
      updatedAt: true,
      policy: { select: { status: true } },
      document: {
        select: {
          versions: {
            select: {
              versionNumber: true,
              status: true,
              scanStatus: true,
              expiresAt: true,
              createdAt: true,
            },
          },
        },
      },
    },
  },
  contract: {
    select: {
      versions: {
        select: {
          status: true,
          validUntil: true,
          quoteVersionId: true,
          createdAt: true,
          supersededBy: { select: { id: true } },
          obligation: {
            select: {
              currency: true,
              createdAt: true,
              ledgerEntries: {
                select: {
                  id: true,
                  type: true,
                  direction: true,
                  amountKopecks: true,
                  relatedEntryId: true,
                  approvalRequired: true,
                  createdAt: true,
                  approval: { select: { decision: true } },
                },
              },
            },
          },
        },
      },
    },
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
  const documentTruth = deriveCaseDocumentTruth(record.documentRequirements
    .filter((requirement) => requirement.isApplicable && requirement.policy.status !== "DRAFT_POLICY")
    .map((requirement) => ({
      stableKey: requirement.stableKey,
      blockingStage: requirement.blockingStage,
      versions: requirement.document?.versions ?? [],
    })), now);
  const signedContract = record.contract?.versions.find((version) =>
    version.status === "SIGNED"
    && version.supersededBy == null
    && (version.validUntil == null || version.validUntil > now)
    && version.quoteVersionId === record.publishedQuoteVersionId,
  ) ?? null;
  const ledgerSummary = signedContract?.obligation
    ? deriveLedgerSummary(signedContract.obligation.ledgerEntries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        direction: entry.direction,
        amountKopecks: entry.amountKopecks,
        relatedEntryId: entry.relatedEntryId,
        effective: !entry.approvalRequired || entry.approval?.decision === "APPROVED",
      })), signedContract.obligation.currency)
    : null;
  const pendingFinancialAdjustments = signedContract?.obligation?.ledgerEntries.filter(
    (entry) => entry.approvalRequired && entry.approval?.decision == null,
  ).length ?? 0;
  Object.assign(guardState, documentTruth.guardState, {
    contract_signed: signedContract != null,
    payment_satisfied: pendingFinancialAdjustments === 0
      && (ledgerSummary?.status === "PAID" || ledgerSummary?.status === "OVERPAID"),
  });
  const totalKopecks = ledgerSummary?.obligationKopecks ?? null;
  const paidKopecks = ledgerSummary?.paidKopecks ?? null;
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
    uploadedDocumentCount: documentTruth.uploaded,
    requiredDocumentCount: documentTruth.required,
    guardState,
  };
  const nextAction = projectNextAction({ stage: record.stage, ownerId: record.ownerId, facts });
  const risk = projectCaseRisk({ stage: record.stage, scenarioId: record.scenarioId, nextAction, facts, now });
  const lastActivityAt = latestDate(
    record.createdAt,
    record.updatedAt,
    record.events[0]?.createdAt,
    ...record.documentRequirements.flatMap((requirement) => [
      requirement.createdAt,
      requirement.updatedAt,
      ...(requirement.document?.versions.map((version) => version.createdAt) ?? []),
    ]),
    ...(record.contract?.versions.flatMap((version) => [
      version.createdAt,
      version.obligation?.createdAt,
      ...(version.obligation?.ledgerEntries.map((entry) => entry.createdAt) ?? []),
    ]) ?? []),
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
    guardState,
    statusLabel: presentation.label,
    statusTone: presentation.tone,
    waiting: presentation.waiting,
    nextAction,
    risk,
    lastActivityAt,
    ceremonyAt: record.lead.ceremonyAt,
    nextMeetingAt: futureMeetings[0] ?? null,
    firstMeetingId: record.lead.meetings.at(-1)?.id ?? null,
    publishedQuote: record.publishedQuoteVersion
      ? { versionId: record.publishedQuoteVersion.id, totalKopecks: record.publishedQuoteVersion.total }
      : null,
    payment: {
      totalKopecks,
      paidKopecks,
      balanceKopecks: ledgerSummary?.balanceKopecks ?? null,
    },
    documents: {
      uploaded: documentTruth.uploaded,
      required: documentTruth.required,
      verified: documentTruth.verified,
      ready: documentTruth.ready,
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
      : { ownerId: scope.agentId }),
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
