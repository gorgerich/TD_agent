"use client";

import { useState, useEffect } from "react";
import {
  type ItemMargin,
  calculateOrderEconomics,
  formatCurrency,
} from "@/lib/calculationUtils";
import s from "../QuoteBuilder.module.css";

export function AgentEconomicsBlock({
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
  const [open, setOpen] = useState(false);

  // Auto-expand when there is a margin warning so the agent sees it.
  useEffect(() => {
    if (marginWarning) setOpen(true);
  }, [marginWarning]);

  return (
    <div className={s.economicsBlock}>
      <button
        type="button"
        className={s.collapseHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={s.collapseTitle}>Экономика сделки</span>
        <span className={s.economicsTag}>внутренне</span>
        {marginWarning && <span className={s.collapseAlert} aria-label="Внимание по марже" />}
      </button>

      {open && (
        <>
          <div className={s.economicsGrid}>
            <Metric label="Бюджет клиента" value={clientBudget ? formatCurrency(clientBudget) : "Не указан"} />
            <Metric label="Итог клиенту" value={formatCurrency(economics.orderClientTotal)} />
            <Metric
              label={budgetStatus === "exceeded" ? "Превышение" : "Остаток"}
              value={budgetStatus === "not_set" ? "—" : formatCurrency(Math.abs(economics.orderClientTotal - (clientBudget ?? 0)))}
            />
            <Metric label="Себестоимость" value={formatCurrency(economics.orderCostTotal)} />
            <Metric label="Экономия агента" value={formatCurrency(economics.orderMarginRub)} />
            <Metric label="Позиции в расчёте" value={String(marginItems.length)} />
          </div>

          <div className={`${s.budgetLine} ${budgetStatus === "exceeded" ? s.budgetLineWarn : ""}`}>
            {budgetMessage}
          </div>
          {budgetStatus === "exceeded" && (
            <div className={s.economicsHint}>Можно снизить цену, заменить позиции или убрать необязательные услуги.</div>
          )}
          {marginWarning && <div className={s.marginWarning}>{marginWarning}</div>}

          {marginItems.length > 0 && (
            <details className={s.marginDetails}>
              <summary>Внутренние позиции ({marginItems.length})</summary>
              <div className={s.marginList}>
                {marginItems.slice(0, 10).map((item) => (
                  <div key={`${item.category}-${item.name}-${item.totalClientPrice}`} className={s.marginItem}>
                    <div className={s.marginItemMain}>
                      <span className={s.marginItemName}>{item.name}</span>
                      <span className={s.marginItemPrice}>{formatCurrency(item.totalClientPrice)}</span>
                    </div>
                    <div className={s.marginItemMeta}>
                      <span>Себестоимость {formatCurrency(item.totalCostPrice)}</span>
                      <span>Экономия {formatCurrency(item.marginRub)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
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
