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
  calculateOrder,
  calculateOrderEconomics,
  calculateBudgetStatus,
  calculateEstimateItemsTotal,
  addCatalogItemToEstimate,
  updateEstimateItemQuantity,
  removeEstimateItem,
  updateEstimateItemClientPrice,
  estimateItemsToMarginInputs,
  toPublicEstimateItems,
  formatCurrency,
  PRICES,
  PACKAGES,
  ADDITIONAL_SERVICES,
  AGENT_ATTRIBUTION_CATALOG,
  CATALOG_CATEGORIES,
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

  const result = useMemo(
    () => calculateOrder(form, DEFAULT_CALCULATOR_CONFIG, cemeteryCategory),
    [form, cemeteryCategory],
  );
  const attrTotal = useMemo(() => attributesTotal(attributes), [attributes]);
  const estimateTotal = useMemo(() => calculateEstimateItemsTotal(estimateItems), [estimateItems]);
  const grandTotal = result.total + attrTotal + estimateTotal;
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
    ];
  }, [result.sections, attributes, estimateItems]);
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
        }),
      }).catch(() => {});
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [form, cemeteryCategory, attributes, estimateItems, meetingId]);

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
