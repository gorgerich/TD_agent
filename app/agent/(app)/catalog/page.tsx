import Link from "next/link";
import { Package, Briefcase, Star } from "@phosphor-icons/react/dist/ssr";
import { buttonClasses } from "@/components/ui/Button";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import {
  AGENT_ATTRIBUTION_CATALOG,
  CATALOG_CATEGORIES,
  formatCurrency,
  type CatalogCategory,
  type CatalogItem,
} from "@/lib/calculationUtils";

type CatFilter = CatalogCategory | "Все";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams?: Promise<{ cat?: string }>;
}) {
  const params = await searchParams;
  // Категории, у которых есть позиции (пустые не показываем).
  const present = CATALOG_CATEGORIES.filter((c) => AGENT_ATTRIBUTION_CATALOG.some((i) => i.category === c));
  const active: CatFilter = present.includes(params?.cat as CatalogCategory) ? (params!.cat as CatalogCategory) : "Все";
  const items = active === "Все" ? AGENT_ATTRIBUTION_CATALOG : AGENT_ATTRIBUTION_CATALOG.filter((i) => i.category === active);

  const segments = [
    { id: "Все", label: "Все", count: AGENT_ATTRIBUTION_CATALOG.length },
    ...present.map((c) => ({ id: c, label: c, count: AGENT_ATTRIBUTION_CATALOG.filter((i) => i.category === c).length })),
  ];

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="td-eyebrow">Товары и атрибутика</span>
          <h1 className="td-display mt-2.5 text-[30px] text-ink sm:text-[38px]">Каталог</h1>
          <p className="mt-2 text-[13px] text-ink-2">
            <span className="font-semibold text-ink">{AGENT_ATTRIBUTION_CATALOG.length}</span> позиций · добавляются в смету на шаге «Атрибутика»
          </p>
        </div>
        <Link href="/agent/cases" className={buttonClasses({ size: "sm", className: "self-start flex-shrink-0" })}>
          <Briefcase size={14} weight="bold" /> Собрать смету по кейсу
        </Link>
      </header>

      <div className="rise mb-5">
        <SegmentedTabs
          ariaLabel="Категории каталога"
          active={active}
          segments={segments}
          hrefFor={(id) => (id === "Все" ? "/agent/catalog" : `/agent/catalog?cat=${encodeURIComponent(id)}`)}
        />
      </div>

      {items.length === 0 ? (
        <div className="rise rise-1 td-shell px-6 py-14 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full icon-3d text-accent">
            <Package size={24} weight="duotone" />
          </span>
          <h2 className="td-display text-[22px] text-ink">В этой категории пусто</h2>
          <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-relaxed text-ink-2">
            Позиции появятся здесь после наполнения каталога поставщика.
          </p>
        </div>
      ) : (
        <div className="rise rise-1 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => <CatalogCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}

function CatalogCard({ item }: { item: CatalogItem }) {
  return (
    <article className="td-shell flex min-w-0 flex-col overflow-hidden">
      {/* Превью: фото если есть, иначе плитка-плейсхолдер с артикулом */}
      <div className="relative aspect-[4/3] w-full bg-surface-2">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-accent-soft">
            <span className="td-display text-[28px] text-accent/70">{item.imagePlaceholder}</span>
          </div>
        )}
        {item.isRecommended && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-on-accent">
            <Star size={10} weight="fill" /> Рекомендуем
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3">
        <span className="text-[11px] font-medium text-ink-3">{item.category}</span>
        <h3 className="mt-0.5 text-[14px] font-semibold leading-snug text-ink">{item.name}</h3>
        {item.description && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-ink-3">{item.description}</p>}

        {item.availableColors && item.availableColors.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.availableColors.slice(0, 4).map((c) => (
              <span key={c} className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">{c}</span>
            ))}
            {item.availableColors.length > 4 && <span className="text-[10px] text-ink-3">+{item.availableColors.length - 4}</span>}
          </div>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <span className="tnum text-[14px] font-semibold text-gold">
            {item.clientPrice > 0 ? formatCurrency(item.clientPrice) : "цена по запросу"}
          </span>
        </div>
      </div>
    </article>
  );
}
