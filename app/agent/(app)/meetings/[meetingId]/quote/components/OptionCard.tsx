"use client";

import { Check } from "@phosphor-icons/react";
import { type CatalogItem, formatCurrency } from "@/lib/calculationUtils";
import s from "../QuoteBuilder.module.css";

export function OptionCard({
  item,
  selected,
  selectedColor,
  onToggle,
  onColorChange,
}: {
  item: CatalogItem;
  selected: boolean;
  selectedColor?: string;
  onToggle: () => void;
  onColorChange: (color: string) => void;
}) {
  return (
    <article className={`${s.optCard} ${selected ? s.optCardActive : ""}`}>
      <button type="button" className={s.optMain} onClick={onToggle} aria-pressed={selected}>
        <span className={s.optMedia} aria-hidden="true">{item.imagePlaceholder}</span>
        <span className={s.optInfo}>
          <span className={s.optTop}>
            <span className={s.optName}>{item.name}</span>
            <span className={`${s.optCheck} ${selected ? s.optCheckOn : ""}`} aria-hidden="true">
              {selected && <Check size={12} weight="bold" />}
            </span>
          </span>
          <span className={s.optPrice}>{formatCurrency(item.clientPrice)}</span>
          {(item.isRecommended || item.isRequired) && (
            <span className={s.optBadge}>{item.isRequired ? "Обязательное" : "Рекомендовано"}</span>
          )}
        </span>
      </button>

      {item.availableColors && item.availableColors.length > 0 && (
        <div className={s.optColors} aria-label={`Цвет для ${item.name}`}>
          {item.availableColors.map((color) => (
            <button
              key={color}
              type="button"
              className={`${s.colorChip} ${selectedColor === color ? s.colorChipActive : ""}`}
              onClick={() => onColorChange(color)}
            >
              {color}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
