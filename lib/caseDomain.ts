export const CASE_STAGES = [
  "INTAKE",
  "PLANNING",
  "QUOTING",
  "AGREEMENT",
  "CONTRACTING",
  "PAYMENT",
  "EXECUTION",
  "CLOSED",
] as const;

export type CaseStageValue = (typeof CASE_STAGES)[number];

export const CASE_SCENARIOS = [
  "UNSELECTED",
  "CREMATION_V1",
  "FAMILY_PLOT_BURIAL_V1",
] as const;

export type CaseScenarioValue = (typeof CASE_SCENARIOS)[number];
export type SupportedCaseScenario = Exclude<CaseScenarioValue, "UNSELECTED">;

export const CASE_TRANSITION_EVENTS = [
  "intake.completed.v1",
  "scenario.selected.v1",
  "quote.published.v1",
  "quote.republished.v1",
  "quote.accepted.v1",
  "contract.signed.v1",
  "payment.requirement_satisfied.v1",
  "case.closure_requested.v1",
] as const;

export type CaseTransitionEvent = (typeof CASE_TRANSITION_EVENTS)[number];

export type CaseTransitionPayload = {
  scenarioId?: SupportedCaseScenario;
  quoteVersionId?: number;
  [key: string]: unknown;
};

export type CaseGuardState = Record<string, boolean>;

export type CaseTransitionFacts = {
  intakeComplete: boolean;
  availableQuoteVersionIds: number[];
  publishedQuoteVersionId: number | null;
  contractSigned: boolean;
  paymentSatisfied: boolean;
  guardState: CaseGuardState;
};

type TransitionRule = {
  from: CaseStageValue;
  eventType: CaseTransitionEvent;
  to: CaseStageValue;
};

export const CASE_TRANSITION_MATRIX: readonly TransitionRule[] = [
  { from: "INTAKE", eventType: "intake.completed.v1", to: "PLANNING" },
  { from: "PLANNING", eventType: "scenario.selected.v1", to: "QUOTING" },
  { from: "QUOTING", eventType: "quote.published.v1", to: "AGREEMENT" },
  { from: "AGREEMENT", eventType: "quote.republished.v1", to: "AGREEMENT" },
  { from: "AGREEMENT", eventType: "quote.accepted.v1", to: "CONTRACTING" },
  { from: "CONTRACTING", eventType: "contract.signed.v1", to: "PAYMENT" },
  { from: "PAYMENT", eventType: "payment.requirement_satisfied.v1", to: "EXECUTION" },
  { from: "EXECUTION", eventType: "case.closure_requested.v1", to: "CLOSED" },
] as const;

export const SCENARIO_CLOSURE_GUARDS: Record<SupportedCaseScenario, readonly string[]> = {
  CREMATION_V1: [
    "identity_verified",
    "death_document_verified",
    "cremation_authorization_verified",
    "crematorium_confirmed",
    "contract_signed",
    "payment_satisfied",
  ],
  FAMILY_PLOT_BURIAL_V1: [
    "identity_verified",
    "death_document_verified",
    "plot_entitlement_verified",
    "relationship_verified",
    "cemetery_confirmed",
    "contract_signed",
    "payment_satisfied",
  ],
};

export class CaseDomainError extends Error {
  constructor(
    public readonly code: "INVALID_TRANSITION" | "GUARD_FAILED" | "UNSUPPORTED_SCENARIO" | "NOT_FOUND" | "FORBIDDEN" | "IDEMPOTENCY_CONFLICT",
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CaseDomainError";
  }
}

export type EvaluatedCaseTransition = {
  toStage: CaseStageValue;
  scenarioId?: SupportedCaseScenario;
  publishedQuoteVersionId?: number;
};

export function evaluateCaseTransition(input: {
  stage: CaseStageValue;
  scenarioId: CaseScenarioValue;
  eventType: CaseTransitionEvent;
  payload: CaseTransitionPayload;
  facts: CaseTransitionFacts;
}): EvaluatedCaseTransition {
  const rule = CASE_TRANSITION_MATRIX.find(
    (candidate) => candidate.from === input.stage && candidate.eventType === input.eventType,
  );
  if (!rule) {
    throw new CaseDomainError(
      "INVALID_TRANSITION",
      `Переход из ${input.stage} по событию ${input.eventType} запрещён`,
      { stage: input.stage, eventType: input.eventType },
    );
  }

  switch (input.eventType) {
    case "intake.completed.v1":
      requireGuard(input.facts.intakeComplete, "Заполните обязательные данные интейка", "intake_complete");
      break;
    case "scenario.selected.v1": {
      const scenarioId = input.payload.scenarioId;
      if (!scenarioId || !isSupportedScenario(scenarioId)) {
        throw new CaseDomainError("UNSUPPORTED_SCENARIO", "Выберите один из двух пилотных сценариев", {
          scenarioId: scenarioId ?? null,
        });
      }
      return { toStage: rule.to, scenarioId };
    }
    case "quote.published.v1":
    case "quote.republished.v1": {
      const quoteVersionId = input.payload.quoteVersionId;
      requireGuard(
        Number.isInteger(quoteVersionId) && input.facts.availableQuoteVersionIds.includes(quoteVersionId as number),
        "Версия сметы не принадлежит этому кейсу",
        "quote_version_owned",
      );
      return { toStage: rule.to, publishedQuoteVersionId: quoteVersionId as number };
    }
    case "quote.accepted.v1":
      requireGuard(
        Number.isInteger(input.payload.quoteVersionId) && input.payload.quoteVersionId === input.facts.publishedQuoteVersionId,
        "Согласовать можно только текущую опубликованную версию сметы",
        "current_published_quote_accepted",
      );
      break;
    case "contract.signed.v1":
      requireGuard(input.facts.contractSigned, "Подписанный договор не найден", "contract_signed");
      break;
    case "payment.requirement_satisfied.v1":
      requireGuard(input.facts.paymentSatisfied, "Требование по оплате ещё не выполнено", "payment_satisfied");
      break;
    case "case.closure_requested.v1": {
      if (!isSupportedScenario(input.scenarioId)) {
        throw new CaseDomainError("UNSUPPORTED_SCENARIO", "Кейс нельзя закрыть без пилотного сценария");
      }
      const missing = SCENARIO_CLOSURE_GUARDS[input.scenarioId].filter((guard) => !input.facts.guardState[guard]);
      if (missing.length > 0) {
        throw new CaseDomainError("GUARD_FAILED", "Кейс нельзя закрыть: не выполнены обязательные условия", { missing });
      }
      break;
    }
  }

  return { toStage: rule.to };
}

function requireGuard(condition: boolean, message: string, guard: string): asserts condition {
  if (!condition) throw new CaseDomainError("GUARD_FAILED", message, { guard });
}

export function isSupportedScenario(value: string): value is SupportedCaseScenario {
  return value === "CREMATION_V1" || value === "FAMILY_PLOT_BURIAL_V1";
}

export type CanonicalCaseFacts = {
  updatedAt: Date;
  ceremonyAt: Date | null;
  nextOpenTaskDueAt: Date | null;
  openTaskCount: number;
  overdueTaskCount: number;
  meetingsCount: number;
  quoteVersionCount: number;
  publishedQuoteVersionId: number | null;
  clientTotalKopecks: number | null;
  paidKopecks: number;
  uploadedDocumentCount: number;
  requiredDocumentCount: number;
  guardState: CaseGuardState;
};

export type NextActionProjection = {
  key: string;
  label: string;
  reason: string;
  dueAt: Date | null;
  ownerId: number;
};

export type CaseRiskReason = {
  code: "OVERDUE_ACTION" | "CEREMONY_PROXIMITY" | "MISSING_BLOCKER" | "SLA_STALE";
  label: string;
  deadline: Date | null;
  level: "MEDIUM" | "HIGH" | "CRITICAL";
};

export type CaseRiskProjection = {
  level: "NONE" | "MEDIUM" | "HIGH" | "CRITICAL";
  reasons: CaseRiskReason[];
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

export function projectNextAction(input: {
  stage: CaseStageValue;
  ownerId: number;
  facts: CanonicalCaseFacts;
}): NextActionProjection {
  const { stage, ownerId, facts } = input;
  const fallback = addMs(facts.updatedAt, stage === "PLANNING" ? 4 * HOUR : DAY);
  const ceremonyDeadline = facts.ceremonyAt ? addMs(facts.ceremonyAt, -deadlineLead(stage)) : null;
  const dueAt = earliestDate(facts.nextOpenTaskDueAt, ceremonyDeadline) ?? fallback;

  const byStage: Record<CaseStageValue, Omit<NextActionProjection, "dueAt" | "ownerId">> = {
    INTAKE: { key: "complete-intake", label: "Завершить интейк", reason: "Без вводных нельзя выбрать сценарий и начать планирование." },
    PLANNING: { key: "select-scenario", label: "Выбрать сценарий", reason: "Зафиксируйте кремацию или погребение в семейное/родственное захоронение." },
    QUOTING: { key: "publish-quote", label: "Подготовить и опубликовать смету", reason: "Клиент должен получить одну зафиксированную версию." },
    AGREEMENT: { key: "record-decision", label: "Получить решение клиента", reason: "Нужно зафиксировать согласие с текущей опубликованной сметой." },
    CONTRACTING: { key: "sign-contract", label: "Оформить договор", reason: "Договор должен быть связан с согласованной версией сметы." },
    PAYMENT: { key: "satisfy-payment", label: "Закрыть требование по оплате", reason: "До исполнения нужно подтвердить требуемый платёж." },
    EXECUTION: { key: "complete-guards", label: "Проверить готовность к закрытию", reason: "Закройте сценарные, документальные и операционные блокеры." },
    CLOSED: { key: "case-closed", label: "Кейс закрыт", reason: "Итог зафиксирован в истории событий." },
  };

  return { ...byStage[stage], dueAt: stage === "CLOSED" ? null : dueAt, ownerId };
}

export function projectCaseRisk(input: {
  stage: CaseStageValue;
  scenarioId: CaseScenarioValue;
  nextAction: NextActionProjection;
  facts: CanonicalCaseFacts;
  now: Date;
}): CaseRiskProjection {
  if (input.stage === "CLOSED") return { level: "NONE", reasons: [] };
  const reasons: CaseRiskReason[] = [];
  const { now, facts, nextAction } = input;

  if (nextAction.dueAt && nextAction.dueAt.getTime() < now.getTime()) {
    reasons.push({ code: "OVERDUE_ACTION", label: `Просрочено: ${nextAction.label}`, deadline: nextAction.dueAt, level: "CRITICAL" });
  }

  if (facts.ceremonyAt) {
    const hours = (facts.ceremonyAt.getTime() - now.getTime()) / HOUR;
    if (hours >= 0 && hours <= 24) {
      reasons.push({ code: "CEREMONY_PROXIMITY", label: "До церемонии меньше 24 часов", deadline: facts.ceremonyAt, level: "CRITICAL" });
    } else if (hours > 24 && hours <= 48) {
      reasons.push({ code: "CEREMONY_PROXIMITY", label: "До церемонии меньше 48 часов", deadline: facts.ceremonyAt, level: "HIGH" });
    }
  }

  const blocker = missingBlocker(input.stage, input.scenarioId, facts);
  if (blocker) reasons.push({ code: "MISSING_BLOCKER", label: blocker, deadline: nextAction.dueAt, level: "HIGH" });

  const staleDays = (now.getTime() - facts.updatedAt.getTime()) / DAY;
  if (staleDays > 7 && !reasons.some((reason) => reason.code === "OVERDUE_ACTION")) {
    reasons.push({ code: "SLA_STALE", label: "Нет подтверждённого движения больше 7 дней", deadline: nextAction.dueAt, level: "HIGH" });
  }

  const rank = { NONE: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
  const level = reasons.reduce<CaseRiskProjection["level"]>(
    (current, reason) => (rank[reason.level] > rank[current] ? reason.level : current),
    "NONE",
  );
  return { level, reasons };
}

function missingBlocker(stage: CaseStageValue, scenarioId: CaseScenarioValue, facts: CanonicalCaseFacts): string | null {
  if (stage === "INTAKE") return null;
  if (stage === "PLANNING" && scenarioId === "UNSELECTED") return "Не выбран пилотный сценарий";
  if (stage === "QUOTING" && facts.quoteVersionCount === 0) return "Нет сохранённой версии сметы";
  if (stage === "AGREEMENT" && !facts.publishedQuoteVersionId) return "Нет опубликованной версии сметы";
  if (stage === "EXECUTION" && isSupportedScenario(scenarioId)) {
    const missing = SCENARIO_CLOSURE_GUARDS[scenarioId].filter((guard) => !facts.guardState[guard]);
    return missing.length ? `Не выполнено условий закрытия: ${missing.length}` : null;
  }
  return null;
}

function deadlineLead(stage: CaseStageValue): number {
  if (stage === "QUOTING") return 48 * HOUR;
  if (stage === "AGREEMENT" || stage === "CONTRACTING") return 36 * HOUR;
  if (stage === "PAYMENT") return 24 * HOUR;
  return 12 * HOUR;
}

function addMs(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function earliestDate(...dates: Array<Date | null>): Date | null {
  const valid = dates.filter((date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()));
  return valid.length ? new Date(Math.min(...valid.map((date) => date.getTime()))) : null;
}
