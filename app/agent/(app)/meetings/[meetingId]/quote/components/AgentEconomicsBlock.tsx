"use client";

import { useState } from "react";
import type { CommercialEconomics } from "@/lib/commercialQuote";
import { formatMinorUnitsCurrency } from "@/lib/calculationUtils";
import s from "../QuoteBuilder.module.css";

export function AgentEconomicsBlock({
  budgetMessage,
  budgetStatus,
  clientBudgetMinor,
  budgetRemainingMinor,
  economics,
  marginWarning,
}: {
  budgetMessage: string;
  budgetStatus: "unknown_total" | "not_set" | "within" | "near_limit" | "exceeded";
  clientBudgetMinor: number | null;
  budgetRemainingMinor: number | null;
  economics: CommercialEconomics;
  marginWarning: string | null;
}) {
  const [open, setOpen] = useState(!!marginWarning);

  // Auto-expand when a margin warning appears (render-time state-adjust pattern,
  // рекомендованный React вместо setState в эффекте).
  const [prevWarning, setPrevWarning] = useState(marginWarning);
  if (marginWarning !== prevWarning) {
    setPrevWarning(marginWarning);
    if (marginWarning) setOpen(true);
  }

  return (
    <div className={s.economicsBlock}>
      <button
        type="button"
        className={s.collapseHead}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={s.collapseTitle}>Экономика сделки</span>
        <span className={s.economicsTag}>Только для команды</span>
        {marginWarning && <span className={s.collapseAlert} aria-label="Внимание по марже" />}
      </button>

      {open && (
        <>
          <div className={s.economicsGrid}>
            <Metric label="Бюджет клиента" value={moneyOr(clientBudgetMinor, "Не указан")} />
            <Metric label="Итог клиенту" value={moneyOr(economics.total, "Требует уточнения")} />
            <Metric
              label={budgetStatus === "exceeded" ? "Превышение" : "Остаток"}
              value={moneyOr(budgetRemainingMinor === null ? null : Math.abs(budgetRemainingMinor), "Не рассчитывается")}
            />
            <Metric label="Себестоимость" value={moneyOr(economics.costTotal, "Не подтверждена")} />
            <Metric label="Валовая маржа" value={moneyOr(economics.margin, "Не рассчитывается")} />
            <Metric label="Позиции в расчёте" value={String(economics.items.length)} />
          </div>

          <div className={`${s.budgetLine} ${budgetStatus === "exceeded" ? s.budgetLineWarn : ""}`}>
            {budgetMessage}
          </div>
          {budgetStatus === "exceeded" && (
            <div className={s.economicsHint}>Можно снизить цену, заменить позиции или убрать необязательные услуги.</div>
          )}
          {marginWarning && <div className={s.marginWarning}>{marginWarning}</div>}

          {economics.items.length > 0 && (
            <details className={s.marginDetails}>
              <summary>Расчёт по позициям ({economics.items.length})</summary>
              <div className={s.marginList}>
                {economics.items.slice(0, 10).map((item) => (
                  <div key={item.stableKey} className={s.marginItem}>
                    <div className={s.marginItemMain}>
                      <span className={s.marginItemName}>{item.description}</span>
                      <span className={s.marginItemPrice}>
                        {item.clientVisible
                          ? moneyOr(item.clientTotal, "Цена не подтверждена")
                          : "Не включено клиенту"}
                      </span>
                    </div>
                    <div className={s.marginItemMeta}>
                      <span>Себестоимость: {moneyOr(item.costTotal, "не подтверждена")}</span>
                      <span>Маржа: {moneyOr(item.margin, "не рассчитывается")}</span>
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

function moneyOr(value: number | null, fallback: string) {
  return value === null ? fallback : formatMinorUnitsCurrency(value);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
