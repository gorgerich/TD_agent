"use client";

import { useEffect, useState } from "react";
import { calculateOrder, DEFAULT_CALCULATOR_CONFIG, type FormData, type CalculationResult } from "@/lib/calculationUtils";

function money(n: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);
}

function formatTime(ts: number) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(ts));
}

export default function CoView({ code }: { code: string }) {
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

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
          setTick((t) => t + 1);
        }
      } catch { /* ignore */ }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [code]);

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-6">
        <div className="w-12 h-12 rounded-xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center mb-5">
          <span className="text-2xl">⌛</span>
        </div>
        <h2 className="text-lg font-bold text-slate-200 mb-2">Агент готовит вашу смету</h2>
        <p className="text-[13px] text-slate-500 max-w-[320px] leading-relaxed">
          Страница обновится автоматически, как только агент начнёт составлять смету. Ничего нажимать не нужно.
        </p>
        <div className="flex gap-1 mt-6">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-slate-600"
              style={{ animation: `pulse 1.4s ${i * 0.2}s ease-in-out infinite` }}
            />
          ))}
        </div>
        <style>{`@keyframes pulse { 0%,100% { opacity:0.3 } 50% { opacity:1 } }`}</style>
      </div>
    );
  }

  const sections = result.sections.filter((s) => s.total > 0);

  return (
    <div className="max-w-[640px] mx-auto">
      {/* Live badge */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-slate-500">Ваша смета</h2>
        {updatedAt && (
          <span className="text-[11px] text-slate-600 tabular-nums">Обновлено {formatTime(updatedAt)}</span>
        )}
      </div>

      {/* Sections */}
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden mb-4">
        {sections.map((section, i) => {
          const items = section.items?.filter((it) => !it.included && (it.price ?? 0) > 0) ?? [];
          if (items.length === 0 && section.total === 0) return null;
          return (
            <div key={i} className={i > 0 ? "border-t border-white/[0.05]" : ""}>
              <div className="flex items-center justify-between px-5 py-3 bg-white/[0.02]">
                <span className="text-[11px] font-semibold tracking-[0.07em] uppercase text-slate-500">{section.title}</span>
                <span className="text-[12px] font-semibold text-slate-400 tabular-nums">{money(section.total)}</span>
              </div>
              {items.map((item, j) => (
                <div key={j} className="flex items-center justify-between px-5 py-2.5 border-t border-white/[0.04]">
                  <span className="text-[13px] text-slate-400">{item.label}</span>
                  <span className="text-[13px] text-slate-300 tabular-nums">{item.price != null ? money(item.price) : ""}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between bg-blue-600/[0.1] border border-blue-600/20 rounded-xl px-6 py-5">
        <span className="text-[13px] font-semibold text-slate-300">Итого</span>
        <span className="text-3xl font-bold text-slate-100 tabular-nums tracking-tight">{money(result.total)}</span>
      </div>

      <p className="text-center text-[11px] text-slate-700 mt-4">
        Смета обновляется в режиме реального времени · код {code}
      </p>
    </div>
  );
}
