"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MagnifyingGlass,
  Star,
  X,
  Plus,
  Check,
  Briefcase,
  Trash,
  Package,
} from "@phosphor-icons/react";
import { buttonClasses } from "@/components/ui/Button";
import {
  AGENT_ATTRIBUTION_CATALOG,
  CATALOG_CATEGORIES,
  formatCurrency,
  readShortlist,
  writeShortlist,
  type CatalogCategory,
  type CatalogItem,
  type ShortlistEntry,
} from "@/lib/calculationUtils";

type CatFilter = CatalogCategory | "Все";

const priceLabel = (item: CatalogItem) =>
  item.clientPrice > 0 ? formatCurrency(item.clientPrice) : "цена по запросу";

export default function CatalogPage() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<CatFilter>("Все");
  const [series, setSeries] = useState<string>("Все");
  const [active, setActive] = useState<CatalogItem | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  const [trayOpen, setTrayOpen] = useState(false);

  useEffect(() => {
    setShortlist(readShortlist());
    const sync = () => setShortlist(readShortlist());
    window.addEventListener("td-shortlist-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("td-shortlist-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const present = useMemo(
    () => CATALOG_CATEGORIES.filter((c) => AGENT_ATTRIBUTION_CATALOG.some((i) => i.category === c)),
    [],
  );

  const seriesOptions = useMemo(() => {
    if (cat !== "Гробы") return [];
    const set = new Set<string>();
    AGENT_ATTRIBUTION_CATALOG.forEach((i) => {
      if (i.category === "Гробы" && i.tags?.[0]) set.add(i.tags[0]);
    });
    return Array.from(set);
  }, [cat]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return AGENT_ATTRIBUTION_CATALOG.filter((i) => {
      if (cat !== "Все" && i.category !== cat) return false;
      if (cat === "Гробы" && series !== "Все" && i.tags?.[0] !== series) return false;
      if (q) {
        const hay = `${i.name} ${i.description} ${(i.tags ?? []).join(" ")} ${i.imagePlaceholder}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, cat, series]);

  const inShortlist = (id: string) => shortlist.some((e) => e.id === id);

  function toggleShortlist(item: CatalogItem) {
    const next = inShortlist(item.id)
      ? shortlist.filter((e) => e.id !== item.id)
      : [...shortlist, { id: item.id, color: item.availableColors?.[0] }];
    setShortlist(next);
    writeShortlist(next);
  }

  function clearShortlist() {
    setShortlist([]);
    writeShortlist([]);
    setTrayOpen(false);
  }

  const shortlistItems = useMemo(
    () =>
      shortlist
        .map((e) => AGENT_ATTRIBUTION_CATALOG.find((i) => i.id === e.id))
        .filter((i): i is CatalogItem => Boolean(i)),
    [shortlist],
  );
  const shortlistTotal = shortlistItems.reduce((s, i) => s + (i.clientPrice || 0), 0);

  function selectCat(next: CatFilter) {
    setCat(next);
    setSeries("Все");
  }

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="td-eyebrow">Товары и атрибутика</span>
          <h1 className="td-display mt-2.5 text-[30px] text-ink sm:text-[38px]">Маркетплейс</h1>
          <p className="mt-2 text-[13px] text-ink-2">
            <span className="font-semibold text-ink">{AGENT_ATTRIBUTION_CATALOG.length}</span> позиций ·
            реальный каталог ПО «Фаворит» · добавляются в смету на шаге «Атрибутика»
          </p>
        </div>
        <Link href="/agent/cases" className={buttonClasses({ size: "sm", className: "self-start flex-shrink-0" })}>
          <Briefcase size={14} weight="bold" /> Собрать смету по кейсу
        </Link>
      </header>

      {/* Поиск */}
      <div className="rise mb-3">
        <div className="relative">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск: гроб, венок, серия, артикул…"
            className="h-11 w-full rounded-full border border-line bg-surface pl-10 pr-10 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
              aria-label="Очистить поиск"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Категории */}
      <div className="rise mb-2.5 flex flex-wrap gap-2">
        {(["Все", ...present] as CatFilter[]).map((c) => {
          const count = c === "Все" ? AGENT_ATTRIBUTION_CATALOG.length : AGENT_ATTRIBUTION_CATALOG.filter((i) => i.category === c).length;
          const on = cat === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => selectCat(c)}
              className={[
                "rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors",
                on ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
              ].join(" ")}
            >
              {c} <span className={on ? "opacity-80" : "text-ink-3"}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Серии (для гробов) */}
      {seriesOptions.length > 0 && (
        <div className="rise mb-5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Серия:</span>
          {(["Все", ...seriesOptions] as string[]).map((sName) => {
            const on = series === sName;
            return (
              <button
                key={sName}
                type="button"
                onClick={() => setSeries(sName)}
                className={[
                  "rounded-full border px-3 py-1 text-[12px] transition-colors",
                  on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink-2 hover:border-line-strong",
                ].join(" ")}
              >
                {sName}
              </button>
            );
          })}
        </div>
      )}

      {/* Сетка */}
      {items.length === 0 ? (
        <div className="rise rise-1 td-shell px-6 py-14 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full icon-3d text-accent">
            <Package size={24} weight="duotone" />
          </span>
          <h2 className="td-display text-[22px] text-ink">Ничего не найдено</h2>
          <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-relaxed text-ink-2">
            Измените запрос или категорию.
          </p>
        </div>
      ) : (
        <div className="rise rise-1 grid grid-cols-2 gap-3 pb-24 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <CatalogCard
              key={item.id}
              item={item}
              picked={inShortlist(item.id)}
              onOpen={() => setActive(item)}
              onPick={() => toggleShortlist(item)}
            />
          ))}
        </div>
      )}

      {/* Карточка товара (модалка) */}
      {active && (
        <ProductModal
          item={active}
          picked={inShortlist(active.id)}
          onPick={() => toggleShortlist(active)}
          onClose={() => setActive(null)}
        />
      )}

      {/* Плавающая подборка */}
      {shortlistItems.length > 0 && (
        <ShortlistTray
          items={shortlistItems}
          total={shortlistTotal}
          open={trayOpen}
          onToggle={() => setTrayOpen((v) => !v)}
          onRemove={(id) => {
            const next = shortlist.filter((e) => e.id !== id);
            setShortlist(next);
            writeShortlist(next);
          }}
          onClear={clearShortlist}
        />
      )}
    </div>
  );
}

function CatalogCard({
  item,
  picked,
  onOpen,
  onPick,
}: {
  item: CatalogItem;
  picked: boolean;
  onOpen: () => void;
  onPick: () => void;
}) {
  return (
    <article className="td-shell group flex min-w-0 flex-col overflow-hidden">
      <button type="button" onClick={onOpen} className="relative block aspect-[4/3] w-full bg-white" aria-label={`Открыть ${item.name}`}>
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.name} className="h-full w-full object-contain p-2 transition-transform duration-200 group-hover:scale-[1.03]" />
        ) : (
          <span className="grid h-full w-full place-items-center bg-accent-soft">
            <span className="td-display text-[26px] text-accent/70">{item.imagePlaceholder}</span>
          </span>
        )}
        {item.isRecommended && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-on-accent">
            <Star size={10} weight="fill" /> Рекомендуем
          </span>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col p-3">
        <span className="text-[11px] font-medium text-ink-3">{item.tags?.[0] ?? item.category}</span>
        <button type="button" onClick={onOpen} className="mt-0.5 text-left text-[14px] font-semibold leading-snug text-ink hover:text-accent">
          {item.name}
        </button>
        {item.description && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-3">{item.description}</p>}

        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <span className="tnum text-[14px] font-semibold text-gold">{priceLabel(item)}</span>
          <button
            type="button"
            onClick={onPick}
            aria-pressed={picked}
            className={[
              "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition-colors",
              picked ? "border-accent bg-accent text-on-accent" : "border-line bg-surface text-ink-2 hover:border-accent hover:text-accent",
            ].join(" ")}
          >
            {picked ? <Check size={12} weight="bold" /> : <Plus size={12} weight="bold" />}
            {picked ? "В подборке" : "В подборку"}
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductModal({
  item,
  picked,
  onPick,
  onClose,
}: {
  item: CatalogItem;
  picked: boolean;
  onPick: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="td-shell relative flex w-full max-w-[860px] flex-col overflow-hidden rounded-t-[20px] sm:rounded-[20px] md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-surface/90 text-ink-2 shadow-sm hover:text-ink"
          aria-label="Закрыть"
        >
          <X size={18} />
        </button>

        <div className="aspect-[4/3] w-full flex-shrink-0 bg-white md:aspect-auto md:w-[55%]">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.name} className="h-full w-full object-contain p-4" />
          ) : (
            <span className="grid h-full w-full place-items-center bg-accent-soft">
              <span className="td-display text-[40px] text-accent/70">{item.imagePlaceholder}</span>
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-5 sm:p-6">
          <div>
            <span className="td-eyebrow">{item.tags?.[0] ?? item.category}</span>
            <h2 className="td-display mt-1.5 text-[24px] leading-tight text-ink">{item.name}</h2>
            <p className="mt-0.5 text-[12px] text-ink-3">{item.category} · арт. {item.imagePlaceholder}</p>
          </div>

          {item.description && <p className="text-[13px] leading-relaxed text-ink-2">{item.description}</p>}

          {item.availableColors && item.availableColors.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">Цвета</p>
              <div className="flex flex-wrap gap-1.5">
                {item.availableColors.map((c) => (
                  <span key={c} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink-2">{c}</span>
                ))}
              </div>
            </div>
          )}

          {item.tags && item.tags.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.slice(1).map((t) => (
                <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-3">#{t}</span>
              ))}
            </div>
          )}

          <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
            <span className="tnum text-[20px] font-semibold text-gold">{priceLabel(item)}</span>
            <button
              type="button"
              onClick={onPick}
              className={buttonClasses({
                variant: picked ? "secondary" : "primary",
                size: "md",
              })}
            >
              {picked ? <Check size={15} weight="bold" /> : <Plus size={15} weight="bold" />}
              {picked ? "В подборке" : "Добавить в подборку"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortlistTray({
  items,
  total,
  open,
  onToggle,
  onRemove,
  onClear,
}: {
  items: CatalogItem[];
  total: number;
  open: boolean;
  onToggle: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
      <div className="w-full max-w-[640px] overflow-hidden rounded-[18px] border border-line bg-surface shadow-[var(--shadow-lift)]">
        {open && (
          <div className="max-h-[40vh] overflow-y-auto border-b border-line p-3">
            {items.map((i) => (
              <div key={i.id} className="flex items-center gap-3 py-1.5">
                <span className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-[8px] border border-line bg-white">
                  {i.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.imageUrl} alt="" className="h-full w-full object-contain" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{i.name}</span>
                <span className="tnum text-[12px] text-ink-2">{i.clientPrice > 0 ? formatCurrency(i.clientPrice) : "по запросу"}</span>
                <button type="button" onClick={() => onRemove(i.id)} className="text-ink-3 hover:text-danger" aria-label="Убрать">
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 p-3">
          <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-accent text-on-accent text-[13px] font-bold">
              {items.length}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">Подборка</span>
              <span className="tnum block text-[12px] text-ink-2">от {formatCurrency(total)}</span>
            </span>
          </button>
          <button type="button" onClick={onClear} className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-[12px] text-ink-3 hover:text-danger" title="Очистить подборку">
            <Trash size={14} /> Очистить
          </button>
          <Link href="/agent/cases" className={buttonClasses({ size: "sm" })}>
            <Briefcase size={14} weight="bold" /> Перенести в смету
          </Link>
        </div>
      </div>
    </div>
  );
}
