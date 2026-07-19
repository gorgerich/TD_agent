"use client";

import { useState } from "react";
import Link from "next/link";
import { CaretDown, Phone, FileText, Files, Briefcase, Check } from "@phosphor-icons/react";
import { phone as fmtPhone } from "@/lib/format";
import type { Stage } from "@/lib/case";
import { buttonClasses } from "@/components/ui/Button";

export type CalEvent = {
  id: number;
  caseId: string;
  leadId: number;
  kind: "meeting" | "ceremony";
  name: string;
  phone: string;
  time: string;
  sortKey: number;
  status: string;
  past: boolean;
  stage: Stage;
  nextAction: string;
  hasQuote: boolean;
  docCount: number;
  channel?: string;
  place?: string | null;
  outcome?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  TENTATIVE: "Время не согласовано",
  SCHEDULED: "Запланирована",
  CONFIRMED: "Подтверждена",
  COMPLETED: "Завершена",
  NO_SHOW: "Не состоялась",
  CANCELLED: "Отменена",
  CEREMONY: "Церемония",
};

const CEREMONY_PREP = [
  "Подтвердить транспорт и время выезда",
  "Проверить комплект документов",
  "Связаться с площадкой",
];

const STAGE_PREP: Record<Stage, string[]> = {
  "Лид": ["Уточнить пожелания и бюджет семьи", "Подготовить варианты организации"],
  "Документы": ["Проверить список документов", "Зафиксировать отсутствующие документы"],
  "Смета": ["Открыть актуальную версию сметы", "Подготовить варианты в рамках бюджета"],
  "Договор": ["Проверить условия договора", "Согласовать следующий шаг"],
  "Оплата": ["Подтвердить график оплаты", "Зафиксировать договорённость"],
  "Завершено": ["Передать финальные документы", "Зафиксировать итог кейса"],
};

export function EventRow({ event }: { event: CalEvent }) {
  const [open, setOpen] = useState(false);
  const statusLabel = event.past && event.kind === "meeting" ? "Нужен итог" : (STATUS_LABELS[event.status] ?? event.status);

  return (
    <li className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="td-entity-row group grid w-full min-w-0 grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left sm:grid-cols-[110px_minmax(0,1fr)_160px_auto]"
      >
        <span className={`tnum text-[13px] font-semibold ${event.status === "TENTATIVE" ? "text-warning" : "text-ink"}`}>{event.time}</span>
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-semibold text-ink">{event.name}</span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-3">{event.nextAction}</span>
        </span>
        <span className={`hidden text-[12px] font-medium sm:block ${event.past ? "text-danger" : "text-ink-2"}`}>{statusLabel}</span>
        <CaretDown size={16} weight="bold" className={`flex-none text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-line bg-surface-2/45 px-4 py-4">
          <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-ink">
                {event.kind === "ceremony" ? "Контроль дня церемонии" : event.past ? "Зафиксируйте результат встречи" : "Подготовка"}
              </p>
              <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
                <span>{event.kind === "ceremony" ? "Церемония" : STATUS_LABELS[event.status]}</span>
                {event.place && <><span aria-hidden>·</span><span>{event.place}</span></>}
                <span aria-hidden>·</span>
                <a href={`tel:${event.phone}`} className="inline-flex items-center gap-1 hover:text-accent"><Phone size={13} weight="bold" /> {fmtPhone(event.phone)}</a>
              </p>
              {event.outcome ? (
                <p className="mt-3 max-w-[66ch] text-[13px] leading-relaxed text-ink-2"><strong className="text-ink">Результат:</strong> {event.outcome}</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {(event.kind === "ceremony" ? CEREMONY_PREP : STAGE_PREP[event.stage]).map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[13px] text-ink-2">
                      <Check size={14} weight="bold" className="mt-0.5 flex-none text-accent" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {event.kind !== "ceremony" && (
                <p className="mt-3 text-[11px] text-ink-3">Смета: {event.hasQuote ? "есть" : "не собрана"} · Документов: {event.docCount}</p>
              )}
            </div>
            <div className={`grid gap-2 sm:flex sm:flex-col ${event.kind === "ceremony" ? "grid-cols-2" : "grid-cols-3"}`}>
              <Link href={`/agent/cases/${event.leadId}?tab=work`} className={buttonClasses({ size: "sm", className: "justify-center" })}>
                <Briefcase size={14} weight="fill" /> Кейс
              </Link>
              {event.kind !== "ceremony" && (
                <Link href={`/agent/meetings/${event.id}`} className={buttonClasses({ variant: "secondary", size: "sm", className: "justify-center" })}>
                  <FileText size={14} weight="bold" /> Встреча
                </Link>
              )}
              <Link href={`/agent/documents?case=${event.leadId}`} className={buttonClasses({ variant: "secondary", size: "sm", className: "justify-center" })}>
                <Files size={14} weight="bold" /> Документы
              </Link>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export default EventRow;
