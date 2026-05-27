"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Check } from "@phosphor-icons/react";
import s from "./QuoteBuilder.module.css";
import {
  type FormData,
  type CalculationSection,
  type MarginItemInput,
  type ItemMargin,
  type CatalogCategory,
  type CatalogItem,
  type EstimateItem,
  type MemorialData,
  type MemorialStatus,
  type ExternalExpense,
  type ExternalExpenseCategory,
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
  CATALOG_CATEGORIES,
  DEFAULT_MEMORIAL_DATA,
  EXTERNAL_EXPENSE_CATEGORIES,
  EXTERNAL_EXPENSE_PRESETS,
  MOSCOW_CEMETERIES,
  MO_CEMETERIES,
  DEFAULT_CALCULATOR_CONFIG,
} from "@/lib/calculationUtils";
import { DEFAULT_ATTRIBUTES, attributesTotal, selectedAttributeMarginItems, type AttrSelection } from "@/lib/attributes";
import AttributePicker from "@/components/AttributePicker";
import AttributeRender from "@/components/AttributeRender";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface Props {
  meetingId: number;
  cobrowseCode: string | null;
  clientName: string;
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

/* ─── Main component ─────────────────────────────────────────────────── */

export default function QuoteBuilder({ meetingId, cobrowseCode, clientName }: Props) {
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [cemeteryCategory, setCemeteryCategory] = useState("standard");
  const [attributes, setAttributes] = useState<AttrSelection>(DEFAULT_ATTRIBUTES);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [clientEdited, setClientEdited] = useState(false);
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

  const result = useMemo(
    () => calculateOrder(form, DEFAULT_CALCULATOR_CONFIG, cemeteryCategory),
    [form, cemeteryCategory],
  );
  const attrTotal = useMemo(() => attributesTotal(attributes), [attributes]);
  const estimateTotal = useMemo(() => calculateEstimateItemsTotal(estimateItems), [estimateItems]);
  const externalTotal = useMemo(() => calculateExternalExpensesClientTotal(externalExpenses), [externalExpenses]);
  const grandTotal = result.total + attrTotal + estimateTotal + externalTotal;
  const filteredCatalogItems = useMemo(
    () =>
      catalogCategory === "Все"
        ? AGENT_ATTRIBUTION_CATALOG
        : AGENT_ATTRIBUTION_CATALOG.filter((item) => item.category === catalogCategory),
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
      ...selectedAttributeMarginItems(attributes),
      ...estimateItemsToMarginInputs(estimateItems),
      ...externalExpensesToMarginInputs(externalExpenses),
    ];
  }, [result.sections, attributes, estimateItems, externalExpenses]);
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

  const visibleCemeteries =
    form.serviceType === "cremation"
      ? MOSCOW_CEMETERIES.filter((c) => c.type === "cremation")
      : [
          ...MOSCOW_CEMETERIES.filter((c) => c.type === "burial"),
          ...MO_CEMETERIES,
        ];

  // Co-work sync. Окно подавления: после локальной правки не перетираем её
  // тем, что вернёт опрос (избегаем гонки push↔poll), сравнение по содержимому.
  const suppressUntil = useRef(0);
  const attrJson = JSON.stringify(attributes);

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

  // Poll: подхватываем правки атрибутики, сделанные клиентом на своём экране.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/meeting/${meetingId}/session`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const remote = data?.state?.attributes;
        if (!remote) return;
        if (Date.now() < suppressUntil.current) return;
        if (JSON.stringify(remote) !== attrJson) {
          setAttributes(remote);
          setClientEdited(true);
          setTimeout(() => setClientEdited(false), 2500);
        }
      } catch { /* ignore */ }
    }, 2500);
    return () => clearInterval(id);
  }, [meetingId, attrJson]);

  function updateAttributes(next: AttrSelection) {
    suppressUntil.current = Date.now() + 2000;
    setAttributes(next);
  }

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

  function addCatalogItem(item: CatalogItem) {
    setEstimateItems((current) => addCatalogItemToEstimate(current, item, getSelectedCatalogColor(item)));
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
        setSaveError(data.error ?? "Ошибка сохранения");
      } else {
        setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
        setSavedCount((n) => n + 1);
      }
    } catch {
      setSaveError("Сеть недоступна");
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
            <div className={s.headerTitle}>{clientName}</div>
            <div className={s.headerSubtitle}>Встреча #{meetingId}</div>
          </div>
        </div>
        {cobrowseCode && (
          <div className={s.cobrowseBlock}>
            <span className={s.cobrowseLabel}>Код клиента</span>
            <button onClick={copyCode} className={s.cobrowseCode}>
              {cobrowseCode}
              {copied && <span className={s.copiedBadge}>скопировано</span>}
            </button>
          </div>
        )}
      </div>

      {/* ── Main layout ────────────────────────────────── */}
      <div className={s.layout}>

        {/* ── Form ─────────────────────────────────────── */}
        <div className={s.form}>

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
                    <span className={s.pkgBadge}>популярный</span>
                  )}
                  <div className={s.pkgName}>{p.name}</div>
                  <div className={s.pkgPrice}>{formatCurrency(p.price)}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div className={s.card}>
            <p className={s.cardTitle}>Формат</p>

            <ToggleRow
              label="Зал прощания"
              price={form.hasHall ? PRICES.hallDuration[form.hallDuration as keyof typeof PRICES.hallDuration] : undefined}
              checked={form.hasHall}
              onChange={(v) => setField("hasHall", v)}
            >
              <div className={s.pills}>
                {([30, 60, 90] as const).map((min) => (
                  <button
                    key={min}
                    className={`${s.pill} ${form.hallDuration === min ? s.pillActive : ""}`}
                    onClick={() => setField("hallDuration", min)}
                  >
                    {min} мин
                    {PRICES.hallDuration[min] > 0
                      ? ` · +${formatCurrency(PRICES.hallDuration[min])}`
                      : " · базово"}
                  </button>
                ))}
              </div>
            </ToggleRow>

            <div className={s.divider} />

            <p className={s.subLabel}>Тип церемонии</p>
            <div className={s.pills}>
              {(
                [
                  { v: "civil", l: "Гражданская" },
                  { v: "religious", l: "Религиозная", delta: 15000 },
                  { v: "combined", l: "Комбинированная", delta: 20000 },
                ] as { v: string; l: string; delta?: number }[]
              ).map(({ v, l, delta }) => (
                <button
                  key={v}
                  className={`${s.pill} ${form.ceremonyType === v ? s.pillActive : ""}`}
                  onClick={() => setField("ceremonyType", v)}
                >
                  {l}
                  {delta ? ` · +${formatCurrency(delta)}` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* Logistics */}
          <div className={s.card}>
            <p className={s.cardTitle}>Логистика</p>

            <ToggleRow
              label="Катафалк"
              price={PRICES.hearse}
              checked={form.needsHearse}
              onChange={(v) => setField("needsHearse", v)}
            />

            <div className={s.divider} />

            <ToggleRow
              label="Транспорт для близких"
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
              <option value="">— не выбрано —</option>
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

          <div className={s.card}>
            <div className={s.catalogIntro}>
              <div>
                <p className={s.cardTitle}>Каталог атрибутики</p>
                <p className={s.catalogSubtitle}>Выберите позиции, которые нужно добавить в смету.</p>
              </div>
              <span className={s.catalogCount}>{filteredCatalogItems.length}</span>
            </div>

            <div className={s.categoryRail} aria-label="Категории каталога">
              {(["Все", ...CATALOG_CATEGORIES] as Array<CatalogCategory | "Все">).map((category) => (
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

            <div className={s.catalogGrid}>
              {filteredCatalogItems.map((item) => (
                <CatalogCard
                  key={item.id}
                  item={item}
                  selectedColor={getSelectedCatalogColor(item)}
                  onColorChange={(color) => setCatalogColor(item.id, color)}
                  onAdd={() => addCatalogItem(item)}
                />
              ))}
            </div>
          </div>

          <MemorialBlock
            data={memorialData}
            onCommentChange={(comment) => setMemorialData((current) => ({ ...current, comment }))}
            onGuestsChange={setMemorialGuests}
            onIncludeCafeChange={setCafeAssistanceIncluded}
            onStatusChange={setMemorialStatus}
          />

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

          {/* Атрибутика */}
          <div className={s.card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
              <p className={s.cardTitle} style={{ margin: 0 }}>Атрибутика</p>
              {clientEdited && <span className={s.clientPing}>клиент изменил</span>}
            </div>
            <AttributePicker selection={attributes} onChange={updateAttributes} />
          </div>

        </div>

        {/* ── Quote panel ──────────────────────────────── */}
        <aside className={s.panel}>
          <div className={s.panelCard}>
            {/* Рендер сцены — то же, что видит клиент */}
            <div className={s.renderWrap}>
              <AttributeRender selection={attributes} className={s.renderSvg} />
            </div>

            <div className={s.panelHead}>
              <span className={s.panelHeadTitle}>Смета</span>
              {savedCount > 0 && (
                <span className={s.panelVersions}>v{savedCount}</span>
              )}
            </div>

            <div className={s.panelSections}>
              {estimateItems.length > 0 && (
                <div className={s.panelSection}>
                  <div className={s.panelSectionHead}>
                    <span>Позиции каталога</span>
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
                            <span>Клиенту {formatCurrency(expense.includeInClientTotal ? expense.clientPrice : 0)}</span>
                            <span>Себестоимость {formatCurrency(expense.includeInMarginCalculation ? expense.costPrice : 0)}</span>
                            <span>Маржа {formatCurrency(expenseMargin?.marginRub ?? 0)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {result.sections.length === 0 ? (
                <div className={s.panelEmpty}>
                  Выберите услуги слева — смета появится здесь
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

              {attrTotal > 0 && (
                <div className={s.panelSection}>
                  <div className={s.panelSectionHead}>
                    <span>Оформление</span>
                    <span className={s.panelSectionAmt}>{formatCurrency(attrTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className={s.panelTotalBlock}>
              <div className={s.panelTotalLabel}>Итого</div>
              <div className={s.panelTotalAmount}>{formatCurrency(grandTotal)}</div>
            </div>

            <AgentEconomicsBlock
              budgetMessage={budgetMessage}
              budgetStatus={budgetStatus.status}
              clientBudget={budgetStatus.clientBudget}
              economics={economics}
              marginItems={economics.items}
              marginWarning={marginWarning}
            />

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

            <div className={s.panelActions}>
              <button
                className={s.saveBtn}
                onClick={saveVersion}
                disabled={saving}
              >
                {saving ? "Сохраняю..." : "Сохранить версию сметы"}
              </button>

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
          </div>
        </aside>

      </div>
    </div>
  );
}

function MemorialBlock({
  data,
  onCommentChange,
  onGuestsChange,
  onIncludeCafeChange,
  onStatusChange,
}: {
  data: MemorialData;
  onCommentChange: (comment: string) => void;
  onGuestsChange: (value: string) => void;
  onIncludeCafeChange: (included: boolean) => void;
  onStatusChange: (status: MemorialStatus) => void;
}) {
  const showsGuests = data.status === "agent_helps" || data.status === "client_handles";

  return (
    <div className={s.card}>
      <p className={s.cardTitle}>Поминки / кафе</p>
      <p className={s.catalogSubtitle}>Отметьте, нужны ли поминки и будет ли агент помогать с подбором кафе.</p>

      <div className={s.segmentGrid}>
        {(
          [
            ["not_discussed", "Не обсуждали"],
            ["not_needed", "Не нужны"],
            ["client_handles", "Клиент сам"],
            ["agent_helps", "Нужна помощь"],
          ] as Array<[MemorialStatus, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`${s.segmentBtn} ${data.status === value ? s.segmentBtnActive : ""}`}
            onClick={() => onStatusChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {showsGuests && (
        <label className={s.blockField}>
          <span>Количество гостей</span>
          <input
            inputMode="numeric"
            placeholder="Например, 20"
            value={data.guestsCount ? String(data.guestsCount) : ""}
            onChange={(event) => onGuestsChange(event.target.value)}
          />
        </label>
      )}

      <label className={s.blockField}>
        <span>Комментарий по поминкам</span>
        <textarea
          placeholder="Например: нужно кафе рядом с кладбищем, без алкоголя, на 20 человек"
          value={data.comment ?? ""}
          onChange={(event) => onCommentChange(event.target.value)}
        />
      </label>

      {data.status === "agent_helps" && (
        <label className={s.inlineCheck}>
          <input
            type="checkbox"
            checked={Boolean(data.includeCafeAssistance)}
            onChange={(event) => onIncludeCafeChange(event.target.checked)}
          />
          <span>Добавить помощь с кафе в смету</span>
        </label>
      )}

      {data.status === "agent_helps" && (
        <div className={s.helperNote}>Можно предложить клиенту несколько вариантов кафе и меню, чтобы снять с семьи отдельную задачу.</div>
      )}
      {data.status === "client_handles" && (
        <div className={s.helperNote}>Клиент организует поминки самостоятельно. Не включайте кафе в итоговую смету, если агент не помогает с подбором.</div>
      )}
    </div>
  );
}

function ExternalExpensesBlock({
  draft,
  expenses,
  onAddDraft,
  onAddPreset,
  onDraftFieldChange,
  onDraftMoneyChange,
  onRemove,
  onUpdate,
}: {
  draft: ExternalExpense;
  expenses: ExternalExpense[];
  onAddDraft: () => void;
  onAddPreset: (preset: (typeof EXTERNAL_EXPENSE_PRESETS)[number]) => void;
  onDraftFieldChange: <K extends keyof ExternalExpense>(key: K, value: ExternalExpense[K]) => void;
  onDraftMoneyChange: (key: "clientPrice" | "costPrice", value: string) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<ExternalExpense>) => void;
}) {
  return (
    <div className={s.card}>
      <p className={s.cardTitle}>Внешние расходы</p>
      <p className={s.catalogSubtitle}>Расходы, которые зависят от морга, кладбища, крематория, церкви или других внешних условий.</p>

      <div className={s.quickExpenseGrid}>
        {EXTERNAL_EXPENSE_PRESETS.map((preset) => (
          <button key={preset.name} type="button" className={s.quickExpenseBtn} onClick={() => onAddPreset(preset)}>
            <span>{preset.name}</span>
            <strong>{formatCurrency(preset.clientPrice)}</strong>
          </button>
        ))}
      </div>

      <div className={s.expenseDraftGrid}>
        <label className={s.blockField}>
          <span>Категория</span>
          <select value={draft.category} onChange={(event) => onDraftFieldChange("category", event.target.value as ExternalExpenseCategory)}>
            {EXTERNAL_EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className={s.blockField}>
          <span>Название расхода</span>
          <input value={draft.name} placeholder="Например, подготовка тела в морге" onChange={(event) => onDraftFieldChange("name", event.target.value)} />
        </label>
        <label className={s.blockField}>
          <span>Сумма для клиента</span>
          <input inputMode="numeric" value={draft.clientPrice || ""} onChange={(event) => onDraftMoneyChange("clientPrice", event.target.value)} />
        </label>
        <label className={s.blockField}>
          <span>Себестоимость / передаваемая сумма</span>
          <input inputMode="numeric" value={draft.costPrice || ""} onChange={(event) => onDraftMoneyChange("costPrice", event.target.value)} />
        </label>
      </div>
      <div className={s.fieldHint}>Если деньги полностью передаются внешней стороне, укажите такую же сумму.</div>

      <label className={s.blockField}>
        <span>Комментарий</span>
        <textarea value={draft.comment ?? ""} placeholder="Например: зависит от условий конкретного морга" onChange={(event) => onDraftFieldChange("comment", event.target.value)} />
      </label>

      <div className={s.checkRow}>
        <label className={s.inlineCheck}>
          <input type="checkbox" checked={draft.includeInClientTotal} onChange={(event) => onDraftFieldChange("includeInClientTotal", event.target.checked)} />
          <span>Включить в итоговую сумму для клиента</span>
        </label>
        <label className={s.inlineCheck}>
          <input type="checkbox" checked={draft.includeInMarginCalculation} onChange={(event) => onDraftFieldChange("includeInMarginCalculation", event.target.checked)} />
          <span>Учитывать в расчёте маржи</span>
        </label>
      </div>

      <button type="button" className={s.addCatalogBtn} onClick={onAddDraft}>Добавить внешний расход</button>

      {expenses.length > 0 && (
        <div className={s.externalList}>
          {expenses.map((expense) => (
            <ExternalExpenseRow key={expense.id} expense={expense} onRemove={() => onRemove(expense.id)} onUpdate={(patch) => onUpdate(expense.id, patch)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ExternalExpenseRow({
  expense,
  onRemove,
  onUpdate,
}: {
  expense: ExternalExpense;
  onRemove: () => void;
  onUpdate: (patch: Partial<ExternalExpense>) => void;
}) {
  const margin = calculateOrderEconomics([{
    name: expense.name,
    clientPrice: expense.includeInClientTotal ? expense.clientPrice : 0,
    costPrice: expense.includeInMarginCalculation ? expense.costPrice : 0,
    quantity: 1,
  }]).items[0];

  return (
    <div className={s.externalRow}>
      <div className={s.externalRowHead}>
        <div>
          <span>{expense.category}</span>
          <strong>{expense.name}</strong>
        </div>
        <button type="button" onClick={onRemove}>Удалить</button>
      </div>
      {expense.comment && <p>{expense.comment}</p>}
      <div className={s.externalRowGrid}>
        <label>
          <span>Клиенту</span>
          <input inputMode="numeric" value={expense.clientPrice} onChange={(event) => onUpdate({ clientPrice: Number(event.target.value.replace(/[^\d]/g, "")) || 0 })} />
        </label>
        <label>
          <span>Себестоимость</span>
          <input inputMode="numeric" value={expense.costPrice} onChange={(event) => onUpdate({ costPrice: Number(event.target.value.replace(/[^\d]/g, "")) || 0 })} />
        </label>
        <div className={s.externalMargin}>Маржа {formatCurrency(margin?.marginRub ?? 0)}</div>
      </div>
    </div>
  );
}

function CatalogCard({
  item,
  selectedColor,
  onColorChange,
  onAdd,
}: {
  item: CatalogItem;
  selectedColor?: string;
  onColorChange: (color: string) => void;
  onAdd: () => void;
}) {
  const itemMargin = calculateOrderEconomics([
    {
      name: item.name,
      category: item.category,
      clientPrice: item.clientPrice,
      costPrice: item.costPrice,
      quantity: item.quantityDefault,
    },
  ]).items[0];

  return (
    <article className={s.catalogCard}>
      <div className={s.catalogMedia} aria-hidden="true">{item.imagePlaceholder}</div>
      <div className={s.catalogBody}>
        <div className={s.catalogBadges}>
          {item.isRecommended && <span className={s.recommendedBadge}>Рекомендовано</span>}
          {item.isRequired && <span className={s.requiredBadge}>Обязательное</span>}
        </div>
        <h3 className={s.catalogName}>{item.name}</h3>
        <p className={s.catalogDescription}>{item.description}</p>

        <div className={s.catalogPrices}>
          <span>Клиенту {formatCurrency(item.clientPrice)}</span>
          <span>Себестоимость {formatCurrency(item.costPrice)}</span>
          <span>Маржа {formatCurrency(itemMargin?.marginRub ?? 0)}</span>
        </div>

        {item.availableColors && item.availableColors.length > 0 && (
          <div className={s.colorGroup} aria-label={`Цвет для ${item.name}`}>
            {item.availableColors.map((color) => (
              <button
                key={color}
                type="button"
                className={`${s.colorChip} ${selectedColor === color ? s.colorChipActive : ""}`}
                onClick={() => onColorChange(color)}
              >
                {color}
              </button>
            ))}
          </div>
        )}

        <button type="button" className={s.addCatalogBtn} onClick={onAdd}>
          Добавить в смету
        </button>
      </div>
    </article>
  );
}

function EstimateItemRow({
  item,
  onPriceChange,
  onQuantityChange,
  onRemove,
}: {
  item: EstimateItem;
  onPriceChange: (value: string) => void;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className={s.estimateItem}>
      <div className={s.estimateTop}>
        <div className={s.estimateNameWrap}>
          <span className={s.estimateName}>{item.name}</span>
          {item.selectedColor && <span className={s.estimateMeta}>цвет: {item.selectedColor}</span>}
        </div>
        <button type="button" className={s.removeEstimateBtn} onClick={onRemove} aria-label={`Удалить ${item.name}`}>
          Удалить
        </button>
      </div>

      <div className={s.estimateControls}>
        <div className={s.qtyControl} aria-label={`Количество ${item.name}`}>
          <button type="button" onClick={() => onQuantityChange(item.quantity - 1)} aria-label="Уменьшить количество">−</button>
          <span>{item.quantity}</span>
          <button type="button" onClick={() => onQuantityChange(item.quantity + 1)} aria-label="Увеличить количество">+</button>
        </div>
        <label className={s.priceEditLabel}>
          <span>Цена клиенту</span>
          <input
            value={String(item.clientPrice)}
            inputMode="numeric"
            onChange={(event) => onPriceChange(event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function SnapshotBlock({
  budgetStatus,
  error,
  note,
  onDelete,
  onFix,
  onNoteChange,
  onOpenChange,
  onTitleChange,
  openSnapshotId,
  snapshots,
  title,
}: {
  budgetStatus: ReturnType<typeof calculateBudgetStatus>;
  error: string | null;
  note: string;
  onDelete: (id: string) => void;
  onFix: () => void;
  onNoteChange: (value: string) => void;
  onOpenChange: (id: string | null) => void;
  onTitleChange: (value: string) => void;
  openSnapshotId: string | null;
  snapshots: EstimateSnapshot[];
  title: string;
}) {
  return (
    <div className={s.snapshotBlock}>
      <div className={s.economicsHead}>
        <span>История версий</span>
        <span className={s.economicsTag}>{snapshots.length}</span>
      </div>
      <input className={s.snapshotInput} value={title} placeholder="Название версии" onChange={(event) => onTitleChange(event.target.value)} />
      <textarea className={s.snapshotTextarea} value={note} placeholder="Например: клиент попросил уложиться в 130 000 ₽, убрали отдельный катафалк" onChange={(event) => onNoteChange(event.target.value)} />
      <button type="button" className={s.saveBtn} onClick={onFix}>Зафиксировать смету</button>
      {error && <div className={s.errorMsg}>{error}</div>}

      {snapshots.length > 0 && (
        <div className={s.snapshotList}>
          {snapshots.map((snapshot) => {
            const open = openSnapshotId === snapshot.id;
            return (
              <div key={snapshot.id} className={s.snapshotItem}>
                <div className={s.snapshotItemHead}>
                  <button type="button" onClick={() => onOpenChange(open ? null : snapshot.id)}>
                    <strong>{snapshot.title}</strong>
                    <span>{formatSnapshotDate(snapshot.createdAt)}</span>
                  </button>
                  <button type="button" onClick={() => onDelete(snapshot.id)}>Удалить</button>
                </div>
                <div className={s.snapshotMetrics}>
                  <span>{formatCurrency(snapshot.orderClientTotal)}</span>
                  <span>Маржа {formatCurrency(snapshot.orderMarginRub)} · {formatPercent(snapshot.orderMarginPercent)}%</span>
                  <span>{snapshot.budgetExceeded ? `Превышение ${formatCurrency(Math.abs(snapshot.budgetRemaining ?? 0))}` : budgetStatus.clientBudget ? "В бюджете" : "Без бюджета"}</span>
                </div>
                {open && (
                  <div className={s.snapshotDetails}>
                    {snapshot.note && <p>{snapshot.note}</p>}
                    <SnapshotLine title="Позиции" items={snapshot.items.map((item) => `${item.name}${item.selectedColor ? `, цвет: ${item.selectedColor}` : ""} ×${item.quantity}`)} />
                    <SnapshotLine title="Внешние расходы" items={snapshot.externalExpenses.map((expense) => `${expense.category}: ${expense.name} (${formatCurrency(expense.clientPrice)})`)} />
                    <SnapshotLine title="Поминки" items={[memorialSummary(snapshot.memorialData)]} />
                    <div className={s.snapshotTotals}>
                      <span>Себестоимость {formatCurrency(snapshot.orderCostTotal)}</span>
                      <span>Итог {formatCurrency(snapshot.orderClientTotal)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SnapshotLine({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={s.snapshotLine}>
      <span>{title}</span>
      {items.length > 0 ? items.map((item) => <em key={item}>{item}</em>) : <em>Нет</em>}
    </div>
  );
}

function memorialSummary(data: MemorialData) {
  const status: Record<MemorialStatus, string> = {
    not_discussed: "Не обсуждали",
    not_needed: "Не нужны",
    client_handles: "Клиент организует сам",
    agent_helps: "Нужна помощь с кафе",
  };
  const guests = data.guestsCount ? `, гостей: ${data.guestsCount}` : "";
  const comment = data.comment ? `, ${data.comment}` : "";
  return `${status[data.status]}${guests}${comment}`;
}

function formatSnapshotDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function AgentEconomicsBlock({
  budgetMessage,
  budgetStatus,
  clientBudget,
  economics,
  marginItems,
  marginWarning,
}: {
  budgetMessage: string;
  budgetStatus: "not_set" | "within" | "near_limit" | "exceeded";
  clientBudget: number | null;
  economics: ReturnType<typeof calculateOrderEconomics>;
  marginItems: ItemMargin[];
  marginWarning: string | null;
}) {
  return (
    <div className={s.economicsBlock}>
      <div className={s.economicsHead}>
        <span>Экономика сделки</span>
        <span className={s.economicsTag}>внутренне</span>
      </div>

      <div className={s.economicsGrid}>
        <Metric label="Бюджет клиента" value={clientBudget ? formatCurrency(clientBudget) : "Не указан"} />
        <Metric label="Итог клиенту" value={formatCurrency(economics.orderClientTotal)} />
        <Metric
          label={budgetStatus === "exceeded" ? "Превышение" : "Остаток"}
          value={budgetStatus === "not_set" ? "—" : formatCurrency(Math.abs(economics.orderClientTotal - (clientBudget ?? 0)))}
        />
        <Metric label="Себестоимость" value={formatCurrency(economics.orderCostTotal)} />
        <Metric label="Маржа" value={formatCurrency(economics.orderMarginRub)} />
        <Metric label="Маржа" value={`${formatPercent(economics.orderMarginPercent)}%`} />
      </div>

      <div className={`${s.budgetLine} ${budgetStatus === "exceeded" ? s.budgetLineWarn : ""}`}>
        {budgetMessage}
      </div>
      {budgetStatus === "exceeded" && (
        <div className={s.economicsHint}>Можно снизить цену, заменить позиции или убрать необязательные услуги.</div>
      )}
      {marginWarning && <div className={s.marginWarning}>{marginWarning}</div>}

      {marginItems.length > 0 && (
        <div className={s.marginList}>
          {marginItems.slice(0, 8).map((item) => (
            <div key={`${item.category}-${item.name}-${item.totalClientPrice}`} className={s.marginItem}>
              <div className={s.marginItemMain}>
                <span className={s.marginItemName}>{item.name}</span>
                <span className={s.marginItemPrice}>{formatCurrency(item.totalClientPrice)}</span>
              </div>
              <div className={s.marginItemMeta}>
                <span>Себестоимость {formatCurrency(item.totalCostPrice)}</span>
                <span>
                  Маржа {formatCurrency(item.marginRub)} · {formatPercent(item.marginPercent)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(Number.isFinite(value) ? value : 0);
}

/* ─── Toggle row component ───────────────────────────────────────────── */

function ToggleRow({
  label,
  price,
  checked,
  onChange,
  children,
}: {
  label: string;
  price?: number;
  checked: boolean;
  onChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={s.toggleRow}>
      <div className={s.toggleRowMain}>
        <div className={s.toggleRowText}>
          <div className={s.toggleRowLabel}>{label}</div>
          {price !== undefined && price > 0 && (
            <div className={s.toggleRowPrice}>+{formatCurrency(price)}</div>
          )}
        </div>
        <label className={s.switch}>
          <input
            type="checkbox"
            className={s.switchInput}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className={s.switchTrack} />
        </label>
      </div>
      {checked && children && (
        <div className={s.toggleRowSub}>{children}</div>
      )}
    </div>
  );
}
