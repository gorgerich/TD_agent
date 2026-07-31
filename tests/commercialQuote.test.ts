import assert from "node:assert/strict";
import test from "node:test";
import {
  CommercialQuoteError,
  assertPublishable,
  calculateCommercialTotals,
  quoteSnapshotChecksum,
  diffCommercialLines,
  type CommercialLine,
  type PublishedQuoteSnapshot,
} from "../lib/commercialQuote";
import { handleApiError } from "../lib/apiAuth";

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
