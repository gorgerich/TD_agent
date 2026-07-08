"use client";

import { useState } from "react";
import { Link } from "next-view-transitions";
import { CaseRowActions } from "./CaseRowActions";

export type Bucket = "critical" | "today" | "awaitClient" | "awaitPayment" | "progress";

// Отображаемые поля строки (всё сериализуемо для server→client).
export type CaseRowView = {
  id: number;
  name: string;
  phone: string;
  bucket: Bucket;
  cobrowse: string | null;
  firstMeetingId: number | null;
  nextAction: string;
  statusLabel: string;
  ceremonyLabel: string;
  hoursToCeremony: number | null;
  urgent: boolean;
  soon: boolean;
  stale: boolean;
  ceremonySoon: boolean;
};

const BUCKETS: Array<{ id: Bucket; label: string; tone: string }> = [
  { id: "critical", label: "Срочное", tone: "text-danger" },
  { id: "today", label: "Сегодня", tone: "text-accent" },
  { id: "awaitClient", label: "Ждём клиента", tone: "text-ink-3" },
  { id: "awaitPayment", label: "Ждём оплату", tone: "text-warning" },
  { id: "progress", label: "В работе", tone: "text-ink-3" },
];

type Filter = "all" | Bucket;

export function CasesList({ rows }: { rows: CaseRowView[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts = (id: Bucket) => rows.filter((r) => r.bucket === id).length;
  const present = BUCKETS.filter((b) => counts(b.id) > 0);

  // Если выбранный фильтр опустел (нет таких дел) — откат на «Все».
  const activeFilter: Filter = filter !== "all" && counts(filter) === 0 ? "all" : filter;

  const chips: Array<{ id: Filter; label: string; count: number }> = [
    { id: "all", label: "Все", count: rows.length },
    ...present.map((b) => ({ id: b.id, label: b.label, count: counts(b.id) })),
  ];

  return (
    <div>
      {/* Единый segmented-фильтр: меньше визуального шума, тот же паттерн что в сметах/документах. */}
      <div className="td-segmented mb-4">
        {chips.map((chip) => {
          const on = activeFilter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              aria-pressed={on}
              data-active={on ? "true" : undefined}
              className="td-segment"
            >
              {chip.label}
              <span className={`tnum text-[11px] ${on ? "text-ink/55" : "text-ink-3"}`}>{chip.count}</span>
            </button>
          );
        })}
      </div>

      {activeFilter === "all" ? (
        <div className="space-y-6">
          {present.map((b) => {
            const bucketRows = rows.filter((r) => r.bucket === b.id);
            return (
              <div key={b.id}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <span className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${b.tone}`}>{b.label}</span>
                  <span className="tnum text-[11px] font-semibold text-ink-3">{bucketRows.length}</span>
                </div>
                <ul className="td-entity-list">
                  {bucketRows.map((c) => <CaseRowItem key={c.id} c={c} />)}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="td-entity-list">
          {rows.filter((r) => r.bucket === activeFilter).map((c) => <CaseRowItem key={c.id} c={c} />)}
        </ul>
      )}
    </div>
  );
}

function CaseRowItem({ c }: { c: CaseRowView }) {
  const bar = c.ceremonySoon ? "before:bg-danger" : c.soon ? "before:bg-accent" : c.stale ? "before:bg-warning" : "before:bg-transparent";
  return (
    <li className="border-b border-line last:border-0">
      <div className={`td-entity-row group relative flex items-center pr-2 before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full ${bar}`}>
        <Link href={`/agent/cases/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 pl-5 pr-2">
          <Avatar name={c.name} urgent={c.urgent} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2.5">
              <span className="truncate text-[15px] font-semibold text-ink" style={{ viewTransitionName: `case-${c.id}` }}>{c.name}</span>
              {c.ceremonySoon ? (
                <span className="flex-shrink-0 text-[11px] font-bold text-danger">церемония через {c.hoursToCeremony} ч</span>
              ) : c.soon ? (
                <span className="flex-shrink-0 text-[11px] font-semibold text-accent">встреча скоро</span>
              ) : c.stale ? (
                <span className="flex-shrink-0 text-[11px] font-semibold text-warning">без движения</span>
              ) : null}
            </span>
            <span className="mt-1 block truncate text-[13px] text-ink-2">{c.nextAction}</span>
          </span>
          <span className="hidden flex-shrink-0 text-[12px] text-ink-3 sm:inline">
            {c.ceremonyLabel && !c.ceremonySoon ? `церемония ${c.ceremonyLabel}` : c.statusLabel}
          </span>
        </Link>
        <CaseRowActions caseId={c.id} phone={c.phone} cobrowse={c.cobrowse} firstMeetingId={c.firstMeetingId} />
      </div>
    </li>
  );
}

function Avatar({ name, urgent }: { name: string; urgent?: boolean }) {
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-[12px] font-semibold text-accent bg-accent-soft ${urgent ? "ring-2 ring-danger/30" : ""}`}
    >
      {initials}
    </span>
  );
}

export default CasesList;
