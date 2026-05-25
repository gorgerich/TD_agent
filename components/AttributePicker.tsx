"use client";

import { Check } from "@phosphor-icons/react";
import { ATTRIBUTE_CATALOG, type AttrItem, type AttrSelection } from "@/lib/attributes";
import { formatCurrency } from "@/lib/calculationUtils";

/** Превью материала в слоте под фото (пока image=null показываем свотч). */
function Swatch({ item }: { item: AttrItem }) {
  if (item.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.image} alt={item.name} className="h-full w-full rounded-[8px] object-cover" />;
  }
  const r = item.render;
  if (item.category === "wreath") {
    return (
      <span className="grid h-full w-full place-items-center rounded-[8px]" style={{ background: r.color }}>
        <span className="block h-3.5 w-3.5 rounded-full" style={{ background: r.accent }} />
      </span>
    );
  }
  if (item.category === "fittings") {
    return <span className="block h-full w-full rounded-[8px]" style={{ background: `linear-gradient(135deg, #ffffffaa, ${r.metal} 55%, #00000022)` }} />;
  }
  if (item.category === "cross") {
    return (
      <span className="grid h-full w-full place-items-center rounded-[8px] bg-surface-2">
        <span className="relative block h-7 w-1.5 rounded-sm" style={{ background: r.color }}>
          <span className="absolute left-1/2 top-2 h-1.5 w-5 -translate-x-1/2 rounded-sm" style={{ background: r.color }} />
        </span>
      </span>
    );
  }
  // coffin / textile — заливка цветом материала
  return <span className="block h-full w-full rounded-[8px]" style={{ background: r.color }} />;
}

export default function AttributePicker({
  selection,
  onChange,
  disabled = false,
}: {
  selection: AttrSelection;
  onChange: (next: AttrSelection) => void;
  disabled?: boolean;
}) {
  function pickSingle(category: AttrItem["category"], id: string, optional: boolean) {
    if (disabled) return;
    const key = category as "coffin" | "fittings" | "textile" | "cross";
    const current = selection[key];
    const next = optional && current === id ? undefined : id;
    onChange({ ...selection, [key]: next });
  }

  function toggleWreath(id: string) {
    if (disabled) return;
    const has = selection.wreaths?.includes(id);
    onChange({
      ...selection,
      wreaths: has ? selection.wreaths.filter((w) => w !== id) : [...(selection.wreaths ?? []), id],
    });
  }

  return (
    <div className="space-y-6">
      {ATTRIBUTE_CATALOG.map((group) => (
        <section key={group.category}>
          <div className="mb-2.5 flex items-baseline justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">{group.title}</h3>
            {group.optional && <span className="text-[11px] text-ink-3">{group.multi ? "можно несколько" : "по желанию"}</span>}
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {group.items.map((item) => {
              const active = group.multi ? selection.wreaths?.includes(item.id) : selection[group.category as "coffin"] === item.id;
              return (
                <button
                  type="button"
                  key={item.id}
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => (group.multi ? toggleWreath(item.id) : pickSingle(item.category, item.id, group.optional))}
                  className={[
                    "group relative flex items-center gap-3 rounded-[12px] border p-2.5 text-left transition-colors",
                    active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong",
                    disabled ? "cursor-default opacity-70" : "cursor-pointer",
                  ].join(" ")}
                >
                  <span className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-[8px] border border-line">
                    <Swatch item={item} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-ink">{item.name}</span>
                    <span className="tnum block text-[12px] text-ink-2">{formatCurrency(item.price)}</span>
                  </span>
                  {active && (
                    <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-accent text-on-accent">
                      <Check size={12} weight="bold" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
