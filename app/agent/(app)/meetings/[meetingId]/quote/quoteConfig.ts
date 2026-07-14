import type { CatalogCategory, FormData } from "@/lib/calculationUtils";

/**
 * Конфигурация конфигуратора сметы — вынесена из QuoteBuilder.tsx (D1a,
 * первый шаг декомпозиции монолита). Чистые данные без состояния и JSX:
 * их выносить безопасно, дальше по одному куску за итерацию (см.
 * docs/IMPLEMENTATION_PLAN.md, D1b–D1d).
 */

export const DEFAULT_FORM: FormData = {
  serviceType: "burial",
  hasHall: false,
  hallDuration: 60,
  ceremonyType: "civil",
  packageType: "custom",
  needsHearse: false,
  needsFamilyTransport: false,
  familyTransportSeats: 5,
  needsPallbearers: false,
  selectedAdditionalServices: [],
  cemetery: "",
  clientBudget: null,
};

// Порядок шага «Атрибутика»: гроб → венки → постель → кресты/таблички → урны.
// «Урны» показываются только при кремации (visibleCategories в QuoteBuilder).
export const ATTRIBUTION_CATEGORIES: CatalogCategory[] = [
  "Гробы",
  "Венки",
  "Постель / комплект в гроб",
  "Кресты / таблички",
  "Урны",
];

export type Step = "basics" | "logistics" | "attributes" | "memorial" | "expenses";
export type CalculatorTab = "composition" | "economics" | "versions" | "actions";

export const STEPS: Array<{ id: Step; label: string; hint: string }> = [
  { id: "basics", label: "Основное", hint: "Тип услуги, бюджет, пакет и формат церемонии." },
  { id: "logistics", label: "Логистика", hint: "Транспорт, носильщики, место захоронения и доп. услуги." },
  { id: "attributes", label: "Атрибутика", hint: "Гроб, постель, венки, кресты, таблички и урны." },
  { id: "memorial", label: "Поминки", hint: "Нужны ли поминки и помощь агента с подбором кафе." },
  { id: "expenses", label: "Расходы", hint: "Внешние расходы: морг, кладбище, крематорий, церковь." },
];
