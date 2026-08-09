"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { Check, CaretLeft, CaretRight, Copy, Eye, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import s from "./QuoteBuilder.module.css";
import {
  type FormData,
  type CalculationSection,
  type CatalogCategory,
  type CatalogItem,
  type EstimateItem,
  type MemorialData,
  type MemorialStatus,
  type ExternalExpense,
  calculateOrder,
  calculateOrderEconomics,
  calculateBudgetStatus,
  calculateEstimateItemsTotal,
  calculateExternalExpensesClientTotal,
  addCatalogItemToEstimate,
  addMemorialAssistanceItem,
  removeMemorialAssistanceItem,
  updateEstimateItemQuantity,
  removeEstimateItem,
  updateEstimateItemClientPrice,
  createExternalExpense,
  formatCurrency,
  formatMinorUnitsCurrency,
  PRICES,
  PACKAGES,
  ADDITIONAL_SERVICES,
  AGENT_ATTRIBUTION_CATALOG,
  readShortlist,
  writeShortlist,
  DEFAULT_MEMORIAL_DATA,
  EXTERNAL_EXPENSE_PRESETS,
  MOSCOW_CEMETERIES,
  MO_CEMETERIES,
  DEFAULT_CALCULATOR_CONFIG,
} from "@/lib/calculationUtils";
import { DEFAULT_ATTRIBUTES, type AttrSelection } from "@/lib/attributes";
import { buildCommercialDraftLines, commercialScenarioFromForm } from "@/lib/commercialDraftAdapter";
import { calculateCommercialEconomics, type CommercialEconomics } from "@/lib/commercialQuote";
import { hydratePackage, withoutPackageItems, PACKAGE_ITEM_SOURCE } from "@/lib/packagePresets";
import { formatDelta } from "@/lib/calculationUtils";
import AttributeRender from "@/components/AttributeRender";
import { ToggleRow } from "./components/ToggleRow";
import { MemorialBlock } from "./components/MemorialBlock";
import { EstimateItemRow } from "./components/EstimateItemRow";
import { OptionCard } from "./components/OptionCard";
import { ExternalExpensesBlock } from "./components/ExternalExpensesBlock";
import { AgentEconomicsBlock } from "./components/AgentEconomicsBlock";
import { QuoteVersionHistory } from "./components/SnapshotBlock";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Props {
  meetingId: number;
  clientName: string;
  caseId?: number;
}

const DEFAULT_FORM: FormData = {
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
// «Урны» показываются только при кремации (см. visibleCategories ниже).
const ATTRIBUTION_CATEGORIES: CatalogCategory[] = [
  "Гробы",
  "Венки",
  "Постель / комплект в гроб",
  "Кресты / таблички",
  "Урны",
];

type Step = "basics" | "logistics" | "attributes" | "memorial" | "expenses";
type CalculatorTab = "composition" | "economics" | "versions" | "actions";

type QuoteVersionHistoryItem = {
  id: number;
  versionNumber: number;
  state: string;
  total: number | null;
  totalState: string;
  costTotal: number | null;
  margin: number | null;
  lineCount: number;
  publishedAt: string | null;
  validUntil: string | null;
};

const STEPS: Array<{ id: Step; label: string; hint: string }> = [
  { id: "basics", label: "Основное", hint: "Тип услуги, бюджет, пакет и формат церемонии." },
  { id: "logistics", label: "Логистика", hint: "Транспорт, носильщики, место захоронения и доп. услуги." },
  { id: "attributes", label: "Атрибутика", hint: "Гроб, постель, венки, кресты, таблички и урны." },
  { id: "memorial", label: "Поминки", hint: "Нужны ли поминки и помощь агента с подбором кафе." },
  { id: "expenses", label: "Расходы", hint: "Внешние расходы: морг, кладбище, крематорий, церковь." },
];

function defaultCommercialExpiry() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

/* ─── Main component ─────────────────────────────────────────────────── */

export default function QuoteBuilder({ meetingId, clientName, caseId }: Props) {
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [cemeteryCategory, setCemeteryCategory] = useState("standard");
  const [attributes, setAttributes] = useState<AttrSelection>(DEFAULT_ATTRIBUTES);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const [catalogCategory, setCatalogCategory] = useState<CatalogCategory>("Гробы");
  const [catalogColors, setCatalogColors] = useState<Record<string, string>>({});
  const [estimateItems, setEstimateItems] = useState<EstimateItem[]>([]);
  // Подборка из маркетплейса (localStorage) — для переноса в смету одним нажатием.
  const [shortlist, setShortlist] = useState<ReturnType<typeof readShortlist>>([]);
  const [memorialData, setMemorialData] = useState<MemorialData>(DEFAULT_MEMORIAL_DATA);
  const [externalExpenses, setExternalExpenses] = useState<ExternalExpense[]>([]);
  const [expenseDraft, setExpenseDraft] = useState<ExternalExpense>(
    createExternalExpense({ id: "draft", name: "", category: "Морг", clientPrice: 0, costPrice: 0 }),
  );
  const [versionHistory, setVersionHistory] = useState<QuoteVersionHistoryItem[]>([]);
  const [step, setStep] = useState<Step>("basics");
  const [visited, setVisited] = useState<Set<Step>>(() => new Set<Step>(["basics"]));
  // Якорь тарифа: после «Изменить детали» помним исходную цену пакета,
  // чтобы показывать дельту (клиент выбрал тариф 400к, поменял гроб → −15к).
  const [baseline, setBaseline] = useState<{ id: string; name: string; price: number } | null>(null);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [calculatorTab, setCalculatorTab] = useState<CalculatorTab>("composition");
  const [quoteId, setQuoteId] = useState<number | null>(null);
  const [commercialStatus, setCommercialStatus] = useState("DRAFT");
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [reviewResult, setReviewResult] = useState<{
    blockers: string[];
    warnings: string[];
    total: number | null;
    added: number;
    removed: number;
    changed: number;
    totalDelta: number | null;
  } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [clientLink, setClientLink] = useState<string | null>(null);
  const [quoteLoadAttempt, setQuoteLoadAttempt] = useState(0);
  const quoteLoadKey = `${meetingId}:${quoteLoadAttempt}`;
  const [settledQuoteLoadKey, setSettledQuoteLoadKey] = useState<string | null>(null);
  const [failedQuoteLoadKey, setFailedQuoteLoadKey] = useState<string | null>(null);
  const quoteHydrated = settledQuoteLoadKey === quoteLoadKey;
  const quoteLoadFailed = failedQuoteLoadKey === quoteLoadKey;
  const quoteAuthorityRef = useRef<string | null>(null);
  const [canonicalEconomics, setCanonicalEconomics] = useState<CommercialEconomics | null>(null);
  const [lastAutosavedState, setLastAutosavedState] = useState<string | null>(null);
  const autosaveHandler = useRef<(options?: { quiet?: boolean }) => Promise<number | null>>(async () => null);

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const activeStep = STEPS[stepIndex] ?? STEPS[0];
  const prevStep = stepIndex > 0 ? STEPS[stepIndex - 1] : null;
  const nextStep = stepIndex < STEPS.length - 1 ? STEPS[stepIndex + 1] : null;

  function goToStep(id: Step) {
    setStep(id);
    setVisited((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const result = useMemo(
    () => calculateOrder(form, DEFAULT_CALCULATOR_CONFIG, cemeteryCategory),
    [form, cemeteryCategory],
  );
  const estimateTotal = useMemo(() => calculateEstimateItemsTotal(estimateItems), [estimateItems]);
  const externalTotal = useMemo(() => calculateExternalExpensesClientTotal(externalExpenses), [externalExpenses]);
  const estimatePricesKnown = useMemo(
    () => estimateItems.every((item) => (item.priceState ?? (item.clientPrice > 0 ? "KNOWN" : "UNKNOWN")) === "KNOWN"),
    [estimateItems],
  );
  const externalPricesKnown = useMemo(
    () => externalExpenses.every((expense) => !expense.includeInClientTotal || expense.clientPrice > 0),
    [externalExpenses],
  );
  const baseLineCount = useMemo(
    () => result.sections.reduce((sum, section) => sum + (section.items?.length ?? (section.total > 0 ? 1 : 0)), 0),
    [result.sections],
  );
  const calculatorLineCount = baseLineCount + estimateItems.length + externalExpenses.length;
  const calculatorVersionLabel = publishedVersion ? `после v${publishedVersion}` : "черновик";
  const isCremation = form.serviceType === "cremation";
  // «Урны» — только при кремации.
  const visibleCategories = useMemo(
    () => ATTRIBUTION_CATEGORIES.filter((c) => c !== "Урны" || isCremation),
    [isCremation],
  );
  // Если выбранная категория стала недоступна (напр. «Урны» при погребении) — откат на «Гробы».
  const activeCategory: CatalogCategory = visibleCategories.includes(catalogCategory) ? catalogCategory : "Гробы";
  // Собственные товары агента (свой каталог, авто-вырез фона) — как CatalogItem.
  const [customCatalog, setCustomCatalog] = useState<CatalogItem[]>([]);
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/agent/catalog")
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Каталог временно недоступен");
        return body;
      })
      .then((d) => {
        if (!active) return;
        const mapped: CatalogItem[] = (d.items ?? []).map(
          (it: {
            id: string;
            name: string;
            category: string;
            description?: string;
            imageData: string;
            clientPrice: number;
            costPrice: number;
            priceState: CatalogItem["priceState"];
            costState: CatalogItem["costState"];
            currentRevisionId: string | null;
            sourceVersion: string;
          }) => ({
            id: `custom-${it.id}`,
            name: it.name,
            category: it.category as CatalogCategory,
            description: it.description ?? "",
            imageUrl: it.imageData,
            imagePlaceholder: "🕊️",
            clientPrice: it.clientPrice,
            costPrice: it.costPrice,
            priceState: it.priceState,
            costState: it.costState,
            catalogRevisionId: it.currentRevisionId,
            sourceVersion: it.sourceVersion,
            quantityDefault: 1,
            tags: ["Мой товар"],
          }),
        );
        setCustomCatalog(mapped);
        setCatalogLoadError(null);
      })
      .catch((cause: unknown) => {
        if (active) setCatalogLoadError(cause instanceof Error ? cause.message : "Каталог временно недоступен");
      });
    return () => {
      active = false;
    };
  }, []);
  const filteredCatalogItems = useMemo(
    () =>
      [...AGENT_ATTRIBUTION_CATALOG, ...customCatalog].filter(
        (item) => ATTRIBUTION_CATEGORIES.includes(item.category) && item.category === activeCategory,
      ),
    [activeCategory, customCatalog],
  );
  const commercialLines = useMemo(() => {
    const scenario = commercialScenarioFromForm(form);
    return buildCommercialDraftLines({ result, estimateItems, externalExpenses, scenario });
  }, [externalExpenses, form, estimateItems, result]);
  const liveEconomics = useMemo(
    () => calculateCommercialEconomics(commercialLines, commercialScenarioFromForm(form)),
    [commercialLines, form],
  );
  const editorStateJson = useMemo(
    () => JSON.stringify({ form, cemeteryCategory, attributes, estimateItems, externalExpenses, memorialData }),
    [attributes, cemeteryCategory, estimateItems, externalExpenses, form, memorialData],
  );
  const hasLocalChanges = quoteHydrated && !quoteLoadFailed && editorStateJson !== lastAutosavedState;
  const quoteWritesAvailable = quoteHydrated && !quoteLoadFailed;
  const economics = !hasLocalChanges && canonicalEconomics ? canonicalEconomics : liveEconomics;
  const commercialTotals = economics;
  /**
   * The headline the agent reads aloud to a family must never be a number the domain
   * refuses to total. `grandTotal` is legacy editor arithmetic that sums clientPrice with
   * no regard for priceState, so an item whose price was only REQUESTED still carries its
   * stale value there. Gate the headline on the canonical state instead, and render the
   * blockers rather than a confident figure.
   */
  const visibleGrandTotalMinor = quoteHydrated && !quoteLoadFailed && commercialTotals.totalState === "KNOWN"
    ? commercialTotals.total
    : null;
  // Render from minor units, never from a rounded ruble figure: the client view states the
  // same number and the two must not disagree by a rounding step.
  const headlineTotal = !quoteHydrated
    ? "Загрузка сметы..."
    : quoteLoadFailed
      ? "Не удалось загрузить"
    : visibleGrandTotalMinor !== null
      ? formatMinorUnitsCurrency(visibleGrandTotalMinor)
      : "Цена требует уточнения";
  const hasUnknownCosts = commercialTotals.costTotal === null;
  const budgetStatus = useMemo(
    () => visibleGrandTotalMinor === null
      ? {
          clientBudget: form.clientBudget,
          budgetRemaining: 0,
          budgetExceeded: false,
          budgetUsagePercent: 0,
          status: "unknown_total" as const,
        }
      : calculateBudgetStatus(visibleGrandTotalMinor / 100, form.clientBudget),
    [form.clientBudget, visibleGrandTotalMinor],
  );
  const itemMarginAlert = useMemo(() => {
    const marginPercents = economics.items.flatMap((item) => item.marginPercent === null ? [] : [item.marginPercent]);
    const worstMarginPercent = Math.min(...marginPercents, Number.POSITIVE_INFINITY);
    if (economics.items.some((item) => item.margin !== null && item.margin < 0)) return "negative";
    if (worstMarginPercent < 5) return "critical";
    if (worstMarginPercent < 15) return "low";
    return null;
  }, [economics.items]);
  const marginWarning =
    commercialTotals.total === null
      ? "Итог не подтверждён. Маржа не рассчитывается."
      : hasUnknownCosts
      ? "Себестоимость не подтверждена. Маржа не рассчитывается."
      : (economics.margin !== null && economics.margin < 0) || itemMarginAlert === "negative"
      ? "Внимание: цена ниже себестоимости"
      : (economics.marginPercent !== null && economics.marginPercent < 5) || itemMarginAlert === "critical"
        ? "Критически низкая маржа: сделка почти без прибыли"
        : (economics.marginPercent !== null && economics.marginPercent < 15) || itemMarginAlert === "low"
          ? "Низкая маржа: проверьте цену или себестоимость"
          : null;
  const calculatorStatus =
    budgetStatus.status === "unknown_total"
      ? { tone: "warning" as const, text: "Уточните цены" }
      : budgetStatus.status === "exceeded"
      ? { tone: "danger" as const, text: `Бюджет +${formatCurrency(Math.abs(budgetStatus.budgetRemaining))}` }
      : marginWarning
        ? { tone: "warning" as const, text: "Проверьте экономику" }
        : budgetStatus.status === "near_limit"
          ? { tone: "warning" as const, text: "Бюджет почти выбран" }
          : { tone: "ok" as const, text: "Можно сохранять" };
  const budgetMessage =
    budgetStatus.status === "unknown_total"
      ? "Итог не подтверждён. Сравнение с бюджетом недоступно."
      : budgetStatus.status === "not_set"
      ? "Бюджет не указан"
      : budgetStatus.status === "exceeded"
        ? `Превышение бюджета: ${formatCurrency(Math.abs(budgetStatus.budgetRemaining))}`
        : budgetStatus.status === "near_limit"
          ? `Почти весь бюджет использован. Осталось: ${formatCurrency(budgetStatus.budgetRemaining)}`
          : `В рамках бюджета. Осталось: ${formatCurrency(budgetStatus.budgetRemaining)}`;

  const relevantPackages = PACKAGES.filter((p) =>
    form.serviceType === "cremation"
      ? p.id.startsWith("cremation")
      : !p.id.startsWith("cremation"),
  );
  const selectedPackage = relevantPackages.find((p) => p.id === form.packageType);
  const planMode = form.packageType === "custom" ? "custom" : "package";
  const baselineDelta = baseline && visibleGrandTotalMinor !== null
    ? visibleGrandTotalMinor / 100 - baseline.price
    : null;
  const planTitle =
    planMode === "package"
      ? selectedPackage
        ? `Тариф «${selectedPackage.name}»`
        : "Готовые решения"
      : baseline
        ? `Тариф «${baseline.name}» + детали`
        : "План по позициям";
  const planSubtitle = planMode === "custom"
    ? baseline
      ? "Тариф разложен на позиции. Меняйте состав, итог и дельта обновятся сразу."
      : "Соберите состав, проверьте бюджет, сохраните версию."
    : "Выберите тариф или разложите его на позиции.";

  const visibleCemeteries =
    form.serviceType === "cremation"
      ? MOSCOW_CEMETERIES.filter((c) => c.type === "cremation")
      : [
          ...MOSCOW_CEMETERIES.filter((c) => c.type === "burial"),
          ...MO_CEMETERIES,
        ];

  useEffect(() => {
    let active = true;
    quoteAuthorityRef.current = null;
    const emptyEditorState = {
      form: DEFAULT_FORM,
      cemeteryCategory: "standard",
      attributes: DEFAULT_ATTRIBUTES,
      estimateItems: [] as EstimateItem[],
      externalExpenses: [] as ExternalExpense[],
      memorialData: DEFAULT_MEMORIAL_DATA,
    };
    // quoteLoadKey invalidates every server-derived handle before this effect runs. Stale
    // state may exist while the request is in flight, but no read model or mutation can
    // treat it as current until this exact key settles successfully.
    fetch(`/api/agent/meeting/${meetingId}/quote`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("quote-load-failed");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        quoteAuthorityRef.current = quoteLoadKey;
        setFailedQuoteLoadKey(null);
        setSaveError(null);
        setQuoteId(null);
        setCommercialStatus("DRAFT");
        setPublishedVersion(null);
        setReviewResult(null);
        setClientLink(null);
        setVersionHistory([]);
        setCanonicalEconomics(null);
        if (!data.quote) {
          setForm(emptyEditorState.form);
          setCemeteryCategory(emptyEditorState.cemeteryCategory);
          setAttributes(emptyEditorState.attributes);
          setEstimateItems(emptyEditorState.estimateItems);
          setExternalExpenses(emptyEditorState.externalExpenses);
          setMemorialData(emptyEditorState.memorialData);
          setLastAutosavedState(JSON.stringify(emptyEditorState));
          return;
        }
        const canonicalEditorState = {
          ...emptyEditorState,
          form: {
            ...emptyEditorState.form,
            serviceType: data.quote.scenario === "CREMATION_V1" ? "cremation" : "burial",
          } satisfies FormData,
        };
        setQuoteId(data.quote.quoteId);
        setCommercialStatus(data.quote.status);
        setPublishedVersion(data.quote.published?.versionNumber ?? null);
        setVersionHistory(Array.isArray(data.quote.history) ? data.quote.history : []);
        const canonicalVersion = data.quote.draft ?? data.quote.published;
        setCanonicalEconomics(
          canonicalVersion && Array.isArray(canonicalVersion.lines)
            ? calculateCommercialEconomics(canonicalVersion.lines, data.quote.scenario)
            : null,
        );
        const editor = data.quote.draft?.editorState ?? data.quote.published?.editorState;
        if (!editor || typeof editor !== "object" || Array.isArray(editor)) {
          setForm(canonicalEditorState.form);
          setLastAutosavedState(JSON.stringify(canonicalEditorState));
          return;
        }
        const state = editor as {
          form?: FormData;
          cemeteryCategory?: string;
          attributes?: AttrSelection;
          estimateItems?: EstimateItem[];
          externalExpenses?: ExternalExpense[];
          memorialData?: MemorialData;
        };
        const hydrated = {
          form: state.form ?? canonicalEditorState.form,
          cemeteryCategory: state.cemeteryCategory ?? canonicalEditorState.cemeteryCategory,
          attributes: state.attributes ?? canonicalEditorState.attributes,
          estimateItems: Array.isArray(state.estimateItems) ? state.estimateItems : canonicalEditorState.estimateItems,
          externalExpenses: Array.isArray(state.externalExpenses) ? state.externalExpenses : canonicalEditorState.externalExpenses,
          memorialData: state.memorialData ?? canonicalEditorState.memorialData,
        };
        setForm(hydrated.form);
        setCemeteryCategory(hydrated.cemeteryCategory);
        setAttributes(hydrated.attributes);
        setEstimateItems(hydrated.estimateItems);
        setExternalExpenses(hydrated.externalExpenses);
        setMemorialData(hydrated.memorialData);
        setLastAutosavedState(JSON.stringify(hydrated));
      })
      .catch(() => {
        if (active) {
          quoteAuthorityRef.current = null;
          setFailedQuoteLoadKey(quoteLoadKey);
          setQuoteId(null);
          setCommercialStatus("DRAFT");
          setPublishedVersion(null);
          setReviewResult(null);
          setClientLink(null);
          setVersionHistory([]);
          setCanonicalEconomics(null);
          setForm(emptyEditorState.form);
          setCemeteryCategory(emptyEditorState.cemeteryCategory);
          setAttributes(emptyEditorState.attributes);
          setEstimateItems(emptyEditorState.estimateItems);
          setExternalExpenses(emptyEditorState.externalExpenses);
          setMemorialData(emptyEditorState.memorialData);
          setLastAutosavedState(JSON.stringify(emptyEditorState));
          setSaveError("Не удалось загрузить сохранённый черновик. Обновите страницу или повторите попытку.");
        }
      })
      .finally(() => {
        if (active) setSettledQuoteLoadKey(quoteLoadKey);
      });
    return () => {
      active = false;
      if (quoteAuthorityRef.current === quoteLoadKey) quoteAuthorityRef.current = null;
    };
  }, [meetingId, quoteLoadKey]);

  useEffect(() => {
    if (!calculatorOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCalculatorOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [calculatorOpen]);

  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setBudgetValue(value: string) {
    const normalized = value.replace(/[^\d]/g, "");
    setField("clientBudget", normalized ? Number(normalized) : null);
  }

  function toggleService(id: string) {
    setForm((f) => ({
      ...f,
      selectedAdditionalServices: f.selectedAdditionalServices.includes(id)
        ? f.selectedAdditionalServices.filter((x) => x !== id)
        : [...f.selectedAdditionalServices, id],
    }));
  }

  function getSelectedCatalogColor(item: CatalogItem) {
    return catalogColors[item.id] ?? item.selectedColor ?? item.availableColors?.[0];
  }

  function setCatalogColor(itemId: string, color: string) {
    setCatalogColors((current) => ({ ...current, [itemId]: color }));
  }

  // Категории с одиночным выбором (radio-семантика): новый выбор заменяет прежний.
  const SINGLE_CATEGORIES = new Set<CatalogCategory>(["Гробы", "Постель / комплект в гроб", "Урны"]);

  function isCatalogSelected(item: CatalogItem) {
    return estimateItems.some((e) => e.catalogItemId === item.id);
  }

  function toggleCatalogItem(item: CatalogItem) {
    setEstimateItems((current) => {
      if (current.some((e) => e.catalogItemId === item.id)) {
        return current.filter((e) => e.catalogItemId !== item.id);
      }
      // Замена позиции тарифа наследует его source: «гроб из тарифа» остаётся
      // частью тарифной раскладки, а не доп. позицией поверх пакета.
      const replaced = SINGLE_CATEGORIES.has(item.category)
        ? current.find((e) => e.category === item.category)
        : undefined;
      let base = SINGLE_CATEGORIES.has(item.category) ? current.filter((e) => e.category !== item.category) : current;
      // Венки: максимум два (левый и правый мольберт). Третий вытесняет самый ранний.
      if (item.category === "Венки") {
        const wreaths = base.filter((e) => e.category === "Венки");
        if (wreaths.length >= 2) {
          const oldestId = wreaths[0].id;
          base = base.filter((e) => e.id !== oldestId);
        }
      }
      const next = addCatalogItemToEstimate(base, item, getSelectedCatalogColor(item));
      if (replaced?.source !== PACKAGE_ITEM_SOURCE) return next;
      return next.map((e) => (e.catalogItemId === item.id ? { ...e, source: PACKAGE_ITEM_SOURCE } : e));
    });
  }

  function changeCatalogColor(item: CatalogItem, color: string) {
    setCatalogColor(item.id, color);
    setEstimateItems((current) =>
      current.some((e) => e.catalogItemId === item.id)
        ? current.map((e) => (e.catalogItemId === item.id ? { ...e, selectedColor: color } : e))
        : current,
    );
  }

  async function requestCatalogPrice(item: CatalogItem) {
    if (!item.id.startsWith("custom-") || item.priceState === "REQUESTED") return;
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/agent/catalog/${item.id.slice("custom-".length)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId,
          "X-Correlation-Id": requestId,
        },
        body: JSON.stringify({ action: "REQUEST_PRICE" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Не удалось запросить цену");
      setCustomCatalog((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, priceState: "REQUESTED", sourceVersion: body.item?.sourceVersion ?? entry.sourceVersion }
            : entry,
        ),
      );
      toast({ type: "success", message: "Запрос цены зафиксирован" });
    } catch (cause) {
      toast({ type: "error", message: cause instanceof Error ? cause.message : "Не удалось запросить цену" });
    }
  }

  // Синхронизация подборки из маркетплейса (другая вкладка / эта вкладка).
  useEffect(() => {
    const sync = () => setShortlist(readShortlist());
    sync();
    window.addEventListener("td-shortlist-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("td-shortlist-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const shortlistPending = useMemo(
    () => shortlist.filter((e) => !estimateItems.some((x) => x.catalogItemId === e.id)),
    [shortlist, estimateItems],
  );

  // Перенести подборку из каталога в смету: добавляем только новые позиции,
  // с учётом radio-семантики одиночных категорий (гроб/постель/урна).
  function importShortlistToEstimate() {
    const entries = readShortlist();
    if (!entries.length) return;
    setEstimateItems((current) => {
      let next = current;
      for (const e of entries) {
        const item = AGENT_ATTRIBUTION_CATALOG.find((i) => i.id === e.id);
        if (!item || next.some((x) => x.catalogItemId === item.id)) continue;
        const base = SINGLE_CATEGORIES.has(item.category)
          ? next.filter((x) => x.category !== item.category)
          : next;
        next = addCatalogItemToEstimate(base, item, e.color ?? getSelectedCatalogColor(item));
      }
      return next;
    });
    writeShortlist([]);
    setShortlist([]);
    toast({ type: "success", message: "Подборка добавлена в смету" });
  }

  function changeEstimateQuantity(id: string, quantity: number) {
    setEstimateItems((current) => updateEstimateItemQuantity(current, id, quantity));
  }

  function deleteEstimateItem(id: string) {
    setEstimateItems((current) => removeEstimateItem(current, id));
  }

  function changeEstimatePrice(id: string, value: string) {
    const normalized = value.replace(/[^\d]/g, "");
    setEstimateItems((current) => updateEstimateItemClientPrice(current, id, normalized ? Number(normalized) : 0));
  }

  function setMemorialStatus(status: MemorialStatus) {
    setMemorialData((current) => ({
      ...current,
      status,
      includeCafeAssistance: status === "agent_helps" ? current.includeCafeAssistance : false,
    }));
    if (status !== "agent_helps") {
      setEstimateItems((current) => removeMemorialAssistanceItem(current));
    }
  }

  function setMemorialGuests(value: string) {
    const normalized = value.replace(/[^\d]/g, "");
    setMemorialData((current) => ({ ...current, guestsCount: normalized ? Number(normalized) : null }));
  }

  function setCafeAssistanceIncluded(included: boolean) {
    setMemorialData((current) => ({ ...current, includeCafeAssistance: included }));
    setEstimateItems((current) => (included ? addMemorialAssistanceItem(current) : removeMemorialAssistanceItem(current)));
  }

  function setExpenseDraftField<K extends keyof ExternalExpense>(key: K, value: ExternalExpense[K]) {
    setExpenseDraft((current) => ({ ...current, [key]: value }));
  }

  function setExpenseDraftMoney(key: "clientPrice" | "costPrice", value: string) {
    const normalized = value.replace(/[^\d]/g, "");
    setExpenseDraft((current) => ({ ...current, [key]: normalized ? Number(normalized) : 0 }));
  }

  function addExternalExpense(expense: ExternalExpense) {
    if (!expense.name.trim()) return;
    setExternalExpenses((current) => [...current, createExternalExpense({ ...expense, id: undefined, name: expense.name.trim() })]);
    setExpenseDraft(createExternalExpense({ id: "draft", name: "", category: "Морг", clientPrice: 0, costPrice: 0 }));
  }

  function addExpensePreset(preset: (typeof EXTERNAL_EXPENSE_PRESETS)[number]) {
    setExternalExpenses((current) => [
      ...current,
      createExternalExpense({
        ...preset,
        includeInClientTotal: true,
        includeInMarginCalculation: true,
      }),
    ]);
  }

  function removeExternalExpense(id: string) {
    setExternalExpenses((current) => current.filter((expense) => expense.id !== id));
  }

  function updateExternalExpense(id: string, patch: Partial<ExternalExpense>) {
    setExternalExpenses((current) => current.map((expense) => (expense.id === id ? { ...expense, ...patch } : expense)));
  }

  function copyClientLink() {
    const authorityKey = quoteLoadKey;
    if (!clientLink || typeof window === "undefined" || !hasCurrentQuoteAuthority(authorityKey)) return;
    void navigator.clipboard.writeText(clientLink)
      .then(() => {
        if (!hasCurrentQuoteAuthority(authorityKey)) return;
        setCopied(true);
        toast({ type: "success", message: "Ссылка скопирована" });
        setTimeout(() => {
          if (hasCurrentQuoteAuthority(authorityKey)) setCopied(false);
        }, 2000);
      })
      .catch(() => {
        if (hasCurrentQuoteAuthority(authorityKey)) {
          toast({ type: "error", message: "Не удалось скопировать ссылку" });
        }
      });
  }

  function hasCurrentQuoteAuthority(authorityKey: string) {
    return quoteAuthorityRef.current === authorityKey;
  }

  function invalidateCanonicalQuoteRead(authorityKey: string, message: string) {
    if (!hasCurrentQuoteAuthority(authorityKey)) return false;
    quoteAuthorityRef.current = null;
    setFailedQuoteLoadKey(authorityKey);
    setSettledQuoteLoadKey(authorityKey);
    setQuoteId(null);
    setCommercialStatus("DRAFT");
    setPublishedVersion(null);
    setReviewResult(null);
    setClientLink(null);
    setVersionHistory([]);
    setCanonicalEconomics(null);
    setForm(DEFAULT_FORM);
    setCemeteryCategory("standard");
    setAttributes(DEFAULT_ATTRIBUTES);
    setEstimateItems([]);
    setExternalExpenses([]);
    setMemorialData(DEFAULT_MEMORIAL_DATA);
    setSaving(false);
    setPublishing(false);
    setLastAutosavedState(JSON.stringify({
      form: DEFAULT_FORM,
      cemeteryCategory: "standard",
      attributes: DEFAULT_ATTRIBUTES,
      estimateItems: [],
      externalExpenses: [],
      memorialData: DEFAULT_MEMORIAL_DATA,
    }));
    setSaveError(message);
    return true;
  }

  async function saveVersion(options: { quiet?: boolean } = {}): Promise<number | null> {
    const authorityKey = quoteLoadKey;
    if (!quoteWritesAvailable || !hasCurrentQuoteAuthority(authorityKey)) {
      const message = quoteLoadFailed
        ? "Сначала восстановите загрузку канонической сметы. Локальные данные не записаны."
        : "Дождитесь загрузки сметы.";
      setSaveError(message);
      if (!options.quiet) toast({ type: "error", message });
      return null;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const requestId = crypto.randomUUID();
      const scenario = commercialScenarioFromForm(form);
      const lines = buildCommercialDraftLines({ result, estimateItems, externalExpenses, scenario });
      const res = await fetch(`/api/agent/meeting/${meetingId}/quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId,
          "X-Correlation-Id": requestId,
        },
        body: JSON.stringify({
          scenario,
          lines,
          editorState: { form, cemeteryCategory, attributes, estimateItems, externalExpenses, memorialData },
        }),
      });
      if (!hasCurrentQuoteAuthority(authorityKey)) return null;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error ?? "Не удалось сохранить смету. Попробуйте ещё раз.";
        setSaveError(msg);
        toast({ type: "error", message: msg });
        return null;
      } else {
        const data = await res.json();
        setQuoteId(data.quoteId);
        setCommercialStatus(data.status);
        setReviewResult({
          blockers: data.totals?.blockers ?? [],
          warnings: data.totals?.warnings ?? [],
          total: data.totals?.total ?? null,
          added: 0,
          removed: 0,
          changed: 0,
          totalDelta: null,
        });
        setCanonicalEconomics(liveEconomics);
        setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
        setLastAutosavedState(editorStateJson);
        if (!options.quiet) toast({ type: "success", message: "Черновик сохранён" });
        return data.quoteId as number;
      }
    } catch {
      if (!hasCurrentQuoteAuthority(authorityKey)) return null;
      setSaveError("Нет связи. Проверьте интернет и попробуйте снова.");
      toast({ type: "error", message: "Нет связи — смета не сохранена. Проверьте интернет." });
      return null;
    } finally {
      if (hasCurrentQuoteAuthority(authorityKey)) setSaving(false);
    }
  }
  useEffect(() => {
    autosaveHandler.current = saveVersion;
  });

  useEffect(() => {
    if (!quoteHydrated || quoteLoadFailed || editorStateJson === lastAutosavedState) return;
    const timer = window.setTimeout(() => {
      void autosaveHandler.current({ quiet: true });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [editorStateJson, lastAutosavedState, quoteHydrated, quoteLoadFailed]);

  async function startReview() {
    const authorityKey = quoteLoadKey;
    if (!hasCurrentQuoteAuthority(authorityKey)) return;
    const activeQuoteId = await saveVersion();
    if (!activeQuoteId || !hasCurrentQuoteAuthority(authorityKey)) return;
    setPublishing(true);
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/agent/quotes/${activeQuoteId}/review`, {
        method: "POST",
        headers: { "Idempotency-Key": requestId, "X-Correlation-Id": requestId },
      });
      const data = await response.json().catch(() => ({}));
      if (!hasCurrentQuoteAuthority(authorityKey)) return;
      if (!response.ok) throw new Error(data.error ?? "Не удалось подготовить проверку");
      setCommercialStatus(data.status);
      setReviewResult({
        blockers: data.totals?.blockers ?? [],
        warnings: data.totals?.warnings ?? [],
        total: data.totals?.total ?? null,
        added: data.diff?.added?.length ?? 0,
        removed: data.diff?.removed?.length ?? 0,
        changed: data.diff?.changed?.length ?? 0,
        totalDelta: data.totalDelta ?? null,
      });
      setCalculatorOpen(true);
      setCalculatorTab("actions");
    } catch (error) {
      if (!hasCurrentQuoteAuthority(authorityKey)) return;
      toast({ type: "error", message: error instanceof Error ? error.message : "Не удалось подготовить проверку" });
    } finally {
      if (hasCurrentQuoteAuthority(authorityKey)) setPublishing(false);
    }
  }

  async function publishQuote() {
    const authorityKey = quoteLoadKey;
    if (!quoteWritesAvailable || !quoteId || !hasCurrentQuoteAuthority(authorityKey)) {
      toast({ type: "error", message: "Сначала восстановите загрузку канонической сметы." });
      return;
    }
    setPublishing(true);
    const requestId = crypto.randomUUID();
    try {
      const validUntil = defaultCommercialExpiry();
      const response = await fetch(`/api/agent/quotes/${quoteId}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId,
          "X-Correlation-Id": requestId,
        },
        body: JSON.stringify({
          validUntil: validUntil.toISOString(),
          channel: "link",
          reason: "Передача семье после проверки состава и цен",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!hasCurrentQuoteAuthority(authorityKey)) return;
      if (!response.ok) throw new Error(data.error ?? "Публикация не выполнена");
      setCommercialStatus(data.status);
      setPublishedVersion(data.versionNumber);
      setReviewResult(null);
      if (!(await refreshVersionHistory(authorityKey))) return;
      toast({ type: "success", message: `Опубликована версия ${data.versionNumber}` });
    } catch (error) {
      if (!hasCurrentQuoteAuthority(authorityKey)) return;
      toast({ type: "error", message: error instanceof Error ? error.message : "Публикация не выполнена" });
    } finally {
      if (hasCurrentQuoteAuthority(authorityKey)) setPublishing(false);
    }
  }

  async function refreshVersionHistory(authorityKey: string) {
    try {
      const response = await fetch(`/api/agent/meeting/${meetingId}/quote`, { cache: "no-store" });
      if (!response.ok) throw new Error("history-load-failed");
      const data = await response.json();
      if (!hasCurrentQuoteAuthority(authorityKey)) return false;
      setVersionHistory(Array.isArray(data.quote?.history) ? data.quote.history : []);
      const canonicalVersion = data.quote?.draft ?? data.quote?.published;
      setCanonicalEconomics(
        canonicalVersion && Array.isArray(canonicalVersion.lines)
          ? calculateCommercialEconomics(canonicalVersion.lines, data.quote.scenario)
          : null,
      );
      return true;
    } catch {
      const message = "Смета опубликована, но канонические данные не обновились. Повторите загрузку.";
      if (invalidateCanonicalQuoteRead(authorityKey, message)) {
        toast({ type: "error", message });
      }
      return false;
    }
  }

  async function createClientLink() {
    const authorityKey = quoteLoadKey;
    if (!quoteWritesAvailable || !quoteId || !hasCurrentQuoteAuthority(authorityKey)) {
      toast({ type: "error", message: "Сначала восстановите загрузку канонической сметы." });
      return;
    }
    setPublishing(true);
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/agent/quotes/${quoteId}/link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestId,
          "X-Correlation-Id": requestId,
        },
        body: JSON.stringify({ expiresAt: defaultCommercialExpiry().toISOString() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!hasCurrentQuoteAuthority(authorityKey)) return;
      if (!response.ok) throw new Error(data.error ?? "Ссылка не создана");
      const url = `${window.location.origin}/co/${data.token}`;
      setClientLink(url);
      await navigator.clipboard.writeText(url);
      if (!hasCurrentQuoteAuthority(authorityKey)) return;
      setCopied(true);
      toast({ type: "success", message: "Защищённая ссылка скопирована" });
      setTimeout(() => {
        if (hasCurrentQuoteAuthority(authorityKey)) setCopied(false);
      }, 2000);
    } catch (error) {
      if (!hasCurrentQuoteAuthority(authorityKey)) return;
      toast({ type: "error", message: error instanceof Error ? error.message : "Ссылка не создана" });
    } finally {
      if (hasCurrentQuoteAuthority(authorityKey)) setPublishing(false);
    }
  }

  async function startPresentation() {
    const authorityKey = quoteLoadKey;
    if (!hasCurrentQuoteAuthority(authorityKey)) return;
    const activeQuoteId = await saveVersion();
    if (!activeQuoteId || !hasCurrentQuoteAuthority(authorityKey)) return;
    setPublishing(true);
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/agent/quotes/${activeQuoteId}/presentation`, {
        method: "POST",
        headers: { "Idempotency-Key": requestId, "X-Correlation-Id": requestId },
      });
      const data = await response.json().catch(() => ({}));
      if (!hasCurrentQuoteAuthority(authorityKey)) return;
      if (!response.ok) throw new Error(data.error ?? "Не удалось начать показ");
      window.open(`/agent/presentations/${data.presentationId}`, "_blank", "noopener,noreferrer");
    } catch (error) {
      if (!hasCurrentQuoteAuthority(authorityKey)) return;
      toast({ type: "error", message: error instanceof Error ? error.message : "Не удалось начать показ" });
    } finally {
      if (hasCurrentQuoteAuthority(authorityKey)) setPublishing(false);
    }
  }

  // «Изменить детали»: раскладывает выбранный тариф на позиции конструктора.
  // Гроб, зал, транспорт становятся обычными редактируемыми строками,
  // итог пересчитывается, дельта от цены тарифа видна у якоря.
  function editPackageDetails() {
    if (!selectedPackage) return;
    const hydrated = hydratePackage(selectedPackage, form);
    if (!hydrated) {
      setField("packageType", "custom");
      return;
    }
    setForm((f) => ({ ...f, ...hydrated.formPatch }));
    setEstimateItems((current) => [...withoutPackageItems(current), ...hydrated.items]);
    setBaseline({ id: selectedPackage.id, name: selectedPackage.name, price: selectedPackage.price });
    goToStep("basics");
  }

  function resetBaseline() {
    setBaseline(null);
    setEstimateItems((current) => withoutPackageItems(current));
  }

  return (
    <div className={s.root}>
      {/* ── Meeting header ──────────────────────────────── */}
      <div className={s.header}>
        <div className={s.headerLeft}>
          <span className={s.headerDot} />
          <div>
            <div className={s.headerBrand}>Конструктор сметы</div>
            <div className={s.headerSubtitle}>
              {caseId ? (
                <Link href={`/agent/cases/${caseId}`} className={s.headerCaseLink}>{clientName}</Link>
              ) : (
                clientName
              )}
            </div>
          </div>
        </div>
        <div className={s.headerRight}>
          <span className={s.headerCode} aria-live="polite">
            <span className={s.headerCodeLabel}>Статус</span>
            <span className={s.headerCodeValue}>
              {commercialStatus === "PUBLISHED" || commercialStatus === "ACCEPTED"
                ? `Опубликована v${publishedVersion ?? 1}`
                : commercialStatus === "IN_REVIEW"
                  ? "На проверке"
                  : "Черновик"}
            </span>
          </span>
        </div>
      </div>

      <section className={s.planShell} aria-label="Сводка плана">
        {quoteLoadFailed && (
          <div className={s.quoteLoadNotice} role="alert">
            <div>
              <strong>Каноническая смета недоступна</strong>
              <p>Локальный расчёт не будет сохранён, пока данные кейса не загрузятся.</p>
            </div>
            <button type="button" onClick={() => setQuoteLoadAttempt((attempt) => attempt + 1)}>
              Повторить загрузку
            </button>
          </div>
        )}
        <div className={s.planHero}>
          <div>
            <span className={s.planEyebrow}>План прощания</span>
            <h1 className={s.planTitle}>{planTitle}</h1>
            <p className={s.planSubtitle}>{planSubtitle}</p>
          </div>
          {(planMode === "package" || baseline) && (
            <div className={s.planTotal}>
              <span>Итого</span>
              <strong>{headlineTotal}</strong>
              {planMode === "custom" && baseline && baselineDelta !== null && baselineDelta !== 0 && (
                <em className={baselineDelta > 0 ? s.deltaUp : s.deltaDown}>
                  {formatDelta(baselineDelta)} к тарифу
                </em>
              )}
              {planMode === "custom" && baseline && (
                <button type="button" className={s.baselineReset} onClick={resetBaseline}>
                  Сбросить тариф
                </button>
              )}
            </div>
          )}
        </div>

        <div className={s.planModeSwitch} role="group" aria-label="Режим сборки сметы">
          <button
            type="button"
            className={`${s.planModeBtn} ${planMode === "package" ? s.planModeBtnActive : ""}`}
            onClick={() => {
              const firstPackage = relevantPackages[0];
              if (!firstPackage) return;
              // Возврат к тарифам: убираем тарифные позиции и form-поля раскладки,
              // иначе блоб тарифа задвоится с собственным содержимым.
              const returnTo = baseline?.id ?? firstPackage.id;
              setBaseline(null);
              setEstimateItems((current) => withoutPackageItems(current));
              setForm((f) => ({
                ...DEFAULT_FORM,
                serviceType: f.serviceType,
                clientBudget: f.clientBudget,
                cemetery: f.cemetery,
                packageType: returnTo,
              }));
            }}
          >
            Готовые решения
          </button>
          <button
            type="button"
            className={`${s.planModeBtn} ${planMode === "custom" ? s.planModeBtnActive : ""}`}
            onClick={() => setField("packageType", "custom")}
          >
            Собрать свой план
          </button>
        </div>

        {planMode === "package" ? (
          <>
            {/* Карусель тарифов как на B2C: полный состав виден без клика */}
            <div className={s.tariffCarousel} role="radiogroup" aria-label="Тарифы">
              {relevantPackages.map((p) => {
                const active = form.packageType === p.id;
                return (
                  <article key={p.id} className={`${s.tariffCard} ${active ? s.tariffCardActive : ""}`}>
                    {"popular" in p && p.popular && <span className={s.tariffBadge}>Чаще выбирают</span>}
                    <h3 className={s.tariffName}>{p.name}</h3>
                    <p className={s.tariffDesc}>{p.description}</p>
                    <p className={s.tariffPrice}>{formatCurrency(p.price)}</p>
                    <ul className={s.tariffFeatures}>
                      {p.features.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`${s.tariffPick} ${active ? s.tariffPickActive : ""}`}
                      onClick={() => setField("packageType", p.id)}
                    >
                      {active ? <><Check size={14} weight="bold" /> Выбран</> : "Выбрать"}
                    </button>
                  </article>
                );
              })}
            </div>

            <div className={s.planActions}>
              <button type="button" className={s.planPrimary} onClick={() => void saveVersion()} disabled={saving || !quoteWritesAvailable}>
                {saving ? "Сохраняю…" : "Сохранить план"}
              </button>
              <button type="button" className={s.planSecondary} onClick={editPackageDetails}>
                Изменить детали
              </button>
              <p>Тариф раскладывается на позиции. Любую можно заменить, итог пересчитается.</p>
            </div>
          </>
        ) : (
          <div className={s.b2cWizardIntro} aria-label="Этапы сборки плана">
            <div className={s.b2cStageRail}>
              {STEPS.map((stepItem, index) => {
                const active = step === stepItem.id;
                const done = !active && visited.has(stepItem.id);
                return (
                  <button
                    key={stepItem.id}
                    type="button"
                    className={`${s.b2cStageChip} ${active ? s.b2cStageChipActive : ""} ${done ? s.b2cStageChipDone : ""}`}
                    aria-current={active ? "step" : undefined}
                    onClick={() => goToStep(stepItem.id)}
                  >
                    <span>{done ? <Check size={12} weight="bold" /> : index + 1}</span>
                    <strong>{stepItem.label}</strong>
                  </button>
                );
              })}
            </div>

            <div className={s.b2cStageHead}>
              <div>
                <h2>{activeStep.label}</h2>
                <p>{activeStep.hint}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Main layout ────────────────────────────────── */}
      {planMode === "custom" && (
      <div className={`${s.layout} ${s.b2cWizardShell}`}>

        {/* ── Form ─────────────────────────────────────── */}
        <div className={s.form}>

          {step === "basics" && (<>
          {/* Service type */}
          <div className={s.card}>
            <p className={s.cardTitle}>Тип услуги</p>
            <div className={s.serviceToggle}>
              {(["burial", "cremation"] as const).map((t) => (
                <button
                  key={t}
                  className={`${s.serviceBtn} ${form.serviceType === t ? s.serviceBtnActive : ""}`}
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      serviceType: t,
                      packageType: "custom",
                      cemetery: "",
                    }));
                    // Тариф другого типа услуги теряет смысл - чистим якорь и его позиции
                    setBaseline(null);
                    setEstimateItems((current) => withoutPackageItems(current));
                  }}
                >
                  {t === "burial" ? "Погребение" : "Кремация"}
                </button>
              ))}
            </div>
            <div className={s.budgetField}>
              <label className={s.fieldLabel} htmlFor="client-budget">Бюджет клиента</label>
              <input
                id="client-budget"
                className={s.moneyInput}
                inputMode="numeric"
                value={form.clientBudget ? String(form.clientBudget) : ""}
                placeholder="Например, 130 000"
                onChange={(event) => setBudgetValue(event.target.value)}
              />
              <div className={s.fieldHint}>Необязательно. Нужно только для внутреннего расчёта агента.</div>
            </div>
          </div>

          {/* Format */}
          <div className={s.card}>
            <p className={s.cardTitle}>Формат прощания</p>

            <ToggleRow
              label="Зал прощания"
              hint="Церемония прощания с родными в отдельном зале"
              price={form.hasHall ? PRICES.hallDuration[form.hallDuration as keyof typeof PRICES.hallDuration] : undefined}
              checked={form.hasHall}
              onChange={(v) => setField("hasHall", v)}
            >
              <>
                <p className={s.fieldHint}>Рекомендуем 60-90 мин</p>
                <div className={s.durationGrid} role="radiogroup" aria-label="Длительность зала">
                  {([30, 60, 90] as const).map((min) => (
                    <button
                      key={min}
                      type="button"
                      role="radio"
                      aria-checked={form.hallDuration === min}
                      className={`${s.durationCard} ${form.hallDuration === min ? s.durationCardActive : ""}`}
                      onClick={() => setField("hallDuration", min)}
                    >
                      <span className={s.durationVal}>{min} мин</span>
                      <span className={s.durationPrice}>
                        {PRICES.hallDuration[min] > 0 ? `+${formatCurrency(PRICES.hallDuration[min])}` : "базово"}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            </ToggleRow>

            <div className={s.divider} />

            <p className={s.subLabel}>Тип церемонии</p>
            <div className={s.radioCards} role="radiogroup" aria-label="Тип церемонии">
              {(
                [
                  { v: "civil", l: "Гражданская", sub: "Без религиозных обрядов" },
                  { v: "religious", l: "Религиозная", sub: "С участием священнослужителя", delta: 15000 },
                  { v: "combined", l: "Комбинированная", sub: "Светская + религиозная часть", delta: 20000 },
                ] as { v: string; l: string; sub: string; delta?: number }[]
              ).map(({ v, l, sub, delta }) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={form.ceremonyType === v}
                  className={`${s.radioCard} ${form.ceremonyType === v ? s.radioCardActive : ""}`}
                  onClick={() => setField("ceremonyType", v)}
                >
                  <span className={s.radioDot} aria-hidden />
                  <span className={s.radioCardText}>
                    <span className={s.radioCardLabel}>{l}</span>
                    <span className={s.radioCardSub}>{sub}</span>
                  </span>
                  {delta ? <span className={s.radioCardPrice}>+{formatCurrency(delta)}</span> : null}
                </button>
              ))}
            </div>
          </div>
          </>)}

          {step === "logistics" && (<>
          {/* Logistics */}
          <div className={s.card}>
            <p className={s.cardTitle}>Логистика</p>

            <ToggleRow
              label="Катафалк"
              hint="Специализированный автомобиль для перевозки гроба"
              price={PRICES.hearse}
              checked={form.needsHearse}
              onChange={(v) => setField("needsHearse", v)}
            >
              {/* Маршрут как на B2C-wizard: агент проговаривает день по станциям */}
              <div>
                <p className={s.routeLabel}>Маршрут</p>
                <div className={s.routeChips} aria-label="Маршрут катафалка">
                  {[
                    "Морг",
                    ...(form.hasHall ? ["Зал прощания"] : []),
                    ...(form.ceremonyType !== "civil" ? ["Церковь"] : []),
                    form.serviceType === "cremation" ? "Крематорий" : "Кладбище",
                  ].map((stop, i) => (
                    <span key={stop} className="contents">
                      {i > 0 && <span className={s.routeArrow} aria-hidden><CaretRight size={12} weight="bold" /></span>}
                      <span className={s.routeChip}>{stop}</span>
                    </span>
                  ))}
                </div>
              </div>
            </ToggleRow>

            <div className={s.divider} />

            <ToggleRow
              label="Транспорт для близких"
              hint="Автобус или микроавтобус, чтобы семья ехала вместе"
              price={form.needsFamilyTransport ? PRICES.familyTransport[form.familyTransportSeats as keyof typeof PRICES.familyTransport] : undefined}
              checked={form.needsFamilyTransport}
              onChange={(v) => setField("needsFamilyTransport", v)}
            >
              <div className={s.pills}>
                {([5, 10, 15] as const).map((n) => (
                  <button
                    key={n}
                    className={`${s.pill} ${form.familyTransportSeats === n ? s.pillActive : ""}`}
                    onClick={() => setField("familyTransportSeats", n)}
                  >
                    {n} мест · {formatCurrency(PRICES.familyTransport[n])}
                  </button>
                ))}
              </div>
            </ToggleRow>

            <div className={s.divider} />

            <ToggleRow
              label="Носильщики"
              hint="Бригада для погрузки, выноса и заноса гроба"
              price={PRICES.pallbearers}
              checked={form.needsPallbearers}
              onChange={(v) => setField("needsPallbearers", v)}
            />
          </div>

          {/* Cemetery */}
          <div className={s.card}>
            <p className={s.cardTitle}>
              {form.serviceType === "cremation" ? "Крематорий" : "Место захоронения"}
            </p>

            <select
              className={s.select}
              value={form.cemetery}
              onChange={(e) => setField("cemetery", e.target.value)}
            >
              <option value="">- не выбрано -</option>
              {form.serviceType === "burial" ? (
                <>
                  <optgroup label="Москва">
                    {MOSCOW_CEMETERIES.filter((c) => c.type === "burial").map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Московская область">
                    {MO_CEMETERIES.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </optgroup>
                </>
              ) : (
                <optgroup label="Крематории Москвы">
                  {MOSCOW_CEMETERIES.filter((c) => c.type === "cremation").map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </optgroup>
              )}
            </select>

            {form.cemetery && (
              <div style={{ marginTop: 14 }}>
                <p className={s.subLabel}>Категория места</p>
                <div className={s.pills}>
                  {(
                    [
                      { v: "standard", l: "Стандарт" },
                      { v: "comfort", l: "Комфорт" },
                      { v: "premium", l: "Премиум" },
                    ] as const
                  ).map(({ v, l }) => {
                    const cem = visibleCemeteries.find((c) => c.name === form.cemetery);
                    const price = cem?.categories[v as keyof typeof cem.categories];
                    return (
                      <button
                        key={v}
                        className={`${s.pill} ${cemeteryCategory === v ? s.pillActive : ""}`}
                        onClick={() => setCemeteryCategory(v)}
                      >
                        {l}{price ? ` · ${formatCurrency(price)}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Additional services */}
          <div className={s.card}>
            <p className={s.cardTitle}>Дополнительные услуги</p>
            <div className={s.svcList}>
              {ADDITIONAL_SERVICES.map((svc) => {
                const on = form.selectedAdditionalServices.includes(svc.id);
                return (
                  <button
                    type="button"
                    key={svc.id}
                    role="checkbox"
                    aria-checked={on}
                    className={`${s.svcItem} ${on ? s.svcItemActive : ""}`}
                    onClick={() => toggleService(svc.id)}
                  >
                    <span className={`${s.svcCheck} ${on ? s.svcCheckOn : ""}`} aria-hidden="true">
                      {on && "✓"}
                    </span>
                    <span className={s.svcName}>{svc.name}</span>
                    <span className={s.svcPrice}>{formatCurrency(svc.price)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          </>)}

          {step === "attributes" && (
          <div className={s.card}>
            <div className={s.catalogIntro}>
              <div>
                <p className={s.cardTitle}>Атрибутика</p>
                <p className={s.catalogSubtitle}>Предметы комплекта: гроб, постель, венки, кресты, таблички и урны.</p>
              </div>
              <span className={s.catalogCount}>{filteredCatalogItems.length}</span>
            </div>

            {/* Перенос подборки из маркетплейса в эту смету */}
            {shortlistPending.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-[12px] border border-accent/45 bg-accent-soft px-3.5 py-2.5">
                <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
                  В подборке из каталога <b>{shortlistPending.length}</b>{" "}
                  {shortlistPending.length === 1 ? "новая позиция" : "новых позиций"}. Добавить в эту смету?
                </span>
                <button
                  type="button"
                  onClick={importShortlistToEstimate}
                  className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-[12px] font-semibold text-on-accent transition-[filter] hover:brightness-95"
                >
                  <Check size={13} weight="bold" /> Добавить в смету
                </button>
              </div>
            )}

            {/* Живая визуализация комплекта - собирается из выбранных позиций сметы */}
            <div className={s.configuratorSlot}>
              <div className={s.previewShell}>
                <div className={s.previewHead}>
                  <p className="text-[13px] font-semibold text-ink">Визуализация комплекта</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">Обновляется при выборе атрибутики.</p>
                </div>
                <AttributeRender selection={attributes} selectedItems={estimateItems} className="block w-full" />
              </div>
            </div>

            <div className={s.categoryRail} aria-label="Категории каталога">
              {visibleCategories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`${s.categoryChip} ${activeCategory === category ? s.categoryChipActive : ""}`}
                  onClick={() => setCatalogCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
            {catalogLoadError && (
              <div role="alert" className={s.inlineError}>
                {catalogLoadError} Базовый каталог доступен, собственные позиции можно повторно загрузить позже.
              </div>
            )}

            {visibleCategories.map((cat) => {
              const items = filteredCatalogItems.filter((i) => i.category === cat);
              if (!items.length) return null;
              return (
                <div key={cat} className={s.pickerGroup}>
                  <p className={s.pickerGroupTitle}>
                    {cat}
                    <span className={s.pickerGroupHint}>{SINGLE_CATEGORIES.has(cat) ? "выберите один" : "можно несколько"}</span>
                  </p>
                  <div className={s.optGrid}>
                    {items.map((item) => (
                      <OptionCard
                        key={item.id}
                        item={item}
                        selected={isCatalogSelected(item)}
                        selectedColor={getSelectedCatalogColor(item)}
                        onToggle={() => toggleCatalogItem(item)}
                        onColorChange={(color) => changeCatalogColor(item, color)}
                        onRequestPrice={item.id.startsWith("custom-") ? () => void requestCatalogPrice(item) : undefined}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          )}

          {step === "memorial" && (
          <div>
            <MemorialBlock
              data={memorialData}
              onCommentChange={(comment) => setMemorialData((current) => ({ ...current, comment }))}
              onGuestsChange={setMemorialGuests}
              onIncludeCafeChange={setCafeAssistanceIncluded}
              onStatusChange={setMemorialStatus}
            />
          </div>

          )}

          {step === "expenses" && (
          <div>
            <ExternalExpensesBlock
              draft={expenseDraft}
              expenses={externalExpenses}
              onAddDraft={() => addExternalExpense(expenseDraft)}
              onAddPreset={addExpensePreset}
              onDraftFieldChange={setExpenseDraftField}
              onDraftMoneyChange={setExpenseDraftMoney}
              onRemove={removeExternalExpense}
              onUpdate={updateExternalExpense}
            />
          </div>
          )}

          {/* Навигация по шагам */}
          <div className={s.stepFooter} data-tour="quote-nav">
            {prevStep ? (
              <button type="button" className={s.stepBack} onClick={() => goToStep(prevStep.id)}>
                <CaretLeft size={14} weight="bold" /> {prevStep.label}
              </button>
            ) : (
              <span />
            )}
            <button type="button" className={s.stepTotal} onClick={() => setCalculatorOpen(true)}>
              <span>Шаг {stepIndex + 1} из {STEPS.length}</span>
              <strong>{headlineTotal}</strong>
            </button>
            {nextStep ? (
              <button type="button" className={s.stepForward} onClick={() => goToStep(nextStep.id)}>
                Далее: {nextStep.label} <CaretRight size={14} weight="bold" />
              </button>
            ) : (
              <button
                type="button"
                className={`${s.stepForward} ${s.stepForwardDone}`}
                onClick={() => void saveVersion()}
                disabled={saving || !quoteWritesAvailable}
              >
                {saving ? "Сохраняю…" : "Готово - сохранить смету"}
                {!saving && <Check size={14} weight="bold" />}
              </button>
            )}
          </div>

        </div>

        <div className={s.mobileBar} data-tour="quote-summary">
          <button
            type="button"
            className={s.mobileBarSum}
            onClick={() => setCalculatorOpen(true)}
            aria-label="Открыть детали сметы"
          >
            <span className={s.mobileBarLabel}>Предварительно</span>
            <span className={s.mobileBarAmount} data-testid="quote-visible-total">{headlineTotal}</span>
            <span className={s.mobileBarMeta}>{calculatorLineCount} услуг · {calculatorVersionLabel}</span>
            <span className={`${s.mobileBarStatus} ${s[`mobileBarStatus_${calculatorStatus.tone}`]}`}>
              {calculatorStatus.text}
            </span>
            <span className={s.mobileBarMore}>Подробнее</span>
          </button>
          <button type="button" className={s.mobileBarBtn} onClick={() => void saveVersion()} disabled={saving || !quoteWritesAvailable}>
            {saving ? "Сохраняю..." : "Сохранить"}
          </button>
        </div>

        {calculatorOpen && (
          <button
            type="button"
            className={s.sheetBackdrop}
            aria-label="Свернуть калькулятор"
            onClick={() => setCalculatorOpen(false)}
          />
        )}

        {/* ── Floating calculator sheet ────────────────── */}
        <aside className={`${s.panel} ${calculatorOpen ? s.panelOpen : ""}`} aria-label="Детали сметы">
          <div className={s.panelCard}>
            <div className={s.panelChrome}>
              <div className={s.panelHero}>
                <div>
                  <span className={s.panelHeroLabel}>Предварительно</span>
                  <span className={s.panelHeroAmount}>{headlineTotal}</span>
                  <span className={s.panelHeroMeta}>{calculatorLineCount} услуг · {calculatorVersionLabel}</span>
                </div>
                <button type="button" className={s.sheetClose} onClick={() => setCalculatorOpen(false)} aria-label="Свернуть калькулятор">
                  <X size={18} weight="bold" />
                </button>
              </div>

              <div className={s.panelHead}>
                <span className={s.panelHeadTitle}>Детали сметы</span>
                <span className={`${s.panelStatus} ${s[`panelStatus_${calculatorStatus.tone}`]}`}>
                  {calculatorStatus.text}
                </span>
                {savedAt && (
                  <span className={s.panelVersions}>сохранено в {savedAt}</span>
                )}
              </div>

              <div className={s.sheetTabs} role="tablist" aria-label="Разделы калькулятора">
                {[
                  ["composition", "Состав"],
                  ["economics", "Экономика"],
                  ["versions", "Версии"],
                  ["actions", "Действия"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={calculatorTab === id}
                    className={`${s.sheetTab} ${calculatorTab === id ? s.sheetTabActive : ""}`}
                    onClick={() => setCalculatorTab(id as CalculatorTab)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {calculatorTab === "composition" && (
              <div className={s.panelSections}>
                {result.sections.length === 0 ? (
                  <div className={s.panelEmpty}>
                    Выберите услуги слева, смета появится здесь
                  </div>
                ) : (
                  result.sections.map((section: CalculationSection) => (
                    <div key={section.title} className={s.panelSection}>
                      <div className={s.panelSectionHead}>
                        <span>{section.title}</span>
                        <span className={s.panelSectionAmt}>{formatCurrency(section.total)}</span>
                      </div>
                      {section.items?.map((item) => (
                        <div key={item.label} className={s.panelItem}>
                          <span>{item.label}</span>
                          {item.price != null ? (
                            <span>{formatCurrency(item.price)}</span>
                          ) : (
                            <span className={s.panelItemIncluded}>включено</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))
                )}

                {estimateItems.length > 0 && (
                  <div className={s.panelSection}>
                    <div className={s.panelSectionHead}>
                      <span>Атрибутика</span>
                      <span className={s.panelSectionAmt}>
                        {estimatePricesKnown ? formatCurrency(estimateTotal) : "Цена требует уточнения"}
                      </span>
                    </div>
                    <div className={s.estimateList}>
                      {estimateItems.map((item) => (
                        <EstimateItemRow
                          key={item.id}
                          item={item}
                          onPriceChange={(value) => changeEstimatePrice(item.id, value)}
                          onQuantityChange={(quantity) => changeEstimateQuantity(item.id, quantity)}
                          onRemove={() => deleteEstimateItem(item.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {externalExpenses.length > 0 && (
                  <div className={s.panelSection}>
                    <div className={s.panelSectionHead}>
                      <span>Внешние расходы</span>
                      <span className={s.panelSectionAmt}>
                        {externalPricesKnown ? formatCurrency(externalTotal) : "Цена требует уточнения"}
                      </span>
                    </div>
                    <div className={s.externalSummaryList}>
                      {externalExpenses.map((expense) => {
                        const costKnown = expense.includeInMarginCalculation && expense.costPrice > 0;
                        const expenseMargin = costKnown
                          ? calculateOrderEconomics([
                              {
                                name: expense.name,
                                category: expense.category,
                                clientPrice: expense.includeInClientTotal ? expense.clientPrice : 0,
                                costPrice: expense.costPrice,
                                quantity: 1,
                              },
                            ]).items[0]
                          : null;
                        return (
                          <div key={expense.id} className={s.externalSummaryItem}>
                            <div>
                              <span>{expense.category}</span>
                              <strong>{expense.name}</strong>
                              {expense.comment && <em>{expense.comment}</em>}
                            </div>
                            <div className={s.externalSummaryNumbers}>
                              <span className={s.externalSummaryClient}>
                                {formatCurrency(expense.includeInClientTotal ? expense.clientPrice : 0)}
                              </span>
                              <span className={s.externalSummaryMeta}>
                                {costKnown && expenseMargin
                                  ? `с/с ${formatCurrency(expense.costPrice)} · маржа ${formatCurrency(expenseMargin.marginRub)}`
                                  : "Себестоимость не подтверждена"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {calculatorTab === "economics" && (
              <div className={s.sheetPane}>
                <AgentEconomicsBlock
                  budgetMessage={budgetMessage}
                  budgetStatus={budgetStatus.status}
                  clientBudgetMinor={budgetStatus.clientBudget == null ? null : Math.round(budgetStatus.clientBudget * 100)}
                  budgetRemainingMinor={
                    budgetStatus.status === "unknown_total" || budgetStatus.status === "not_set"
                      ? null
                      : Math.round(budgetStatus.budgetRemaining * 100)
                  }
                  economics={economics}
                  marginWarning={marginWarning}
                />
              </div>
            )}

            {calculatorTab === "versions" && (
              <div className={s.sheetPane}>
                <QuoteVersionHistory versions={versionHistory} />
              </div>
            )}

            {calculatorTab === "actions" && (
              <div className={s.panelActions} data-tour="quote-summary">
                <button
                  className={s.saveBtn}
                  onClick={() => void saveVersion()}
                  disabled={saving || publishing || !quoteWritesAvailable}
                >
                  {saving ? "Сохраняю..." : "Сохранить черновик"}
                </button>
                <button type="button" className={s.secondaryActionBtn} onClick={startPresentation} disabled={saving || publishing || !quoteWritesAvailable}>
                  <Eye size={15} weight="fill" /> Открыть режим презентации
                </button>

                {(commercialStatus === "DRAFT" || commercialStatus === "REJECTED") && (
                  <button type="button" className={s.secondaryActionBtn} onClick={startReview} disabled={saving || publishing || !quoteWritesAvailable}>
                    <Eye size={15} weight="fill" /> Проверить перед публикацией
                  </button>
                )}

                {/*
                  Blockers used to appear only once the quote reached IN_REVIEW, so while
                  editing the agent saw an unconfirmed total with no explanation of what was
                  missing. Surface the live blockers next to the headline instead.
                */}
                {commercialStatus !== "IN_REVIEW" && commercialTotals.blockers.length > 0 && (
                  <div className={s.commercialBlockers} aria-live="polite">
                    <strong>Итог не подтверждён</strong>
                    {commercialTotals.blockers.map((message) => <p key={message}>{message}</p>)}
                  </div>
                )}
                {commercialStatus === "IN_REVIEW" && reviewResult && (
                  <section className={s.commercialReview} aria-live="polite">
                    <div className={s.commercialReviewHead}>
                      <strong>Проверка публикации</strong>
                      <span>{reviewResult.total == null ? "Итог не подтверждён" : formatMinorUnitsCurrency(reviewResult.total)}</span>
                    </div>
                    <div className={s.reviewDiff} aria-label="Изменения относительно опубликованной версии">
                      <span>Добавлено: {reviewResult.added}</span>
                      <span>Убрано: {reviewResult.removed}</span>
                      <span>Изменено: {reviewResult.changed}</span>
                      {reviewResult.totalDelta !== null && (
                        <strong>Итог: {reviewResult.totalDelta >= 0 ? "+" : ""}{formatMinorUnitsCurrency(reviewResult.totalDelta)}</strong>
                      )}
                    </div>
                    {reviewResult.blockers.length > 0 ? (
                      <div className={s.commercialBlockers}>
                        <strong>Публикация заблокирована</strong>
                        {reviewResult.blockers.map((message) => <p key={message}>{message}</p>)}
                      </div>
                    ) : (
                      <p className={s.commercialReady}>Состав и цены подтверждены. После публикации версия станет неизменяемой.</p>
                    )}
                    {reviewResult.warnings.map((message) => <p key={message} className={s.commercialWarning}>{message}</p>)}
                    <button
                      type="button"
                      className={s.publishBtn}
                      onClick={publishQuote}
                      disabled={publishing || !quoteWritesAvailable || reviewResult.blockers.length > 0}
                    >
                      {publishing ? "Публикую..." : "Опубликовать версию"}
                    </button>
                  </section>
                )}

                {(commercialStatus === "PUBLISHED" || commercialStatus === "ACCEPTED") && (
                  <>
                    <button type="button" className={s.secondaryActionBtn} onClick={createClientLink} disabled={publishing || !quoteWritesAvailable}>
                      <PaperPlaneTilt size={15} weight="fill" /> Создать ссылку для семьи
                    </button>
                    {clientLink && (
                      <>
                        <button type="button" className={s.secondaryActionBtn} onClick={copyClientLink}>
                          <Copy size={15} weight="fill" /> {copied ? "Ссылка скопирована" : "Скопировать ссылку"}
                        </button>
                        <a href={clientLink} target="_blank" rel="noreferrer" className={s.secondaryActionLink}>
                          <Eye size={15} weight="fill" /> Открыть клиентскую версию
                        </a>
                      </>
                    )}
                  </>
                )}

                {savedAt && !saveError && (
                  <div className={s.savedMsg}>
                    <Check size={14} weight="bold" />
                    Черновик сохранён в {savedAt}
                  </div>
                )}
                {saveError && <div className={s.errorMsg}>{saveError}</div>}
              </div>
            )}

            <div className={s.sheetFooter}>
              <button
                type="button"
                className={s.sheetFooterSummary}
                onClick={() => setCalculatorTab("composition")}
                aria-label="Открыть состав сметы"
              >
                <span>Итого</span>
                <strong>{headlineTotal}</strong>
              </button>
              <button
                type="button"
                className={s.sheetFooterSave}
                data-testid="quote-sheet-save"
                onClick={() => void saveVersion()}
                disabled={saving || !quoteWritesAvailable}
              >
                {saving ? "Сохраняю..." : "Сохранить"}
              </button>
            </div>
          </div>
        </aside>

      </div>
      )}
    </div>
  );
}

// Sub-components extracted to ./components/
