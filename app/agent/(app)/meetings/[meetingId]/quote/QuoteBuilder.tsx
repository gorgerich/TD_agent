"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { Check, CaretLeft, CaretRight, Copy, Eye, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import s from "./QuoteBuilder.module.css";
import {
  type FormData,
  type CalculationSection,
  type MarginItemInput,
  type CatalogCategory,
  type CatalogItem,
  type EstimateItem,
  type MemorialData,
  type MemorialStatus,
  type ExternalExpense,
  type EstimateSnapshot,
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
  estimateItemsToMarginInputs,
  externalExpensesToMarginInputs,
  toPublicEstimateItems,
  toPublicExternalExpenses,
  createExternalExpense,
  createEstimateSnapshot,
  formatCurrency,
  PRICES,
  PACKAGES,
  ADDITIONAL_SERVICES,
  AGENT_ATTRIBUTION_CATALOG,
  DEFAULT_MEMORIAL_DATA,
  EXTERNAL_EXPENSE_PRESETS,
  MOSCOW_CEMETERIES,
  MO_CEMETERIES,
  DEFAULT_CALCULATOR_CONFIG,
} from "@/lib/calculationUtils";
import { DEFAULT_ATTRIBUTES, type AttrSelection } from "@/lib/attributes";
import RitualConfigurator from "@/components/configurator/RitualConfigurator";
import { ToggleRow } from "./components/ToggleRow";
import { MemorialBlock } from "./components/MemorialBlock";
import { EstimateItemRow } from "./components/EstimateItemRow";
import { OptionCard } from "./components/OptionCard";
import { ExternalExpensesBlock } from "./components/ExternalExpensesBlock";
import { AgentEconomicsBlock } from "./components/AgentEconomicsBlock";
import { SnapshotBlock } from "./components/SnapshotBlock";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Props {
  meetingId: number;
  cobrowseCode: string | null;
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

const ATTRIBUTION_CATEGORIES: CatalogCategory[] = [
  "Гробы",
  "Постель / комплект в гроб",
  "Венки",
  "Кресты / таблички",
  "Урны",
];

type Step = "basics" | "logistics" | "attributes" | "memorial" | "expenses";
type CalculatorTab = "composition" | "economics" | "versions" | "actions";

const STEPS: Array<{ id: Step; label: string; hint: string }> = [
  { id: "basics", label: "Основное", hint: "Тип услуги, бюджет, пакет и формат церемонии." },
  { id: "logistics", label: "Логистика", hint: "Транспорт, носильщики, место захоронения и доп. услуги." },
  { id: "attributes", label: "Атрибутика", hint: "Гроб, постель, венки, кресты, таблички и урны." },
  { id: "memorial", label: "Поминки", hint: "Нужны ли поминки и помощь агента с подбором кафе." },
  { id: "expenses", label: "Расходы", hint: "Внешние расходы: морг, кладбище, крематорий, церковь." },
];

/* ─── Main component ─────────────────────────────────────────────────── */

export default function QuoteBuilder({ meetingId, cobrowseCode, clientName, caseId }: Props) {
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [cemeteryCategory, setCemeteryCategory] = useState("standard");
  const [attributes, setAttributes] = useState<AttrSelection>(DEFAULT_ATTRIBUTES);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const [catalogCategory, setCatalogCategory] = useState<CatalogCategory | "Все">("Все");
  const [catalogColors, setCatalogColors] = useState<Record<string, string>>({});
  const [estimateItems, setEstimateItems] = useState<EstimateItem[]>([]);
  const [memorialData, setMemorialData] = useState<MemorialData>(DEFAULT_MEMORIAL_DATA);
  const [externalExpenses, setExternalExpenses] = useState<ExternalExpense[]>([]);
  const [expenseDraft, setExpenseDraft] = useState<ExternalExpense>(
    createExternalExpense({ id: "draft", name: "", category: "Морг", clientPrice: 0, costPrice: 0 }),
  );
  const [snapshots, setSnapshots] = useState<EstimateSnapshot[]>([]);
  const [snapshotTitle, setSnapshotTitle] = useState("");
  const [snapshotNote, setSnapshotNote] = useState("");
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [openSnapshotId, setOpenSnapshotId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("basics");
  const [visited, setVisited] = useState<Set<Step>>(() => new Set<Step>(["basics"]));
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [calculatorTab, setCalculatorTab] = useState<CalculatorTab>("composition");

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
  const grandTotal = result.total + estimateTotal + externalTotal;
  const baseLineCount = useMemo(
    () => result.sections.reduce((sum, section) => sum + (section.items?.length ?? (section.total > 0 ? 1 : 0)), 0),
    [result.sections],
  );
  const calculatorLineCount = baseLineCount + estimateItems.length + externalExpenses.length;
  const calculatorVersionLabel = savedCount > 0 ? `v${savedCount}` : "черновик";
  const filteredCatalogItems = useMemo(
    () => {
      const attributionItems = AGENT_ATTRIBUTION_CATALOG.filter((item) => ATTRIBUTION_CATEGORIES.includes(item.category));
      return catalogCategory === "Все"
        ? attributionItems
        : attributionItems.filter((item) => item.category === catalogCategory);
    },
    [catalogCategory],
  );
  const marginItems = useMemo<MarginItemInput[]>(() => {
    const sectionItems = result.sections.flatMap((section) => {
      const pricedItems =
        section.items
          ?.filter((item) => !item.included && (item.price ?? 0) > 0)
          .map((item) => ({
            name: item.label,
            category: item.category ?? section.title,
            clientPrice: item.clientPrice ?? item.price ?? 0,
            costPrice: item.costPrice ?? 0,
            quantity: item.quantity ?? 1,
          })) ?? [];

      if (pricedItems.length > 0) return pricedItems;
      if (section.total <= 0) return [];

      return [
        {
          name: section.title,
          category: section.title,
          clientPrice: section.total,
          costPrice: section.costTotal ?? 0,
          quantity: 1,
        },
      ];
    });

    return [
      ...sectionItems,
      ...estimateItemsToMarginInputs(estimateItems),
      ...externalExpensesToMarginInputs(externalExpenses),
    ];
  }, [result.sections, estimateItems, externalExpenses]);
  const economics = useMemo(() => calculateOrderEconomics(marginItems), [marginItems]);
  const budgetStatus = useMemo(
    () => calculateBudgetStatus(economics.orderClientTotal, form.clientBudget),
    [economics.orderClientTotal, form.clientBudget],
  );
  const itemMarginAlert = useMemo(() => {
    const worstMarginPercent = Math.min(...economics.items.map((item) => item.marginPercent), Number.POSITIVE_INFINITY);
    if (economics.items.some((item) => item.marginRub < 0)) return "negative";
    if (worstMarginPercent < 5) return "critical";
    if (worstMarginPercent < 15) return "low";
    return null;
  }, [economics.items]);
  const marginWarning =
    economics.orderMarginRub < 0 || itemMarginAlert === "negative"
      ? "Внимание: цена ниже себестоимости"
      : economics.orderMarginPercent < 5 || itemMarginAlert === "critical"
        ? "Критически низкая маржа: сделка почти без прибыли"
        : economics.orderMarginPercent < 15 || itemMarginAlert === "low"
          ? "Низкая маржа: проверьте цену или себестоимость"
          : null;
  const calculatorStatus =
    budgetStatus.status === "exceeded"
      ? { tone: "danger" as const, text: `Бюджет +${formatCurrency(Math.abs(budgetStatus.budgetRemaining))}` }
      : marginWarning
        ? { tone: "warning" as const, text: "Проверьте экономику" }
        : budgetStatus.status === "near_limit"
          ? { tone: "warning" as const, text: "Бюджет почти выбран" }
          : { tone: "ok" as const, text: "Можно сохранять" };
  const budgetMessage =
    budgetStatus.status === "not_set"
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
  const planTitle = selectedPackage ? `Тариф «${selectedPackage.name}»` : "План по позициям";
  const planSubtitle = planMode === "custom"
    ? "Базовый план можно расширить атрибутикой, транспортом, поминками и внешними расходами."
    : "Готовый набор услуг. Детали можно изменить под разговор с семьёй.";
  const planRows = [
    ...result.sections
      .filter((section) => section.total > 0 || (section.items?.length ?? 0) > 0)
      .map((section) => ({
        key: `section-${section.title}`,
        title: section.title,
        total: section.total,
        details: section.items?.slice(0, 6).map((item) =>
          item.included ? `${item.label} · включено` : item.price != null ? `${item.label} · ${formatCurrency(item.price)}` : item.label,
        ) ?? [],
      })),
    ...(estimateItems.length > 0 ? [{
      key: "estimate-items",
      title: "Атрибутика",
      total: estimateTotal,
      details: estimateItems.slice(0, 6).map((item) =>
        `${item.name}${item.selectedColor ? ` · ${item.selectedColor}` : ""}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`,
      ),
    }] : []),
    ...(externalExpenses.length > 0 ? [{
      key: "external-expenses",
      title: "Внешние расходы",
      total: externalTotal,
      details: externalExpenses.slice(0, 6).map((expense) => `${expense.category}: ${expense.name}`),
    }] : []),
  ];

  const visibleCemeteries =
    form.serviceType === "cremation"
      ? MOSCOW_CEMETERIES.filter((c) => c.type === "cremation")
      : [
          ...MOSCOW_CEMETERIES.filter((c) => c.type === "burial"),
          ...MO_CEMETERIES,
        ];

  // Co-work sync: атрибутика теперь ведётся через сметные позиции, старый
  // attributes payload сохраняем только для совместимости с ранними сессиями.
  const attrJson = JSON.stringify(attributes);

  useEffect(() => {
    if (!calculatorOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCalculatorOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [calculatorOpen]);

  // Push: общее состояние (форма + атрибутика) через 400мс после изменения.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/agent/meeting/${meetingId}/session`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form,
          cemeteryCategory,
          attributes,
          estimateItems: toPublicEstimateItems(estimateItems),
          externalExpenses: toPublicExternalExpenses(externalExpenses),
        }),
      }).catch(() => {});
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [form, cemeteryCategory, attributes, estimateItems, externalExpenses, meetingId]);

  // Poll: оставлен только для совместимости со старыми co-view сессиями.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/meeting/${meetingId}/session`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const remote = data?.state?.attributes;
        if (!remote) return;
        if (JSON.stringify(remote) !== attrJson) {
          setAttributes(remote);
        }
      } catch { /* ignore */ }
    }, 2500);
    return () => clearInterval(id);
  }, [meetingId, attrJson]);

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
      const base = SINGLE_CATEGORIES.has(item.category) ? current.filter((e) => e.category !== item.category) : current;
      return addCatalogItemToEstimate(base, item, getSelectedCatalogColor(item));
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

  function fixSnapshot() {
    setSnapshotError(null);
    if (estimateItems.length === 0 && externalExpenses.length === 0) {
      setSnapshotError("Добавьте хотя бы одну позицию или внешний расход, чтобы зафиксировать смету.");
      return;
    }

    const number = snapshots.length + 1;
    const snapshot = createEstimateSnapshot({
      title: snapshotTitle.trim() || `Версия ${number}`,
      note: snapshotNote.trim(),
      items: estimateItems,
      externalExpenses,
      memorialData,
      economics,
      clientBudget: form.clientBudget,
      budgetStatus,
    });
    setSnapshots((current) => [snapshot, ...current]);
    setOpenSnapshotId(snapshot.id);
    setSnapshotTitle("");
    setSnapshotNote("");
    setCalculatorTab("versions");
  }

  function deleteSnapshot(id: string) {
    setSnapshots((current) => current.filter((snapshot) => snapshot.id !== id));
    setOpenSnapshotId((current) => (current === id ? null : current));
  }

  function copyCode() {
    if (!cobrowseCode) return;
    navigator.clipboard.writeText(cobrowseCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function copyClientLink() {
    if (!cobrowseCode || typeof window === "undefined") return;
    navigator.clipboard.writeText(`${window.location.origin}/co/${cobrowseCode}`).then(() => {
      setCopied(true);
      toast({ type: "success", message: "Ссылка скопирована" });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function saveVersion() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/agent/meeting/${meetingId}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: { form, attributes, estimateItems }, total: grandTotal }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data.error ?? "Ошибка сохранения";
        setSaveError(msg);
        toast({ type: "error", message: msg });
      } else {
        setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
        setSavedCount((n) => n + 1);
        toast({ type: "success", message: "Смета сохранена" });
      }
    } catch {
      setSaveError("Сеть недоступна");
      toast({ type: "error", message: "Сеть недоступна - смета не сохранена" });
    } finally {
      setSaving(false);
    }
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
          {cobrowseCode && (
            <button onClick={copyCode} className={s.headerCode} aria-label="Скопировать код клиента">
              <span className={s.headerCodeLabel}>Код</span>
              <span className={s.headerCodeValue}>
                {cobrowseCode}
                {copied && <span className={s.copiedBadge}>скопировано</span>}
              </span>
            </button>
          )}
          {cobrowseCode && (
            <a href={`/co/${cobrowseCode}`} target="_blank" rel="noreferrer" className={s.showClientBtn}>
              Показать клиенту
            </a>
          )}
        </div>
      </div>

      <section className={s.planShell} aria-label="Сводка плана">
        <div className={s.planHero}>
          <div>
            <span className={s.planEyebrow}>План прощания</span>
            <h1 className={s.planTitle}>{planTitle}</h1>
            <p className={s.planSubtitle}>{planSubtitle}</p>
          </div>
          {planMode === "package" && (
            <div className={s.planTotal}>
              <span>Итого</span>
              <strong>{formatCurrency(grandTotal)}</strong>
            </div>
          )}
        </div>

        <div className={s.planModeSwitch} role="group" aria-label="Режим сборки сметы">
          <button
            type="button"
            className={`${s.planModeBtn} ${planMode === "package" ? s.planModeBtnActive : ""}`}
            onClick={() => {
              const firstPackage = relevantPackages[0];
              if (firstPackage) setField("packageType", firstPackage.id);
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
          <p>{planMode === "custom" ? "Агент собирает смету по позициям. Клиент видит понятный состав и итог." : "Можно начать с тарифа, затем изменить детали под клиента."}</p>
        </div>

        {planMode === "package" ? (
          <>
            <div className={s.planRows}>
              {planRows.length === 0 ? (
                <div className={s.planEmpty}>Выберите услуги, и план появится здесь.</div>
              ) : (
                planRows.map((row) => (
                  <div key={row.key} className={s.planRow}>
                    <div>
                      <span>{row.title}</span>
                      {row.details.length > 0 && (
                        <ul>
                          {row.details.map((detail) => <li key={detail}>{detail}</li>)}
                        </ul>
                      )}
                    </div>
                    <strong>{formatCurrency(row.total)}</strong>
                  </div>
                ))
              )}
            </div>

            <div className={s.planActions}>
              <button type="button" className={s.planPrimary} onClick={() => setField("packageType", "custom")}>
                Изменить детали
              </button>
              <button type="button" className={s.planSecondary} onClick={saveVersion} disabled={saving}>
                {saving ? "Сохраняю…" : "Сохранить план"}
              </button>
              <p>Оплата не требуется. Сначала агент фиксирует договорённости, затем отправляет клиентскую ссылку.</p>
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
              <span className={s.b2cStageNumber}>{stepIndex + 1}</span>
              <div>
                <span className={s.b2cStageKicker}>Этап {stepIndex + 1}: {activeStep.label}</span>
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
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      serviceType: t,
                      packageType: "custom",
                      cemetery: "",
                    }))
                  }
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

          {/* Package */}
          <div className={s.card}>
            <p className={s.cardTitle}>Пакет</p>
            <div className={s.packageGrid}>
              {/* "No package" card */}
              <button
                type="button"
                aria-pressed={form.packageType === "custom"}
                className={`${s.pkgCard} ${s.pkgCardCustom} ${form.packageType === "custom" ? s.pkgCardActive : ""}`}
                onClick={() => setField("packageType", "custom")}
              >
                <div className={s.pkgName}>Без пакета</div>
                <div className={s.pkgCustomLabel}>позиционно</div>
              </button>

              {relevantPackages.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  aria-pressed={form.packageType === p.id}
                  className={`${s.pkgCard} ${form.packageType === p.id ? s.pkgCardActive : ""}`}
                  onClick={() => setField("packageType", p.id)}
                >
                  {"popular" in p && p.popular && (
                    <span className={s.pkgBadge}>Чаще выбирают</span>
                  )}
                  <div className={s.pkgName}>{p.name}</div>
                  <div className={s.pkgPrice}>{formatCurrency(p.price)}</div>
                  {/* Состав как на B2C-wizard: видно, что внутри, без клика */}
                  {p.features.length > 0 && (
                    <ul className={s.pkgFeatures}>
                      {p.features.slice(0, 3).map((f) => <li key={f}>{f}</li>)}
                      {p.features.length > 3 && <li>и ещё {p.features.length - 3}</li>}
                    </ul>
                  )}
                </button>
              ))}
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

            {/* Большое превью комплекта + разворот на весь экран */}
            <div className={s.configuratorSlot}>
              <RitualConfigurator mode="inline" />
            </div>

            <div className={s.categoryRail} aria-label="Категории каталога">
              {(["Все", ...ATTRIBUTION_CATEGORIES] as Array<CatalogCategory | "Все">).map((category) => (
                <button
                  key={category}
                  type="button"
                  className={`${s.categoryChip} ${catalogCategory === category ? s.categoryChipActive : ""}`}
                  onClick={() => setCatalogCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>

            {ATTRIBUTION_CATEGORIES.map((cat) => {
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
              <strong>{formatCurrency(grandTotal)}</strong>
            </button>
            {nextStep ? (
              <button type="button" className={s.stepForward} onClick={() => goToStep(nextStep.id)}>
                Далее: {nextStep.label} <CaretRight size={14} weight="bold" />
              </button>
            ) : (
              <button
                type="button"
                className={`${s.stepForward} ${s.stepForwardDone}`}
                onClick={saveVersion}
                disabled={saving}
              >
                {saving ? "Сохраняю…" : "Готово - сохранить смету"}
                {!saving && <Check size={14} weight="bold" />}
              </button>
            )}
          </div>

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
                  <span className={s.panelHeroAmount}>{formatCurrency(grandTotal)}</span>
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
                {savedCount > 0 && (
                  <span className={s.panelVersions}>сохранено v{savedCount}</span>
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
                      <span className={s.panelSectionAmt}>{formatCurrency(estimateTotal)}</span>
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
                      <span className={s.panelSectionAmt}>{formatCurrency(externalTotal)}</span>
                    </div>
                    <div className={s.externalSummaryList}>
                      {externalExpenses.map((expense) => {
                        const expenseMargin = calculateOrderEconomics([
                          {
                            name: expense.name,
                            category: expense.category,
                            clientPrice: expense.includeInClientTotal ? expense.clientPrice : 0,
                            costPrice: expense.includeInMarginCalculation ? expense.costPrice : 0,
                            quantity: 1,
                          },
                        ]).items[0];
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
                                с/с {formatCurrency(expense.includeInMarginCalculation ? expense.costPrice : 0)} · маржа {formatCurrency(expenseMargin?.marginRub ?? 0)}
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
                  clientBudget={budgetStatus.clientBudget}
                  economics={economics}
                  marginItems={economics.items}
                  marginWarning={marginWarning}
                />
              </div>
            )}

            {calculatorTab === "versions" && (
              <div className={s.sheetPane}>
                <SnapshotBlock
                  budgetStatus={budgetStatus}
                  error={snapshotError}
                  note={snapshotNote}
                  onDelete={deleteSnapshot}
                  onFix={fixSnapshot}
                  onNoteChange={setSnapshotNote}
                  onOpenChange={setOpenSnapshotId}
                  onTitleChange={setSnapshotTitle}
                  openSnapshotId={openSnapshotId}
                  snapshots={snapshots}
                  title={snapshotTitle}
                />
              </div>
            )}

            {calculatorTab === "actions" && (
              <div className={s.panelActions} data-tour="quote-summary">
              <button
                className={s.saveBtn}
                onClick={saveVersion}
                disabled={saving}
              >
                  {saving ? "Сохраняю..." : "Сохранить черновик"}
              </button>

                <button type="button" className={s.secondaryActionBtn} onClick={fixSnapshot}>
                  <Check size={15} weight="bold" /> Сохранить версию
                </button>

                {cobrowseCode && (
                  <>
                    <button type="button" className={s.secondaryActionBtn} onClick={copyClientLink}>
                      <PaperPlaneTilt size={15} weight="duotone" /> Отправить клиенту
                    </button>
                    <button type="button" className={s.secondaryActionBtn} onClick={copyClientLink}>
                      <Copy size={15} weight="duotone" /> Скопировать ссылку
                    </button>
                    <a href={`/co/${cobrowseCode}`} target="_blank" rel="noreferrer" className={s.secondaryActionLink}>
                      <Eye size={15} weight="duotone" /> Показать клиенту
                    </a>
                  </>
                )}

              {savedAt && !saveError && (
                <div className={s.savedMsg}>
                  <Check size={14} weight="bold" />
                  Сохранено в {savedAt}
                </div>
              )}
              {saveError && (
                <div className={s.errorMsg}>{saveError}</div>
              )}
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
                <strong>{formatCurrency(grandTotal)}</strong>
              </button>
              <button type="button" className={s.sheetFooterSave} onClick={saveVersion} disabled={saving}>
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
