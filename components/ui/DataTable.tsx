"use client";

// Операционная data-таблица на токенах TD (Linear/Mercury-ритм).
// Sticky-заголовок, зебра, hover-строка, выравнивание колонок, числа-tnum,
// клиентская сортировка по колонке. Без внешних зависимостей.
//
// Использование:
//   <DataTable rows={rows} columns={[
//     { key: "name", header: "Клиент", cell: (r) => r.name },
//     { key: "total", header: "Сумма", align: "right", numeric: true,
//       cell: (r) => formatCurrency(r.total), sortValue: (r) => r.total },
//   ]} />

import { useMemo, useState } from "react";
import { CaretUp, CaretDown } from "@phosphor-icons/react";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  /** Моноширинные табличные числа. */
  numeric?: boolean;
  /** Значение для сортировки; если задано — колонка сортируема. */
  sortValue?: (row: T) => number | string;
  /** Доля ширины (grid-template-columns). По умолчанию 1fr / auto для numeric. */
  width?: string;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty = "Нет данных",
  className = "",
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T, i: number) => string | number;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  className?: string;
}) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [rows, sort, columns]);

  const gridCols = columns
    .map((c) => c.width ?? (c.align === "right" || c.numeric ? "max-content" : "minmax(0,1fr)"))
    .join(" ");

  function toggleSort(key: string) {
    setSort((cur) =>
      cur?.key === key
        ? cur.dir === "asc" ? { key, dir: "desc" } : null
        : { key, dir: "asc" },
    );
  }

  const alignCls = (a?: Column<T>["align"]) =>
    a === "right" ? "justify-end text-right" : a === "center" ? "justify-center text-center" : "justify-start text-left";

  return (
    <div className={`overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-soft),var(--hl-top)] ${className}`}>
      <div className="overflow-x-auto">
        <div role="table" className="min-w-full">
          {/* Header */}
          <div
            role="row"
            className="sticky top-0 z-[1] grid items-center gap-4 border-b border-line bg-surface-2/70 px-5 py-2.5 backdrop-blur-sm"
            style={{ gridTemplateColumns: gridCols }}
          >
            {columns.map((col) => {
              const active = sort?.key === col.key;
              const sortable = Boolean(col.sortValue);
              return (
                <div key={col.key} role="columnheader" className={`flex items-center gap-1 ${alignCls(col.align)}`}>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 transition-colors hover:text-ink"
                    >
                      {col.header}
                      {active ? (
                        sort!.dir === "asc" ? <CaretUp size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />
                      ) : (
                        <CaretUp size={10} className="opacity-25" />
                      )}
                    </button>
                  ) : (
                    <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{col.header}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Body */}
          {sorted.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-ink-3">{empty}</div>
          ) : (
            sorted.map((row, i) => (
              <div
                key={rowKey(row, i)}
                role="row"
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`grid items-center gap-4 border-b border-line px-5 py-3 last:border-0 odd:bg-surface even:bg-surface-2/25 ${
                  onRowClick ? "cursor-pointer transition-colors hover:bg-surface-2/70" : ""
                }`}
                style={{ gridTemplateColumns: gridCols }}
              >
                {columns.map((col) => (
                  <div
                    key={col.key}
                    role="cell"
                    className={`flex items-center text-[14px] text-ink ${alignCls(col.align)} ${col.numeric ? "tnum font-medium" : ""}`}
                  >
                    {col.cell(row)}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default DataTable;
