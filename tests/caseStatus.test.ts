import assert from "node:assert/strict";
import test from "node:test";
import { countCasesWaitingOnPayment, isCaseInWorklist, isCaseStageConfirmed } from "../lib/caseStatus";
import { isCurrentPublishedVersion, quoteRegistryStatus } from "../lib/quotePublicationTruth";

test("payment count is independent of the case priority bucket", () => {
  const cases = [
    { waiting: "payment", bucket: "critical", paymentBalanceKopecks: null },
    { waiting: "payment", bucket: "awaitPayment", paymentBalanceKopecks: 88_000_00 },
    { waiting: "client", bucket: "critical", paymentBalanceKopecks: null },
    { waiting: null, bucket: "progress", paymentBalanceKopecks: 88_000_00 },
  ] as const;
  assert.equal(countCasesWaitingOnPayment(cases), 3);
});

test("passed route stages are not marked complete without canonical truth", () => {
  const incomplete = { documentsReady: false, publishedQuote: true, contractSigned: false, paymentSatisfied: false };
  assert.equal(isCaseStageConfirmed("Документы", incomplete), false);
  assert.equal(isCaseStageConfirmed("Смета", incomplete), true);
  assert.equal(isCaseStageConfirmed("Договор", incomplete), false);
  assert.equal(isCaseStageConfirmed("Оплата", incomplete), false);
});

test("closed cases with a reopened ledger balance return to the worklist", () => {
  assert.equal(isCaseInWorklist({ stage: "Завершено", paymentBalanceKopecks: 1 }), true);
  assert.equal(isCaseInWorklist({ stage: "Завершено", paymentBalanceKopecks: 0 }), false);
  assert.equal(isCaseInWorklist({ stage: "Оплата", paymentBalanceKopecks: null }), true);
});

test("legacy or expired quote pointers cannot claim published or agreed truth", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  const version = {
    state: "PUBLISHED", totalState: "KNOWN", total: 25_400_000, versionNumber: 1,
    snapshotChecksum: "a".repeat(64), validUntil: new Date("2026-09-24T12:00:00Z"),
  };
  assert.equal(isCurrentPublishedVersion(version, now), true);
  assert.equal(isCurrentPublishedVersion({ ...version, validUntil: now }, now), false);
  assert.equal(isCurrentPublishedVersion({ ...version, snapshotChecksum: null }, now), false);
  assert.equal(isCurrentPublishedVersion({ ...version, total: 0 }, now), false);
  assert.equal(isCurrentPublishedVersion({ ...version, state: "LEGACY_INCOMPLETE" }, now), false);
  assert.equal(quoteRegistryStatus({ hasCurrentPublished: false, hasDraft: false, lifecycleStatus: "ACCEPTED", latestDecision: null }), "Требует разбора");
  assert.equal(quoteRegistryStatus({ hasCurrentPublished: true, hasDraft: false, lifecycleStatus: "ACCEPTED", latestDecision: "ACCEPTED" }), "Согласована");
});
