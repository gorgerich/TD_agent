"use client";

import { useState } from "react";
import Link from "next/link";
import { CaretDown, Phone, FileText, Files, Briefcase, Check } from "@phosphor-icons/react";
import { phone as fmtPhone } from "@/lib/format";
import type { Stage } from "@/lib/case";

export type CalEvent = {
  id: number;
  leadId: number;
  name: string;
  phone: string;
  time: string;
  status: string;
  past: boolean;
  stage: Stage;
  nextAction: string;
  hasQuote: boolean;
  docCount: number;
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Запланирована",
  IN_PROGRESS: "Идёт",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
};
const STATUS_DOT: Record<string, string> = {
  SCHEDULED: "bg-info",
  IN_PROGRESS: "bg-warning",
  COMPLETED: "bg-success",
  CANCELLED: "bg-ink-3",
};
const STATUS_BAR: Record<string, string> = {
  SCHEDULED: "before:bg-info",
  IN_PROGRESS: "before:bg-warning",
  COMPLETED: "before:bg-success",
  CANCELLED: "before:bg-ink-3",
};

// Что подготовить к встрече — по текущей стадии кейса.
const STAGE_PREP: Record<Stage, string[]> = {
  "Лид": ["Уточнить пожелания и бюджет семьи", "Подготовить типовые пакеты услуг"],
  "Документы": ["Взять бланки договора и согласий", "Список документов от семьи (паспорт, свидетельство)"],
  "Смета": ["Открыть смету для показа клиенту", "Подготовить 2–3 варианта пакета"],
  "Договор": ["Распечатать/открыть договор", "Реквизиты и условия оплаты"],
  "Оплата": ["Подтвердить детали оплаты", "Подготовить чек/квитанцию"],
  "Завершено": ["Передать финальные документы", "Собрать обратную связь"],
};

export function EventRow({ event: e }: { event: CalEvent }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`group relative flex w-full items-center gap-3.5 py-3 pl-5 pr-4 text-left transition-colors hover:bg-surface-2/50 before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full ${STATUS_BAR[e.status] ?? "before:bg-ink-3"} ${e.past ? "opacity-55" : ""}`}
      >
        <span className="tnum w-12 flex-shrink-0 text-[14px] font-semibold text-ink">{e.time}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{e.name}</span>
        <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2 sm:inline-flex">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[e.status] ?? "bg-ink-3"}`} />
          {STATUS_LABELS[e.status] ?? e.status}
        </span>
        <CaretDown size={16} className={`flex-shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-line bg-surface-2/40 px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="td-eyebrow text-accent">Подготовка к встрече</p>
              <p className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent">{e.stage}</span>
                <span className="text-ink-3">·</span>
                <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1 text-ink-2 hover:text-accent"><Phone size={13} /> {fmtPhone(e.phone)}</a>
              </p>
              <ul className="mt-3 space-y-1.5">
                {STAGE_PREP[e.stage].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[13px] text-ink">
                    <Check size={14} weight="bold" className="mt-0.5 flex-shrink-0 text-accent" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-ink-3">
                Смета: {e.hasQuote ? "собрана" : "не собрана"} · Документов: {e.docCount}
              </p>
            </div>
            <div className="flex flex-row gap-2 sm:flex-col">
              <Link href={`/agent/cases/${e.leadId}`} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent px-3.5 text-[12px] font-semibold text-on-accent shadow-[0_1px_2px_rgba(20,30,24,0.2),inset_0_1px_0_rgba(255,255,255,0.14)] transition-colors hover:bg-accent-hover">
                <Briefcase size={14} weight="bold" /> Кейс
              </Link>
              <Link href={`/agent/meetings/${e.id}/quote`} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[12px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2">
                <FileText size={14} /> Смета
              </Link>
              <Link href={`/agent/documents`} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[12px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2">
                <Files size={14} /> Док-ты
              </Link>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export default EventRow;
