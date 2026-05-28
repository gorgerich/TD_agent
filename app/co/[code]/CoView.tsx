"use client";

import { useEffect, useState } from "react";
import {
  calculateOrder,
  calculateEstimateItemsTotal,
  DEFAULT_CALCULATOR_CONFIG,
  formatCurrency,
  type FormData,
  type CalculationResult,
  type PublicEstimateItem,
  type PublicExternalExpense,
} from "@/lib/calculationUtils";
import { DEFAULT_ATTRIBUTES, normalizeSelection, type AttrSelection } from "@/lib/attributes";
import AttributeRender from "@/components/AttributeRender";

function formatTime(ts: number) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

export default function CoView({ code }: { code: string }) {
  const [attributes, setAttributes] = useState<AttrSelection>(DEFAULT_ATTRIBUTES);
  const [estimateItems, setEstimateItems] = useState<PublicEstimateItem[]>([]);
  const [externalExpenses, setExternalExpenses] = useState<PublicExternalExpense[]>([]);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [started, setStarted] = useState(false);

  const attrJson = JSON.stringify(attributes);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/co/${code}`, { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data = await res.json();
        const state = data?.state;
        if (!state) return;
        setStarted(true);
        if (data.updatedAt) setUpdatedAt(data.updatedAt);

        // форма и расчёт — ведёт агент
        if (state.form) {
          setResult(calculateOrder(state.form as FormData, DEFAULT_CALCULATOR_CONFIG, state.cemeteryCategory ?? "standard"));
        }
        if (Array.isArray(state.estimateItems)) {
          setEstimateItems(state.estimateItems as PublicEstimateItem[]);
        }
        if (Array.isArray(state.externalExpenses)) {
          setExternalExpenses(state.externalExpenses as PublicExternalExpense[]);
        }
        // Старый attributes payload читаем только как совместимый fallback для render-компонента.
        if (state.attributes) {
          const norm = normalizeSelection(state.attributes);
          setAttributes((current) => (JSON.stringify(current) === JSON.stringify(norm) ? current : norm));
        }
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 700);
    return () => { alive = false; clearInterval(id); };
  }, [code, attrJson]);

  const estimateTotal = calculateEstimateItemsTotal(estimateItems);
  const externalTotal = externalExpenses.reduce((sum, expense) => sum + expense.clientPrice, 0);
  const grandTotal = (result?.total ?? 0) + estimateTotal + externalTotal;
  const sections = result?.sections.filter((s) => s.total > 0) ?? [];

  if (!started) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-[420px] flex-col items-center justify-center px-2 text-center">
        <h2 className="font-serif text-[22px] text-ink">Агент готовит вашу смету</h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
          Страница обновится сама, как только агент начнёт. Ничего нажимать не нужно.
        </p>
        <div className="mt-7 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2 w-2 rounded-full bg-accent" style={{ animation: `codot 1.4s ${i * 0.2}s ease-in-out infinite` }} />
          ))}
        </div>
        <style>{`@keyframes codot { 0%,100% { opacity:0.25 } 50% { opacity:1 } }`}</style>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[680px]">
      {/* Рендер сцены */}
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-b from-surface-2 to-surface shadow-soft">
        <div className="px-4 pt-4">
          <div className="text-[13px] font-semibold text-ink">Предпросмотр комплекта</div>
          <div className="mt-1 text-[12px] leading-snug text-ink-3">Визуализация обновляется при выборе атрибутики.</div>
        </div>
        <AttributeRender selection={attributes} selectedItems={estimateItems} className="block h-auto w-full" />
      </div>

      {/* Итог */}
      <div className="mt-4 flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-accent/20 bg-accent-soft px-6 py-5">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">Предварительная сумма</div>
          {updatedAt && <div className="tnum mt-0.5 text-[11.5px] text-ink-3">обновлено в {formatTime(updatedAt)}</div>}
        </div>
        <span className="tnum font-serif text-[30px] font-semibold tracking-tight text-accent sm:text-[34px]">{formatCurrency(grandTotal)}</span>
      </div>

      {/* Что входит (ведёт агент) */}
      {(sections.length > 0 || estimateItems.length > 0 || externalExpenses.length > 0) && (
        <section className="mt-6">
          <h2 className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">Что входит</h2>
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-soft">
            {sections.map((section, i) => (
              <div key={i} className={i > 0 ? "border-t border-line" : ""}>
                <div className="flex items-center bg-surface-2 px-5 py-3">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-2">{section.title}</span>
                </div>
                {section.items?.map((item, j) => (
                  <div key={j} className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
                    <span className="text-[14px] text-ink-2">{item.label}</span>
                    <span className="tnum flex-shrink-0 text-[14px] text-ink">
                      {item.included ? "включено" : item.price != null ? formatCurrency(item.price) : ""}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {estimateItems.length > 0 && (
              <div className="border-t border-line">
                <div className="flex items-center justify-between bg-surface-2 px-5 py-3">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-2">Атрибутика</span>
                  <span className="tnum text-[13px] font-semibold text-ink">{formatCurrency(estimateTotal)}</span>
                </div>
                {estimateItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
                    <span className="text-[14px] text-ink-2">
                      {item.name}
                      {item.selectedColor ? ` — цвет: ${item.selectedColor}` : ""}
                      {item.quantity > 1 ? ` ×${item.quantity}` : ""}
                    </span>
                    <span className="tnum flex-shrink-0 text-[14px] text-ink">{formatCurrency(item.clientPrice * item.quantity)}</span>
                  </div>
                ))}
              </div>
            )}
            {externalExpenses.length > 0 && (
              <div className="border-t border-line">
                <div className="flex items-center justify-between bg-surface-2 px-5 py-3">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-2">Внешние расходы</span>
                  <span className="tnum text-[13px] font-semibold text-ink">{formatCurrency(externalTotal)}</span>
                </div>
                {externalExpenses.map((expense) => (
                  <div key={expense.id} className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
                    <span className="text-[14px] text-ink-2">{expense.category}: {expense.name}</span>
                    <span className="tnum flex-shrink-0 text-[14px] text-ink">{formatCurrency(expense.clientPrice)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <p className="mt-8 text-center text-[12px] text-ink-3">Обновляется автоматически · код {code}</p>
    </div>
  );
}
