import { createHash } from "node:crypto";

export type CommercialScenario = "CREMATION_V1" | "FAMILY_PLOT_BURIAL_V1";
export type CommercialValueState = "KNOWN" | "UNKNOWN" | "REQUESTED" | "EXPIRED";
export type CommercialLineType =
  | "SERVICE"
  | "PRODUCT"
  | "PACKAGE"
  | "ADD_ON"
  | "EXTERNAL_EXPENSE"
  | "MEMORIAL";
export type CommercialLineRelation = "STANDALONE" | "INCLUDED" | "ADD_ON" | "REPLACEMENT";

export type CommercialLine = {
  stableKey: string;
  position: number;
  type: CommercialLineType;
  catalogItemId?: string | null;
  catalogRevisionId?: string | null;
  serviceCode?: string | null;
  description: string;
  quantity: number;
  unit: string;
  priceState: CommercialValueState;
  clientUnitPrice: number | null;
  costState: CommercialValueState;
  unitCost: number | null;
  discountAmount: number;
  included: boolean;
  optional: boolean;
  relationKind: CommercialLineRelation;
  relationKey?: string | null;
  source: string;
  sourceVersion: string;
  scenarioCompatibility: CommercialScenario[];
};

export type CommercialTotals = {
  subtotal: number;
  discountTotal: number;
  total: number | null;
  totalState: CommercialValueState;
  costTotal: number | null;
  margin: number | null;
  blockers: string[];
  warnings: string[];
  countedLineKeys: string[];
};

/** How a line relates to the total the client is asked to pay. */
export type LineSettlement = "COUNTED" | "INCLUDED" | "REPLACED";

export type CommercialLineSettlement = {
  settlement: LineSettlement;
  /**
   * Exactly what this line contributes to the total, in minor units, or null when it
   * contributes nothing (included in a package, replaced by another line, or priced
   * UNKNOWN). Never a bare unit price: the discount is clamped here the same way the
   * total clamps it.
   */
  lineTotal: number | null;
};

/**
 * Single source of truth for which lines are billed and for how much.
 *
 * calculateCommercialTotals sums exactly these amounts, and the client view and print
 * output render exactly these amounts. Deriving the two separately is how a composition
 * ends up not adding up to its own total — a replacement target rendered at full price
 * while the total correctly excludes it, or a per-line discount larger than the line
 * showing as a negative row against a floored total.
 */
export function settleCommercialLines(
  lines: CommercialLine[],
  replacementTargets?: ReadonlySet<string>,
): Map<string, CommercialLineSettlement> {
  const targets = replacementTargets ?? new Set(
    lines.filter((line) => line.relationKind === "REPLACEMENT" && line.relationKey).map((line) => line.relationKey!),
  );
  const result = new Map<string, CommercialLineSettlement>();
  for (const line of lines) {
    if (line.included || line.relationKind === "INCLUDED") {
      result.set(line.stableKey, { settlement: "INCLUDED", lineTotal: null });
      continue;
    }
    if (targets.has(line.stableKey)) {
      result.set(line.stableKey, { settlement: "REPLACED", lineTotal: null });
      continue;
    }
    if (line.priceState !== "KNOWN" || line.clientUnitPrice === null) {
      result.set(line.stableKey, { settlement: "COUNTED", lineTotal: null });
      continue;
    }
    const lineSubtotal = assertMinorUnit(line.clientUnitPrice, `Цена «${line.description}»`) * line.quantity;
    const discount = assertMinorUnit(line.discountAmount, `Скидка «${line.description}»`);
    result.set(line.stableKey, {
      settlement: "COUNTED",
      lineTotal: lineSubtotal - Math.min(discount, lineSubtotal),
    });
  }
  return result;
}

export type PublishedQuoteSnapshot = {
  schemaVersion: 1;
  quoteId: number;
  versionNumber: number;
  organizationId: string;
  caseId: string;
  scenario: CommercialScenario;
  currency: "RUB";
  publishedAt: string;
  validUntil: string;
  lines: CommercialLine[];
  editorState: unknown;
  totals: Omit<CommercialTotals, "blockers" | "warnings">;
};

function assertMinorUnit(value: number | null, label: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new CommercialQuoteError("INVALID_MONEY", `${label}: требуется целое неотрицательное значение в копейках`);
  }
  return value;
}

export class CommercialQuoteError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CommercialQuoteError";
  }
}

export function calculateCommercialTotals(
  lines: CommercialLine[],
  scenario: CommercialScenario,
): CommercialTotals {
  const keys = new Set<string>();
  const lineByKey = new Map<string, CommercialLine>();
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    if (!line.stableKey || keys.has(line.stableKey)) {
      throw new CommercialQuoteError("DUPLICATE_LINE", "Позиции сметы должны иметь уникальные идентификаторы");
    }
    keys.add(line.stableKey);
    lineByKey.set(line.stableKey, line);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new CommercialQuoteError("INVALID_QUANTITY", `Некорректное количество: ${line.description}`);
    }
    if (!Number.isSafeInteger(line.discountAmount) || line.discountAmount < 0) {
      throw new CommercialQuoteError("INVALID_DISCOUNT", `Некорректная скидка: ${line.description}`);
    }
    if (!line.scenarioCompatibility.includes(scenario)) {
      blockers.push(`Позиция «${line.description}» несовместима с выбранным сценарием`);
    }
    if (line.priceState === "KNOWN") {
      assertMinorUnit(line.clientUnitPrice, `Цена «${line.description}»`);
    } else if (line.clientUnitPrice !== null) {
      throw new CommercialQuoteError("PRICE_STATE_MISMATCH", `Неизвестная цена «${line.description}» не может содержать сумму`);
    }
    if (line.costState === "KNOWN") {
      assertMinorUnit(line.unitCost, `Себестоимость «${line.description}»`);
    } else if (line.unitCost !== null) {
      throw new CommercialQuoteError("COST_STATE_MISMATCH", `Неизвестная себестоимость «${line.description}» не может содержать сумму`);
    }
  }

  const replacementTargets = new Set<string>();
  for (const line of lines) {
    if (line.relationKind === "REPLACEMENT") {
      if (!line.relationKey || !lineByKey.has(line.relationKey)) {
        throw new CommercialQuoteError("INVALID_REPLACEMENT", `Для «${line.description}» не найдена заменяемая позиция`);
      }
      replacementTargets.add(line.relationKey);
    }
    if (line.relationKind === "INCLUDED") {
      const parent = line.relationKey ? lineByKey.get(line.relationKey) : null;
      if (!parent || parent.type !== "PACKAGE") {
        throw new CommercialQuoteError("INVALID_PACKAGE_CHILD", `Включённая позиция «${line.description}» не связана с пакетом`);
      }
    }
  }

  const settlement = settleCommercialLines(lines, replacementTargets);
  const counted = lines.filter((line) => settlement.get(line.stableKey)?.settlement === "COUNTED");
  if (counted.length === 0) {
    blockers.push("Добавьте хотя бы одну оплачиваемую позицию");
  }
  let subtotal = 0;
  let discountTotal = 0;
  let costTotal = 0;
  let costComplete = true;

  for (const line of counted) {
    if (line.priceState !== "KNOWN") {
      blockers.push(`Цена позиции «${line.description}» не подтверждена`);
    } else {
      const lineSubtotal = assertMinorUnit(line.clientUnitPrice, `Цена «${line.description}»`) * line.quantity;
      if (!Number.isSafeInteger(lineSubtotal)) {
        throw new CommercialQuoteError("MONEY_OVERFLOW", "Сумма позиции выходит за безопасный денежный диапазон");
      }
      subtotal += lineSubtotal;
      discountTotal += Math.min(line.discountAmount, lineSubtotal);
    }

    if (line.costState !== "KNOWN") {
      costComplete = false;
      warnings.push(`Себестоимость позиции «${line.description}» не подтверждена`);
    } else {
      costTotal += assertMinorUnit(line.unitCost, `Себестоимость «${line.description}»`) * line.quantity;
    }
  }

  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(discountTotal) || !Number.isSafeInteger(costTotal)) {
    throw new CommercialQuoteError("MONEY_OVERFLOW", "Итог выходит за безопасный денежный диапазон");
  }

  const totalComplete = blockers.length === 0;
  const total = totalComplete ? Math.max(0, subtotal - discountTotal) : null;
  const resolvedCost = costComplete ? costTotal : null;

  return {
    subtotal,
    discountTotal,
    total,
    totalState: totalComplete ? "KNOWN" : "UNKNOWN",
    costTotal: resolvedCost,
    margin: total !== null && resolvedCost !== null ? total - resolvedCost : null,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    countedLineKeys: counted.map((line) => line.stableKey),
  };
}

export function assertPublishable(totals: CommercialTotals): asserts totals is CommercialTotals & { total: number } {
  if (totals.totalState !== "KNOWN" || totals.total === null || totals.blockers.length > 0) {
    throw new CommercialQuoteError("PUBLISH_BLOCKED", totals.blockers[0] ?? "Смета содержит неподтверждённые цены");
  }
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJsonValue(nested)]),
    );
  }
  return value;
}

export function canonicalSnapshotJson(snapshot: PublishedQuoteSnapshot): string {
  return JSON.stringify(canonicalJsonValue(snapshot));
}

export function quoteSnapshotChecksum(snapshot: PublishedQuoteSnapshot): string {
  return createHash("sha256").update(canonicalSnapshotJson(snapshot)).digest("hex");
}

export function diffCommercialLines(previous: CommercialLine[], next: CommercialLine[]) {
  const previousByKey = new Map(previous.map((line) => [line.stableKey, line]));
  const nextByKey = new Map(next.map((line) => [line.stableKey, line]));
  const added = next.filter((line) => !previousByKey.has(line.stableKey));
  const removed = previous.filter((line) => !nextByKey.has(line.stableKey));
  const changed = next.flatMap((line) => {
    const before = previousByKey.get(line.stableKey);
    if (!before || JSON.stringify(canonicalJsonValue(before)) === JSON.stringify(canonicalJsonValue(line))) {
      return [];
    }
    return [{ stableKey: line.stableKey, before, after: line }];
  });
  return { added, removed, changed };
}
