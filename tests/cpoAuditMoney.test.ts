import test from "node:test";
import assert from "node:assert/strict";
import { deriveLedgerSummary, type LedgerProjectionEntry } from "../lib/m3Domain";

const obligation: LedgerProjectionEntry = { id: "obligation", type: "OBLIGATION", direction: "DEBIT", amountKopecks: 17_600_000, effective: true };
const payment = (amountKopecks: number, id = "payment"): LedgerProjectionEntry => ({ id, type: "PAYMENT", direction: "CREDIT", amountKopecks, effective: true });
const refund = (amountKopecks: number): LedgerProjectionEntry => ({ id: "refund", type: "REFUND", direction: "DEBIT", amountKopecks, relatedEntryId: "payment", effective: true });

test("CPO-01: returning overpayment preserves PAID and the refund history", () => {
  const summary = deriveLedgerSummary([obligation, payment(20_000_000), refund(2_400_000)], "RUB");
  assert.equal(summary.status, "PAID");
  assert.equal(summary.balanceKopecks, 0);
  assert.equal(summary.paidKopecks, 17_600_000);
  assert.equal(summary.refundedKopecks, 2_400_000);
});

test("CPO-01: repayment after refund satisfies the same immutable obligation", () => {
  const summary = deriveLedgerSummary([obligation, payment(17_600_000), refund(8_800_000), payment(8_800_000, "repayment")], "RUB");
  assert.equal(summary.status, "PAID");
  assert.equal(summary.balanceKopecks, 0);
  assert.equal(summary.refundedKopecks, 8_800_000);
});

test("CPO-01: actual outstanding debt and full refund remain visible", () => {
  const partial = deriveLedgerSummary([obligation, payment(17_600_000), refund(8_800_000)], "RUB");
  assert.equal(partial.status, "PARTIALLY_REFUNDED");
  assert.equal(partial.balanceKopecks, 8_800_000);
  const full = deriveLedgerSummary([obligation, payment(17_600_000), refund(17_600_000)], "RUB");
  assert.equal(full.status, "REFUNDED");
  assert.equal(full.balanceKopecks, 17_600_000);
});

test("CPO-01: pending reversal is ineffective and an approved reversal preserves original history", () => {
  const entries = [obligation, payment(17_600_000), refund(8_800_000)];
  const reversal: LedgerProjectionEntry = { id: "reversal", type: "REVERSAL", direction: "CREDIT", amountKopecks: 8_800_000, relatedEntryId: "refund", effective: false };
  assert.equal(deriveLedgerSummary([...entries, reversal], "RUB").balanceKopecks, 8_800_000);
  const summary = deriveLedgerSummary([...entries, { ...reversal, effective: true }], "RUB");
  assert.equal(summary.status, "PAID");
  assert.equal(summary.refundedKopecks, 0);
  assert.equal(entries.length, 3);
});

test("CPO-01: absent obligation never becomes a known zero balance", () => {
  const summary = deriveLedgerSummary([payment(17_600_000)], "RUB");
  assert.equal(summary.state, "LEGACY_INCOMPLETE");
  assert.equal(summary.balanceKopecks, null);
});
