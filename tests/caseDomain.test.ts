import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASE_TRANSITION_MATRIX,
  SCENARIO_CLOSURE_GUARDS,
  CaseDomainError,
  evaluateCaseTransition,
  projectCaseRisk,
  projectNextAction,
  type CanonicalCaseFacts,
  type CaseScenarioValue,
  type CaseTransitionFacts,
} from "../lib/caseDomain";

const transitionFacts: CaseTransitionFacts = {
  intakeComplete: true,
  availableQuoteVersionIds: [17],
  publishedQuoteVersionId: 17,
  contractSigned: true,
  paymentSatisfied: true,
  guardState: {},
};

test("Week 2: every allowed Case transition has executable guard coverage", () => {
  for (const rule of CASE_TRANSITION_MATRIX) {
    const scenarioId: CaseScenarioValue = rule.from === "PLANNING" ? "UNSELECTED" : "CREMATION_V1";
    const facts = {
      ...transitionFacts,
      guardState: Object.fromEntries(SCENARIO_CLOSURE_GUARDS.CREMATION_V1.map((guard) => [guard, true])),
    };
    const result = evaluateCaseTransition({
      stage: rule.from,
      scenarioId,
      eventType: rule.eventType,
      payload: rule.eventType === "scenario.selected.v1"
        ? { scenarioId: "CREMATION_V1" }
        : rule.eventType === "quote.published.v1"
            || rule.eventType === "quote.republished.v1"
            || rule.eventType === "quote.accepted.v1"
          ? { quoteVersionId: 17 }
          : {},
      facts,
    });
    assert.equal(result.toStage, rule.to);
  }
});

test("AC-W2-01: direct INTAKE to payment/paid transition is rejected", () => {
  assert.throws(
    () => evaluateCaseTransition({
      stage: "INTAKE",
      scenarioId: "UNSELECTED",
      eventType: "payment.requirement_satisfied.v1",
      payload: {},
      facts: transitionFacts,
    }),
    (error: unknown) => error instanceof CaseDomainError && error.code === "INVALID_TRANSITION",
  );
});

test("Week 2: both pilot closure policies reject their exact missing guard", () => {
  for (const scenarioId of ["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"] as const) {
    const required = SCENARIO_CLOSURE_GUARDS[scenarioId];
    const guardState = Object.fromEntries(required.map((guard) => [guard, true]));
    guardState[required[0]] = false;
    assert.throws(
      () => evaluateCaseTransition({
        stage: "EXECUTION",
        scenarioId,
        eventType: "case.closure_requested.v1",
        payload: {},
        facts: { ...transitionFacts, guardState },
      }),
      (error: unknown) => error instanceof CaseDomainError
        && error.code === "GUARD_FAILED"
        && Array.isArray(error.details.missing)
        && error.details.missing.includes(required[0]),
    );
  }
});

test("AC-W2-05: risk projection gives exact reason and deadline", () => {
  const updatedAt = new Date("2026-07-01T09:00:00.000Z");
  const dueAt = new Date("2026-07-13T09:00:00.000Z");
  const ceremonyAt = new Date("2026-07-14T20:00:00.000Z");
  const facts: CanonicalCaseFacts = {
    updatedAt,
    ceremonyAt,
    nextOpenTaskDueAt: dueAt,
    openTaskCount: 1,
    overdueTaskCount: 1,
    meetingsCount: 1,
    quoteVersionCount: 0,
    publishedQuoteVersionId: null,
    clientTotalKopecks: null,
    paidKopecks: 0,
    uploadedDocumentCount: 0,
    requiredDocumentCount: 0,
    guardState: {},
  };
  const nextAction = projectNextAction({ stage: "QUOTING", ownerId: 9, facts });
  const risk = projectCaseRisk({
    stage: "QUOTING",
    scenarioId: "CREMATION_V1",
    nextAction,
    facts,
    now: new Date("2026-07-14T09:00:00.000Z"),
  });
  const quoteDeadline = new Date("2026-07-12T20:00:00.000Z");
  assert.equal(nextAction.ownerId, 9);
  assert.equal(nextAction.dueAt?.toISOString(), quoteDeadline.toISOString());
  assert.ok(risk.reasons.some((reason) => reason.code === "OVERDUE_ACTION" && reason.deadline?.toISOString() === quoteDeadline.toISOString()));
  assert.ok(risk.reasons.some((reason) => reason.code === "CEREMONY_PROXIMITY" && reason.deadline?.toISOString() === ceremonyAt.toISOString()));
  assert.ok(risk.reasons.some((reason) => reason.code === "MISSING_BLOCKER" && reason.label === "Нет сохранённой версии сметы"));
});
