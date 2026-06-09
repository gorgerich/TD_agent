"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { Briefcase, CalendarDots, FileText, Files, CheckSquare } from "@phosphor-icons/react";
import { COMMAND_OPEN_EVENT } from "@/components/CommandPalette";

type PhaseId = "before" | "meeting" | "after";

const PHASES: Array<{
  id: PhaseId;
  label: string;
  caption: string;
  href: string;
  icon: ComponentType<{ size?: number; weight?: "regular" | "fill" | "duotone" | "bold" }>;
}> = [
  { id: "before", label: "До встречи", caption: "Кейс, календарь, задачи", href: "/agent/cases", icon: Briefcase },
  { id: "meeting", label: "Встреча", caption: "Смета и показ клиенту", href: "/agent/estimates", icon: FileText },
  { id: "after", label: "После", caption: "Документы и закрытие", href: "/agent/documents", icon: Files },
];

function phaseFromPath(pathname: string): PhaseId {
  if (pathname.includes("/quote") || pathname.startsWith("/agent/estimates")) return "meeting";
  if (pathname.startsWith("/agent/documents") || pathname.startsWith("/agent/settings")) return "after";
  return "before";
}

function CurrentAction({ phase }: { phase: PhaseId }) {
  if (phase === "meeting") {
    return (
      <Link href="/agent/estimates" className="td-mini-row hidden items-center gap-2 px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 sm:flex">
        <FileText size={14} weight="duotone" /> Сметы
      </Link>
    );
  }
  if (phase === "after") {
    return (
      <Link href="/agent/tasks" className="td-mini-row hidden items-center gap-2 px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 sm:flex">
        <CheckSquare size={14} weight="duotone" /> Задачи
      </Link>
    );
  }
  return (
    <Link href="/agent/meetings" className="td-mini-row hidden items-center gap-2 px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 sm:flex">
      <CalendarDots size={14} weight="duotone" /> Календарь
    </Link>
  );
}

export default function AgentJourneyBar() {
  const pathname = usePathname();
  const activePhase = phaseFromPath(pathname);

  return (
    <div className="td-journey-bar sticky top-14 z-30 px-3 py-2 lg:top-0 lg:px-7">
      <div className="mx-auto flex w-full max-w-[1280px] items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {PHASES.map((phase, index) => {
            const active = phase.id === activePhase;
            const Icon = phase.icon;
            return (
              <Link
                key={phase.id}
                href={phase.href}
                aria-current={active ? "step" : undefined}
                className={`td-press group flex min-h-11 min-w-[136px] flex-shrink-0 items-center gap-2.5 rounded-[15px] border px-2.5 py-1.5 ${
                  active
                    ? "border-accent/20 bg-accent-soft text-ink shadow-[var(--hl-top)]"
                    : "border-transparent text-ink-2 hover:border-line hover:bg-surface/70"
                }`}
              >
                <span className="td-nav-orb h-8 w-8 rounded-[13px]" data-active={active ? "true" : undefined}>
                  <Icon size={16} weight={active ? "fill" : "duotone"} />
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-[12px] font-semibold">{index + 1}. {phase.label}</span>
                  <span className="block truncate text-[10px] font-medium text-ink-3">{phase.caption}</span>
                </span>
              </Link>
            );
          })}
        </div>
        <CurrentAction phase={activePhase} />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(COMMAND_OPEN_EVENT))}
          className="td-press hidden min-h-9 flex-shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[12px] font-semibold text-ink-2 shadow-[var(--hl-top)] hover:border-line-strong hover:bg-surface-2 md:inline-flex"
        >
          <span className="tnum rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">⌘K</span>
          Действия
        </button>
      </div>
    </div>
  );
}
