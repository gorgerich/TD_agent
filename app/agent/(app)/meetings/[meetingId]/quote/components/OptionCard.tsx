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
  onRequestPrice,
}: {
  item: CatalogItem;
  selected: boolean;
  selectedColor?: string;
  onToggle: () => void;
  onColorChange: (color: string) => void;
  onRequestPrice?: () => void;
}) {
  const priceKnown = item.priceState === undefined || item.priceState === "KNOWN";
  const priceLabel =
    priceKnown
      ? formatCurrency(item.clientPrice)
      : item.priceState === "REQUESTED"
        ? "Цена запрошена"
        : item.priceState === "EXPIRED"
          ? "Цена устарела"
          : "Цена не подтверждена";
  return (
    <article className={`${s.optCard} ${selected ? s.optCardActive : ""}`}>
      <button type="button" className={s.optMain} onClick={onToggle} aria-pressed={selected}>
        <span className={s.optMedia} aria-hidden="true">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" className={`${s.optMediaImg} td-img`} />
          ) : (
            item.imagePlaceholder
          )}
        </span>
        <span className={s.optInfo}>
          <span className={s.optTop}>
            <span className={s.optName}>{item.name}</span>
            <span className={`${s.optCheck} ${selected ? s.optCheckOn : ""}`} aria-hidden="true">
              {selected && <Check size={12} weight="bold" />}
            </span>
          </span>
          <span className={s.optPrice}>{priceLabel}</span>
          {(item.isRecommended || item.isRequired) && (
            <span className={s.optBadge}>{item.isRequired ? "Обязательное" : "Рекомендовано"}</span>
          )}
        </span>
      </button>
      {!priceKnown && onRequestPrice && (
        <button type="button" className={s.optPriceRequest} onClick={onRequestPrice}>
          {item.priceState === "REQUESTED" ? "Запрос отправлен" : "Запросить цену"}
        </button>
      )}

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
