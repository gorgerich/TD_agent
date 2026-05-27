"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Check } from "@phosphor-icons/react";
import s from "./QuoteBuilder.module.css";
import {
  type FormData,
  type CalculationSection,
  type MarginItemInput,
  type ItemMargin,
  calculateOrder,
  calculateOrderEconomics,
  calculateBudgetStatus,
  formatCurrency,
  PRICES,
  PACKAGES,
  ADDITIONAL_SERVICES,
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

  const result = useMemo(
    () => calculateOrder(form, DEFAULT_CALCULATOR_CONFIG, cemeteryCategory),
    [form, cemeteryCategory],
  );
  const attrTotal = useMemo(() => attributesTotal(attributes), [attributes]);
  const grandTotal = result.total + attrTotal;
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

    return [...sectionItems, ...selectedAttributeMarginItems(attributes)];
  }, [result.sections, attributes]);
  const economics = useMemo(() => calculateOrderEconomics(marginItems), [marginItems]);
  const budgetStatus = useMemo(
    () => calculateBudgetStatus(economics.orderClientTotal, form.clientBudget),
    [economics.orderClientTotal, form.clientBudget],
  );
  const marginWarning =
    economics.orderMarginRub < 0
      ? "Внимание: цена ниже себестоимости"
      : economics.orderMarginPercent < 5
        ? "Критически низкая маржа: сделка почти без прибыли"
        : economics.orderMarginPercent < 15
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
        body: JSON.stringify({ form, cemeteryCategory, attributes }),
      }).catch(() => {});
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [form, cemeteryCategory, attributes, meetingId]);

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
        body: JSON.stringify({ payload: { form, attributes }, total: grandTotal }),
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
