"use client";

import {
  type ExternalExpense,
  type ExternalExpenseCategory,
  calculateOrderEconomics,
  formatCurrency,
  EXTERNAL_EXPENSE_CATEGORIES,
  EXTERNAL_EXPENSE_PRESETS,
} from "@/lib/calculationUtils";
import s from "../QuoteBuilder.module.css";

export function ExternalExpensesBlock({
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
