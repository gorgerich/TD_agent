"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Briefcase,
  CalendarDots,
  SignOut,
  List,
  X,
  GraduationCap,
  MagnifyingGlass,
  FileText,
  Files,
  CheckSquare,
  GearSix,
} from "@phosphor-icons/react";
import type { AgentSession } from "@/lib/auth";
import { TOURS, TOUR_START_EVENT } from "@/lib/tour";
import { COMMAND_OPEN_EVENT } from "@/components/CommandPalette";

function CommandTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(COMMAND_OPEN_EVENT))}
      className="flex w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface-2/60 px-3 py-2.5 text-[13px] text-ink-3 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink-2"
    >
      <MagnifyingGlass size={16} className="flex-shrink-0" />
      <span className="flex-1 text-left">Поиск и действия</span>
      <kbd className="tnum rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-3">⌘K</kbd>
    </button>
  );
}

const NAV = [
  { href: "/agent/cases", icon: Briefcase, label: "Кейсы" },
  { href: "/agent/meetings", icon: CalendarDots, label: "Календарь" },
  { href: "/agent/estimates", icon: FileText, label: "Сметы" },
  { href: "/agent/documents", icon: Files, label: "Документы" },
  { href: "/agent/tasks", icon: CheckSquare, label: "Задачи" },
  { href: "/agent/settings", icon: GearSix, label: "Настройки" },
];

const ROLE_LABELS: Record<string, string> = {
  AGENT: "Агент",
  SENIOR_AGENT: "Старший агент",
  COORDINATOR: "Координатор",
  ADMIN: "Администратор",
  SUPPORT: "Поддержка",
};

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-[10px] border border-line-strong bg-surface">
        <span className="block h-2 w-2 rounded-full bg-accent" />
      </span>
      <span className="leading-none">
        <span className="block td-display text-[16px] text-ink">Тихий дом</span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">
          Кабинет агента
        </span>
      </span>
    </div>
  );
}

function NavLinks({ pathname, onNavigate, overdue = 0 }: { pathname: string; onNavigate?: () => void; overdue?: number }) {
  return (
    <div className="space-y-0.5">
      {NAV.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const badge = href === "/agent/tasks" && overdue > 0 ? overdue : 0;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={[
              "group relative flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2 text-[13px] transition-colors duration-200",
              active
                ? "bg-surface-2 font-semibold text-ink"
                : "font-medium text-ink-2 hover:bg-surface-2/55 hover:text-ink",
            ].join(" ")}
          >
            <span
              className={[
                "absolute left-0 top-1/2 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-accent transition-opacity duration-200",
                active ? "opacity-100" : "opacity-0",
              ].join(" ")}
            />
            <Icon
              size={18}
              weight={active ? "fill" : "regular"}
              className={active ? "text-accent" : "text-ink-3 group-hover:text-ink-2"}
            />
            {label}
            {badge > 0 && (
              <span className="tnum ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white" aria-label={`${badge} просроченных`}>
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function UserBlock({
  session,
  onLogout,
  onStartTour,
}: {
  session: AgentSession | null;
  onLogout: () => void;
  onStartTour: () => void;
}) {
  const initials = session?.name
    ? session.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "А";
  return (
    <div className="space-y-1.5">
      {session && (
        <div className="flex items-center gap-3 px-1.5 py-1.5">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
            {initials}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-ink">{session.name ?? "Агент"}</span>
            <span className="block text-[11px] text-ink-3">{ROLE_LABELS[session.role] ?? session.role}</span>
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={onStartTour}
        className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-2/55 hover:text-ink"
      >
        <GraduationCap size={16} className="text-ink-3" />
        Обучение
      </button>
      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[12px] font-medium text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <SignOut size={16} />
        Выйти
      </button>
    </div>
  );
}

export default function AgentSidebar({ session, overdue = 0 }: { session: AgentSession | null; overdue?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  async function logout() {
    await fetch("/api/agent/auth/logout", { method: "POST" });
    router.push("/agent/login");
    router.refresh();
  }

  function startTour() {
    setOpen(false);
    const onTourPage = TOURS.some((t) => t.match(pathname));
    if (onTourPage) {
      window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
    } else {
      // С любой страницы - на дашборд с принудительным запуском тура.
      router.push("/agent/dashboard#tour");
    }
  }

  return (
    <>
      {/* Desktop sidebar - тихий отельный рельс */}
      <nav className="td-rail fixed inset-y-0 left-0 z-40 hidden w-[260px] flex-col lg:flex">
        <div className="px-6 pb-6 pt-7">
          <Brand />
        </div>
        <div className="mx-4 mb-5">
          <CommandTrigger />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-1">
          <NavLinks pathname={pathname} overdue={overdue} />
        </div>
        <div className="border-t border-line px-4 py-4">
          <UserBlock session={session} onLogout={logout} onStartTour={startTour} />
        </div>
      </nav>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur-md lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="agent-mobile-menu"
          aria-label="Открыть меню"
          className="grid h-11 w-11 place-items-center rounded-[12px] border border-line bg-surface text-ink transition-colors hover:bg-surface-2"
        >
          <List size={22} />
        </button>
      </header>

      {/* Mobile drawer */}
      <div
        className={[
          "fixed inset-0 z-50 lg:hidden transition-opacity duration-200",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        aria-hidden={!open}
      >
        <div className="absolute inset-0 bg-ink/24 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
        <nav
          id="agent-mobile-menu"
          aria-label="Меню агента"
          className={[
            "absolute inset-y-0 left-0 flex w-[292px] max-w-[86vw] flex-col border-r border-line bg-surface shadow-pop transition-transform duration-200 ease-out",
            open ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <Brand />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрыть меню"
              className="grid h-10 w-10 place-items-center rounded-[12px] border border-line bg-surface text-ink transition-colors hover:bg-surface-2"
            >
              <X size={20} />
            </button>
          </div>
          <div className="mx-4 mt-4">
            <CommandTrigger />
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} overdue={overdue} />
          </div>
          <div className="border-t border-line px-4 py-4">
            <UserBlock session={session} onLogout={logout} onStartTour={startTour} />
          </div>
        </nav>
      </div>
    </>
  );
}
