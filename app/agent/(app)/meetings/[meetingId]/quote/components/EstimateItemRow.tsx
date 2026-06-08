"use client";

import type { EstimateItem } from "@/lib/calculationUtils";
import s from "../QuoteBuilder.module.css";

export function EstimateItemRow({
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
