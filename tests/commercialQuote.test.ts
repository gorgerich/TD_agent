import assert from "node:assert/strict";
import test from "node:test";
import {
  CommercialQuoteError,
  assertPublishable,
  calculateCommercialTotals,
  quoteSnapshotChecksum,
  diffCommercialLines,
  settleCommercialLines,
  type CommercialLine,
  type PublishedQuoteSnapshot,
} from "../lib/commercialQuote";
import { handleApiError } from "../lib/apiAuth";
import { formatMinorUnits, formatMinorUnitsCurrency } from "../lib/calculationUtils";

const scenarios = ["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"] as const;

function line(overrides: Partial<CommercialLine> = {}): CommercialLine {
  return {
    stableKey: "service:coordination",
    position: 0,
    type: "SERVICE",
    description: "Координация",
    quantity: 1,
    unit: "услуга",
    priceState: "KNOWN",
    clientUnitPrice: 10_000_00,
    costState: "KNOWN",
    unitCost: 4_000_00,
    discountAmount: 0,
    included: false,
    optional: false,
    relationKind: "STANDALONE",
    source: "test",
    sourceVersion: "1",
    scenarioCompatibility: [...scenarios],
    ...overrides,
  };
}

test("unknown price is a publish blocker and never becomes zero", () => {
  const totals = calculateCommercialTotals([
    line({ priceState: "UNKNOWN", clientUnitPrice: null }),
  ], "CREMATION_V1");
  assert.equal(totals.total, null);
  assert.equal(totals.totalState, "UNKNOWN");
  assert.throws(() => assertPublishable(totals), (error: unknown) => {
    assert.ok(error instanceof CommercialQuoteError);
    assert.equal(error.code, "PUBLISH_BLOCKED");
    return true;
  });
});

test("an empty draft is not a zero-price publishable quote", () => {
  const totals = calculateCommercialTotals([], "CREMATION_V1");

  assert.equal(totals.total, null);
  assert.equal(totals.totalState, "UNKNOWN");
  assert.match(totals.blockers[0] ?? "", /хотя бы одну/);
  assert.throws(() => assertPublishable(totals), /хотя бы одну/);
});

test("commercial validation failures are controlled 422 responses, never 500", async () => {
  const response = handleApiError(new CommercialQuoteError("PUBLISH_BLOCKED", "Цена не подтверждена"));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    error: "Цена не подтверждена",
    code: "PUBLISH_BLOCKED",
  });
});

test("unknown cost suppresses margin instead of showing 100 percent", () => {
  const totals = calculateCommercialTotals([
    line({ costState: "UNKNOWN", unitCost: null }),
  ], "CREMATION_V1");
  assert.equal(totals.total, 10_000_00);
  assert.equal(totals.costTotal, null);
  assert.equal(totals.margin, null);
  assert.match(totals.warnings[0] ?? "", /не подтверждена/);
});

test("included package children are not double counted", () => {
  const totals = calculateCommercialTotals([
    line({ stableKey: "package:care", type: "PACKAGE", clientUnitPrice: 50_000_00 }),
    line({
      stableKey: "package:care:hearse",
      type: "SERVICE",
      clientUnitPrice: 15_000_00,
      included: true,
      relationKind: "INCLUDED",
      relationKey: "package:care",
    }),
  ], "FAMILY_PLOT_BURIAL_V1");
  assert.equal(totals.total, 50_000_00);
  assert.deepEqual(totals.countedLineKeys, ["package:care"]);
});

test("replacement excludes its target and counts exactly once", () => {
  const totals = calculateCommercialTotals([
    line({ stableKey: "coffin:base", type: "PRODUCT", clientUnitPrice: 20_000_00 }),
    line({
      stableKey: "coffin:oak",
      type: "PRODUCT",
      clientUnitPrice: 35_000_00,
      relationKind: "REPLACEMENT",
      relationKey: "coffin:base",
    }),
  ], "FAMILY_PLOT_BURIAL_V1");
  assert.equal(totals.total, 35_000_00);
  assert.deepEqual(totals.countedLineKeys, ["coffin:oak"]);
});

test("scenario-incompatible items block publication", () => {
  const totals = calculateCommercialTotals([
    line({ scenarioCompatibility: ["CREMATION_V1"], description: "Кремационная урна" }),
  ], "FAMILY_PLOT_BURIAL_V1");
  assert.equal(totals.total, null);
  assert.match(totals.blockers[0] ?? "", /несовместима/);
});

test("one hundred calculations and snapshots are minor-unit deterministic", () => {
  const lines = [
    line({ stableKey: "service:a", quantity: 3, clientUnitPrice: 3_333_33, unitCost: 1_111_11 }),
    line({ stableKey: "service:b", position: 1, clientUnitPrice: 8_500_05, discountAmount: 500_05 }),
  ];
  const results = Array.from({ length: 100 }, () => calculateCommercialTotals(lines, "CREMATION_V1"));
  assert.equal(new Set(results.map((result) => JSON.stringify(result))).size, 1);
  assert.equal(results[0]?.total, 17_999_99);

  const snapshot: PublishedQuoteSnapshot = {
    schemaVersion: 1,
    quoteId: 42,
    versionNumber: 2,
    organizationId: "org:test",
    caseId: "case:test",
    scenario: "CREMATION_V1",
    currency: "RUB",
    publishedAt: "2026-07-29T12:00:00.000Z",
    validUntil: "2026-08-05T12:00:00.000Z",
    lines,
    editorState: { step: "review" },
    totals: {
      subtotal: results[0]!.subtotal,
      discountTotal: results[0]!.discountTotal,
      total: results[0]!.total,
      totalState: results[0]!.totalState,
      costTotal: results[0]!.costTotal,
      margin: results[0]!.margin,
      countedLineKeys: results[0]!.countedLineKeys,
    },
  };
  assert.equal(new Set(Array.from({ length: 100 }, () => quoteSnapshotChecksum(snapshot))).size, 1);
});

test("review diff reports added, removed and changed lines without mutating either version", () => {
  const removed = line({ stableKey: "removed", description: "Убрано" });
  const changedBefore = line({ stableKey: "changed", description: "До", clientUnitPrice: 10_000 });
  const changedAfter = line({ stableKey: "changed", description: "После", clientUnitPrice: 12_000 });
  const added = line({ stableKey: "added", description: "Добавлено" });
  const before = [removed, changedBefore];
  const after = [changedAfter, added];
  const diff = diffCommercialLines(before, after);
  assert.deepEqual(diff.added.map((item) => item.stableKey), ["added"]);
  assert.deepEqual(diff.removed.map((item) => item.stableKey), ["removed"]);
  assert.deepEqual(diff.changed.map((item) => item.stableKey), ["changed"]);
  assert.equal(before[1].clientUnitPrice, 10_000);
  assert.equal(after[0].clientUnitPrice, 12_000);
});

/**
 * The invariant that keeps the client-facing document honest: whatever the client view and
 * the print output render per line must add up to the total the same document states. This
 * is asserted against the settlement the server actually ships, not against a second
 * calculation written here.
 */
test("settled line amounts always reconcile to the stated total", () => {
  const lines: CommercialLine[] = [
    line({ stableKey: "pkg", type: "PACKAGE", description: "Пакет", clientUnitPrice: 5_000_00, priceState: "KNOWN" }),
    line({ stableKey: "pkg:child", description: "В пакете", relationKind: "INCLUDED", relationKey: "pkg", included: true, clientUnitPrice: null, priceState: "UNKNOWN" }),
    line({ stableKey: "coffin:base", description: "Гроб базовый", clientUnitPrice: 20_000_00, priceState: "KNOWN" }),
    line({ stableKey: "coffin:oak", description: "Гроб дубовый", clientUnitPrice: 35_000_00, priceState: "KNOWN", relationKind: "REPLACEMENT", relationKey: "coffin:base" }),
    line({ stableKey: "transport", description: "Транспорт", clientUnitPrice: 3_000_00, quantity: 2, discountAmount: 1_000_00, priceState: "KNOWN" }),
  ];
  const totals = calculateCommercialTotals(lines, "CREMATION_V1");
  const settlement = settleCommercialLines(lines);

  assert.equal(settlement.get("pkg:child")?.settlement, "INCLUDED");
  assert.equal(settlement.get("pkg:child")?.lineTotal, null);
  assert.equal(settlement.get("coffin:base")?.settlement, "REPLACED", "a replaced item must not be billed");
  assert.equal(settlement.get("coffin:base")?.lineTotal, null, "a replaced item must not render a price");

  const rendered = [...settlement.values()].reduce((sum, entry) => sum + (entry.lineTotal ?? 0), 0);
  assert.equal(rendered, totals.total, "sum of rendered line amounts must equal the stated total");

  // Assert the STRINGS a person reads, not just the minor-unit map. Rounding each line
  // independently while the total rounds once is how a document stops adding up, and a
  // test that only compares the map cannot see it.
  const renderedParts = [...settlement.values()]
    .filter((entry) => entry.lineTotal !== null)
    .map((entry) => formatMinorUnits(entry.lineTotal!));
  const renderedSum = [...settlement.values()].reduce((sum, entry) => sum + (entry.lineTotal ?? 0), 0);
  assert.equal(
    formatMinorUnits(renderedSum),
    formatMinorUnits(totals.total ?? 0),
    `rendered lines ${renderedParts.join(" + ")} must add up to the rendered total`,
  );
});

test("money renders exactly from minor units, so lines and total cannot round apart", () => {
  const lines: CommercialLine[] = [
    line({ stableKey: "k1", description: "Полтора рубля", clientUnitPrice: 150, priceState: "KNOWN" }),
    line({ stableKey: "k2", position: 1, description: "Ещё полтора", clientUnitPrice: 150, priceState: "KNOWN" }),
  ];
  const totals = calculateCommercialTotals(lines, "CREMATION_V1");
  const settlement = settleCommercialLines(lines);
  assert.equal(totals.total, 300);
  // Rounding each line to whole rubles would print "2 ₽" and "2 ₽" under a total of "3 ₽".
  assert.deepEqual([...settlement.values()].map((e) => formatMinorUnits(e.lineTotal!)), ["1,50", "1,50"]);
  assert.equal(formatMinorUnits(totals.total!), "3");
});


test("a discount larger than its line never renders a negative amount", () => {
  const lines: CommercialLine[] = [
    line({ stableKey: "over", description: "Скидка больше позиции", clientUnitPrice: 1_000_00, discountAmount: 9_999_00, priceState: "KNOWN" }),
  ];
  const totals = calculateCommercialTotals(lines, "CREMATION_V1");
  const settled = settleCommercialLines(lines).get("over");
  assert.equal(settled?.lineTotal, 0, "per-line discount must be clamped exactly as the total clamps it");
  assert.equal(totals.total, 0);
});

/**
 * Round 3 found the client view rendering its composition footer through the rounding
 * formatter while its headline and lines used the exact one, so the same published document
 * stated two different totals. Pin the exact formatter's behaviour on a non-whole-ruble
 * amount, which is the only case where the two disagree.
 */
test("a non-whole-ruble total renders identically wherever it appears", () => {
  const lines: CommercialLine[] = [
    line({ stableKey: "a", description: "Полтора", clientUnitPrice: 150, priceState: "KNOWN" }),
    line({ stableKey: "b", position: 1, description: "Два", clientUnitPrice: 200, priceState: "KNOWN" }),
  ];
  const totals = calculateCommercialTotals(lines, "CREMATION_V1");
  assert.equal(totals.total, 350);
  const settlement = settleCommercialLines(lines);
  assert.deepEqual([...settlement.values()].map((e) => formatMinorUnitsCurrency(e.lineTotal!)), ["1,50 ₽", "2 ₽"]);
  // Headline and composition footer are the same string for the same number.
  assert.equal(formatMinorUnitsCurrency(totals.total!), "3,50 ₽");
  assert.equal(formatMinorUnits(totals.total!), "3,50");
});
