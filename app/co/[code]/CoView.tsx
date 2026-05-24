"use client";

import { useEffect, useState } from "react";
import { calculateOrder, DEFAULT_CALCULATOR_CONFIG, type FormData, type CalculationResult } from "@/lib/calculationUtils";

function money(n: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);
}

function formatTime(ts: number) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
}

export default function CoView({ code }: { code: string }) {
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/co/${code}`);
        if (!res.ok || !alive) return;
        const data = await res.json();
        if (data.state) {
          const formData = data.state as FormData;
          setResult(calculateOrder(formData, DEFAULT_CALCULATOR_CONFIG, data.state.cemeteryCategory ?? "standard"));
          setUpdatedAt(data.updatedAt);
        }
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [code]);

  if (!result) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-[420px] flex-col items-center justify-center px-2 text-center">
        <h2 className="font-serif text-[22px] text-ink">Агент готовит вашу смету</h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
          Страница обновится сама, как только агент начнёт составлять смету. Ничего нажимать не нужно.
        </p>
        <div className="mt-7 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full bg-accent"
              style={{ animation: `codot 1.4s ${i * 0.2}s ease-in-out infinite` }}
            />
          ))}
        </div>
        <style>{`@keyframes codot { 0%,100% { opacity:0.25 } 50% { opacity:1 } }`}</style>
      </div>
    );
  }

  const sections = result.sections.filter((s) => s.total > 0);

  return (
    <div className="mx-auto max-w-[640px]">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">Ваша смета</h2>
        {updatedAt && (
          <span className="tnum text-[12px] text-ink-3">Обновлено в {formatTime(updatedAt)}</span>
        )}
      </div>

      <div className="mb-4 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-soft">
        {sections.map((section, i) => {
          const items = section.items?.filter((it) => !it.included && (it.price ?? 0) > 0) ?? [];
          if (items.length === 0 && section.total === 0) return null;
          return (
            <div key={i} className={i > 0 ? "border-t border-line" : ""}>
              <div className="flex items-center justify-between bg-surface-2 px-5 py-3">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-2">{section.title}</span>
                <span className="tnum text-[13px] font-semibold text-ink">{money(section.total)}</span>
              </div>
              {items.map((item, j) => (
                <div key={j} className="flex items-center justify-between gap-4 border-t border-line px-5 py-3">
                  <span className="text-[14.5px] text-ink-2">{item.label}</span>
                  <span className="tnum flex-shrink-0 text-[14.5px] text-ink">{item.price != null ? money(item.price) : ""}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-accent/20 bg-accent-soft px-6 py-5">
        <span className="text-[15px] font-semibold text-ink">Итого</span>
        <span className="tnum font-serif text-[30px] font-semibold tracking-tight text-accent sm:text-[34px]">{money(result.total)}</span>
      </div>

      <p className="mt-5 text-center text-[12px] text-ink-3">
        Смета обновляется в реальном времени · код {code}
      </p>
    </div>
  );
}
