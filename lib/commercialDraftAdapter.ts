import type {
  CalculationResult,
  EstimateItem,
  ExternalExpense,
  FormData,
} from "@/lib/calculationUtils";
import {
  INTERNAL_COST_LINE_SOURCE,
  type CommercialLine,
  type CommercialScenario,
} from "@/lib/commercialQuote";

const bothScenarios: CommercialScenario[] = ["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"];

export function commercialScenarioFromForm(form: Pick<FormData, "serviceType">): CommercialScenario {
  return form.serviceType === "cremation" ? "CREMATION_V1" : "FAMILY_PLOT_BURIAL_V1";
}

export function buildCommercialDraftLines(input: {
  result: CalculationResult;
  estimateItems: EstimateItem[];
  externalExpenses: ExternalExpense[];
  scenario: CommercialScenario;
}): CommercialLine[] {
  const lines: CommercialLine[] = [];
  let position = 0;
  const push = (line: Omit<CommercialLine, "position">) => lines.push({ ...line, position: position++ });

  input.result.sections.forEach((section, sectionIndex) => {
    if (section.total <= 0) return;
    const sectionKey = `calculator:${slug(section.title)}:${sectionIndex}`;
    const isPackage = section.title.startsWith("Пакет ");
    const priced = section.items?.filter((item) => !item.included && (item.clientPrice ?? item.price) != null) ?? [];

    if (isPackage || priced.length === 0) {
      push({
        stableKey: sectionKey,
        type: isPackage ? "PACKAGE" : "SERVICE",
        serviceCode: sectionKey,
        description: section.title,
        quantity: 1,
        unit: "комплект",
        priceState: "KNOWN",
        clientUnitPrice: rublesToKopecks(section.total),
        costState: knownState(section.costTotal),
        unitCost: knownValue(section.costTotal),
        discountAmount: 0,
        included: false,
        optional: false,
        relationKind: "STANDALONE",
        source: "td-calculator",
        sourceVersion: "1",
        scenarioCompatibility: [...bothScenarios],
      });
    } else {
      priced.forEach((item, itemIndex) => {
        const unitPrice = item.clientPrice ?? item.price ?? 0;
        push({
          stableKey: `${sectionKey}:item:${slug(item.label)}:${itemIndex}`,
          type: "SERVICE",
          serviceCode: `${sectionKey}:${itemIndex}`,
          description: item.label,
          quantity: item.quantity ?? 1,
          unit: "услуга",
          priceState: unitPrice > 0 ? "KNOWN" : "UNKNOWN",
          clientUnitPrice: unitPrice > 0 ? rublesToKopecks(unitPrice) : null,
          costState: knownState(item.costPrice),
          unitCost: knownValue(item.costPrice),
          discountAmount: 0,
          included: false,
          optional: false,
          relationKind: "STANDALONE",
          source: "td-calculator",
          sourceVersion: "1",
          scenarioCompatibility: [...bothScenarios],
        });
      });
    }

    if (isPackage) {
      section.items?.forEach((item, itemIndex) => {
        push({
          stableKey: `${sectionKey}:included:${itemIndex}`,
          type: "SERVICE",
          serviceCode: `${sectionKey}:included:${itemIndex}`,
          description: item.label,
          quantity: 1,
          unit: "услуга",
          priceState: "UNKNOWN",
          clientUnitPrice: null,
          costState: "UNKNOWN",
          unitCost: null,
          discountAmount: 0,
          included: true,
          optional: false,
          relationKind: "INCLUDED",
          relationKey: sectionKey,
          source: "td-package",
          sourceVersion: "1",
          scenarioCompatibility: [...bothScenarios],
        });
      });
    }
  });

  input.estimateItems.forEach((item, index) => {
    const compatible = item.category === "Урны" ? ["CREMATION_V1"] as CommercialScenario[] : [...bothScenarios];
    push({
      stableKey: `catalog:${item.catalogItemId}:${item.id}:${index}`,
      type: "PRODUCT",
      catalogItemId: item.catalogItemId,
      catalogRevisionId: item.catalogRevisionId,
      description: item.name,
      quantity: item.quantity,
      unit: "шт.",
      priceState: item.priceState ?? (item.clientPrice > 0 ? "KNOWN" : "UNKNOWN"),
      clientUnitPrice: (item.priceState ?? (item.clientPrice > 0 ? "KNOWN" : "UNKNOWN")) === "KNOWN"
        ? rublesToKopecks(item.clientPrice)
        : null,
      costState: item.costState ?? knownState(item.costPrice),
      unitCost: (item.costState ?? knownState(item.costPrice)) === "KNOWN" ? knownValue(item.costPrice) : null,
      discountAmount: 0,
      included: false,
      optional: item.isOptional === true,
      relationKind: item.source === "package" ? "ADD_ON" : "STANDALONE",
      relationKey: null,
      source: item.source ?? "td-catalog",
      sourceVersion: item.sourceVersion ?? "1",
      scenarioCompatibility: compatible,
    });
  });

  input.externalExpenses
    .filter((expense) => expense.includeInClientTotal || expense.includeInMarginCalculation)
    .forEach((expense, index) => {
      const internalCostOnly = !expense.includeInClientTotal && expense.includeInMarginCalculation;
      push({
        stableKey: `external:${expense.id}:${index}`,
        type: "EXTERNAL_EXPENSE",
        serviceCode: expense.category,
        description: expense.name,
        quantity: 1,
        unit: "услуга",
        priceState: expense.includeInClientTotal
          ? (expense.clientPrice > 0 ? "KNOWN" : "UNKNOWN")
          : "KNOWN",
        clientUnitPrice: expense.includeInClientTotal
          ? (expense.clientPrice > 0 ? rublesToKopecks(expense.clientPrice) : null)
          : 0,
        costState: expense.includeInMarginCalculation ? knownState(expense.costPrice) : "KNOWN",
        unitCost: expense.includeInMarginCalculation ? knownValue(expense.costPrice) : 0,
        discountAmount: 0,
        included: false,
        optional: false,
        relationKind: "STANDALONE",
        source: internalCostOnly ? INTERNAL_COST_LINE_SOURCE : "agent-entered-expense",
        sourceVersion: "1",
        scenarioCompatibility: [...bothScenarios],
      });
    });

  return lines;
}

function rublesToKopecks(value: number) {
  return Math.round(value * 100);
}

function knownState(value?: number | null): "KNOWN" | "UNKNOWN" {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? "KNOWN" : "UNKNOWN";
}

function knownValue(value?: number | null) {
  return knownState(value) === "KNOWN" ? rublesToKopecks(value!) : null;
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "line";
}
