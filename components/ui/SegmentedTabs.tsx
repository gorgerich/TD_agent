import Link from "next/link";

// Сегментированный фильтр на токенах TD (iOS/Linear-паттерн). Унифицирует
// дублировавшуюся разметку FilterTabs в сметах/документах. Server-friendly:
// активный таб передаётся пропом, переход — обычная навигация по href.

export type Segment<T extends string> = { id: T; label: string; count?: number };

export function SegmentedTabs<T extends string>({
  segments,
  active,
  hrefFor,
  ariaLabel = "Фильтр",
}: {
  segments: Segment<T>[];
  active: T;
  hrefFor: (id: T) => string;
  ariaLabel?: string;
}) {
  return (
    <nav className="rise td-segmented" aria-label={ariaLabel}>
      {segments.map((seg) => {
        const isActive = active === seg.id;
        return (
          <Link
            key={seg.id}
            href={hrefFor(seg.id)}
            data-active={isActive ? "true" : undefined}
            className="td-segment"
            aria-current={isActive ? "true" : undefined}
          >
            {seg.label}
            {seg.count !== undefined && (
              <span className={`tnum text-[11px] ${isActive ? "text-ink/55" : "text-ink-3"}`}>{seg.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export default SegmentedTabs;
