"use client";

import { useEffect, useRef, useState } from "react";
import { QuietShader, type QuietShaderHandle } from "@/components/QuietShader";
import { useCountUp } from "@/lib/useCountUp";
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

function formatDate(ts: number) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

type ApiResponse = {
  state: {
    form?: unknown;
    cemeteryCategory?: string;
    attributes?: unknown;
    estimateItems?: PublicEstimateItem[];
    externalExpenses?: PublicExternalExpense[];
    _ts?: number;
  } | null;
  updatedAt: number | null;
  isSnapshot?: boolean;
  agentName?: string | null;
  agentPhone?: string | null;
};

export default function CoView({ code }: { code: string }) {
  const [attributes, setAttributes] = useState<AttrSelection>(DEFAULT_ATTRIBUTES);
  const [estimateItems, setEstimateItems] = useState<PublicEstimateItem[]>([]);
  const [externalExpenses, setExternalExpenses] = useState<PublicExternalExpense[]>([]);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [isSnapshot, setIsSnapshot] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [agentPhone, setAgentPhone] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [agreeBusy, setAgreeBusy] = useState(false);

  async function agree() {
    setAgreeBusy(true);
    try {
      const res = await fetch(`/api/co/${code}/agree`, { method: "POST" });
      if (res.ok) setAgreed(true);
    } catch { /* ignore */ } finally {
      setAgreeBusy(false);
    }
  }

  const attrJson = JSON.stringify(attributes);

  useEffect(() => {
    let alive = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      try {
        const res = await fetch(`/api/co/${code}`, { cache: "no-store" });
        if (!res.ok || !alive) return;
        const data: ApiResponse = await res.json();
        setCheckedOnce(true);
        const state = data?.state;
        if (!state) return;

        setStarted(true);
        if (data.updatedAt) setUpdatedAt(data.updatedAt);
        if (data.isSnapshot) {
          setIsSnapshot(true);
          setAgentName(data.agentName ?? null);
          setAgentPhone(data.agentPhone ?? null);
          // Stop polling - snapshot is static
          if (intervalId) { clearInterval(intervalId); intervalId = null; }
        }

        if (state.form) {
          setResult(calculateOrder(state.form as FormData, DEFAULT_CALCULATOR_CONFIG, state.cemeteryCategory ?? "standard"));
        }
        if (Array.isArray(state.estimateItems)) {
          setEstimateItems(state.estimateItems);
        }
        if (Array.isArray(state.externalExpenses)) {
          setExternalExpenses(state.externalExpenses);
        }
        if (state.attributes) {
          const norm = normalizeSelection(state.attributes);
          setAttributes((cur) => (JSON.stringify(cur) === JSON.stringify(norm) ? cur : norm));
        }
      } catch { /* ignore */ }
    }

    poll();
    intervalId = setInterval(poll, 700);
    return () => { alive = false; if (intervalId) clearInterval(intervalId); };
  }, [code, attrJson]);

  const estimateTotal = calculateEstimateItemsTotal(estimateItems);
  const externalTotal = externalExpenses.reduce((sum, e) => sum + e.clientPrice, 0);
  const grandTotal = (result?.total ?? 0) + estimateTotal + externalTotal;

  // Сумма «доезжает» плавно, а шейдер под ней отвечает мягким всплеском -
  // клиент видит, что смета живая (DELIGHT: shader на hero-сумме).
  const animatedTotal = useCountUp(grandTotal);
  const shaderRef = useRef<QuietShaderHandle>(null);
  const prevTotal = useRef(grandTotal);
  useEffect(() => {
    if (grandTotal !== prevTotal.current) {
      prevTotal.current = grandTotal;
      shaderRef.current?.pulse(0.22, 0.55, 0.9);
    }
  }, [grandTotal]);
  const sections = result?.sections.filter((s) => s.total > 0) ?? [];
  const hasItems = sections.length > 0 || estimateItems.length > 0 || externalExpenses.length > 0;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (!started) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-[420px] flex-col items-center justify-center px-4 text-center">
        <div className="mb-5 grid h-16 w-16 place-items-center rounded-[14px] bg-accent-soft">
          <span className="block h-4 w-4 rounded-full bg-accent" />
        </div>
        <h2 className="td-display text-[22px] text-ink">
          {checkedOnce ? "Смета ещё не отправлена" : "Проверяем смету"}
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          {checkedOnce
            ? "Агент откроет или сохранит смету, и она появится здесь автоматически."
            : "Страница обновится сама, как только агент начнёт. Ничего нажимать не нужно."}
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

  // ── Status badge ───────────────────────────────────────────────────────────
  const statusBadge = isSnapshot ? (
    <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3 py-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span className="text-[11px] font-semibold text-accent">Смета сформирована</span>
    </div>
  ) : (
    <div className="inline-flex items-center gap-2 rounded-full border border-success/25 bg-success-soft px-3 py-1.5">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
      <span className="text-[11px] font-semibold text-success">Обновляется</span>
    </div>
  );

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-[680px]">
      {/* Status row */}
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        {statusBadge}
        {updatedAt && (
          <span className="text-[12px] text-ink-3">
            {isSnapshot ? `Сохранена ${formatDate(updatedAt)}` : `обновлено в ${formatTime(updatedAt)}`}
          </span>
        )}
      </div>

      {/* Grand total hero */}
      <div className="relative mb-5 overflow-hidden rounded-[var(--radius-card)] bg-accent shadow-[0_1px_2px_rgba(0,31,39,0.16),0_10px_24px_-18px_rgba(0,58,53,0.36)]">
        <QuietShader ref={shaderRef} palette="accent" className="absolute inset-0 h-full w-full" />
        <div className="relative px-6 py-5 sm:px-8 sm:py-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-accent/60">
            {isSnapshot ? "Итоговая сумма" : "Предварительная сумма"}
          </p>
          <p className="tnum mt-1 text-[38px] font-semibold tracking-tight text-on-accent sm:text-[44px]">
            {formatCurrency(Math.round(animatedTotal))}
          </p>
          {/* Trust-строка tihiydom.com - один язык обещаний на обеих платформах */}
          <p className="mt-2 text-[12px] leading-5 text-on-accent/64">
            Без скрытых платежей и доплат.{" "}
            {isSnapshot
              ? "Итоговая цена фиксируется в договоре."
              : "Ничего не фиксируется без вашего подтверждения."}
          </p>
        </div>
      </div>

      {/* Attribution render (live cobrowse only) */}
      {!isSnapshot && (
        <div className="mb-5 overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-b from-surface-2 to-surface shadow-soft">
          <div className="px-4 pt-4">
            <p className="text-[13px] font-semibold text-ink">Предпросмотр комплекта</p>
            <p className="mt-1 text-[12px] leading-snug text-ink-3">Визуализация обновляется при выборе атрибутики.</p>
          </div>
          <AttributeRender selection={attributes} selectedItems={estimateItems} className="block h-auto w-full" />
        </div>
      )}

      {/* Composition */}
      {hasItems && (
        <section className="mb-5">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">Что входит</h2>
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-soft">
            {sections.map((section, i) => (
              <div key={i} className={i > 0 ? "border-t border-line" : ""}>
                <div className="flex items-center justify-between bg-surface-2 px-5 py-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-2">{section.title}</span>
                  <span className="font-mono text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(section.total)}</span>
                </div>
                {section.items?.map((item, j) => (
                  <div key={j} className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
                    <span className="text-[14px] text-ink-2">{item.label}</span>
                    <span className="flex-shrink-0 font-mono text-[14px] text-ink tabular-nums">
                      {item.included ? <span className="text-success text-[12px] font-semibold">включено</span> : item.price != null ? formatCurrency(item.price) : ""}
                    </span>
                  </div>
                ))}
              </div>
            ))}

            {estimateItems.length > 0 && (
              <div className="border-t border-line">
                <div className="flex items-center justify-between bg-surface-2 px-5 py-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-2">Атрибутика</span>
                  <span className="font-mono text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(estimateTotal)}</span>
                </div>
                {estimateItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
                    <span className="text-[14px] text-ink-2">
                      {item.name}
                      {item.selectedColor ? ` - ${item.selectedColor}` : ""}
                      {item.quantity > 1 ? ` ×${item.quantity}` : ""}
                    </span>
                    <span className="flex-shrink-0 font-mono text-[14px] text-ink tabular-nums">{formatCurrency(item.clientPrice * item.quantity)}</span>
                  </div>
                ))}
              </div>
            )}

            {externalExpenses.length > 0 && (
              <div className="border-t border-line">
                <div className="flex items-center justify-between bg-surface-2 px-5 py-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-2">Внешние расходы</span>
                  <span className="font-mono text-[13px] font-semibold text-ink tabular-nums">{formatCurrency(externalTotal)}</span>
                </div>
                {externalExpenses.map((expense) => (
                  <div key={expense.id} className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
                    <span className="text-[14px] text-ink-2">{expense.category}: {expense.name}</span>
                    <span className="flex-shrink-0 font-mono text-[14px] text-ink tabular-nums">{formatCurrency(expense.clientPrice)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Client actions (snapshot only - live cobrowse has no final agree yet) */}
      {isSnapshot && (
        <div className="mb-5 space-y-3">
          {agreed ? (
            <div className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border border-success/25 bg-success-soft px-6 text-[14px] font-semibold text-success">
              ✓ Смета согласована
            </div>
          ) : (
            <button
              type="button"
              onClick={agree}
              disabled={agreeBusy}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-accent px-6 font-semibold text-[14px] text-on-accent shadow-[0_1px_2px_rgba(0,31,39,0.16),0_6px_14px_-12px_rgba(0,58,53,0.42)] transition-colors duration-150 hover:bg-accent-hover disabled:opacity-60"
            >
              {agreeBusy ? "Сохраняю…" : "Согласовать смету"}
            </button>
          )}
          {agentPhone && (
            <a
              href={`tel:${agentPhone}`}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-6 font-semibold text-[14px] text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              Связаться с агентом
              {agentName ? ` - ${agentName.split(" ")[0]}` : ""}
            </a>
          )}
        </div>
      )}

      {/* Footer */}
      <p className="mt-6 text-center text-[12px] text-ink-3">
        {isSnapshot ? "Тихий дом · ритуальные услуги" : `Обновляется автоматически · код ${code}`}
      </p>
    </div>
  );
}
