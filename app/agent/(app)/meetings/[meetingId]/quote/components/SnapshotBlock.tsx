"use client";

import {
  type EstimateSnapshot,
  type MemorialData,
  type MemorialStatus,
  calculateBudgetStatus,
  formatCurrency,
} from "@/lib/calculationUtils";
import s from "../QuoteBuilder.module.css";

export function SnapshotBlock({
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
    <details className={s.snapshotBlock}>
      <summary className={s.collapseHead}>
        <span className={s.collapseTitle}>История версий</span>
        <span className={s.economicsTag}>{snapshots.length}</span>
      </summary>
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
                  <span>Экономия агента {formatCurrency(snapshot.orderMarginRub)}</span>
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
    </details>
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
