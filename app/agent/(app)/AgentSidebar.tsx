"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Briefcase,
  CalendarDots,
  CheckSquare,
  FileText,
  Files,
  GearSix,
  SignOut,
  List,
  X,
  GraduationCap,
  MagnifyingGlass,
  Package,
  type Icon,
} from "@phosphor-icons/react";
import type { AgentSession } from "@/lib/auth";
import { TOURS, TOUR_START_EVENT } from "@/lib/tour";
import { COMMAND_OPEN_EVENT } from "@/components/CommandPalette";

function CommandTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(COMMAND_OPEN_EVENT))}
      className="td-rail-command td-press flex w-full items-center gap-2.5 rounded-[14px] bg-surface-2 px-3 py-2.5 text-[13px] text-ink-3 shadow-[var(--shadow-xs),var(--hl-top)] hover:bg-surface hover:text-ink-2"
    >
      <span className="grid h-7 w-7 place-items-center rounded-[10px] bg-surface text-ink-2 shadow-[var(--shadow-xs)]">
        <MagnifyingGlass size={16} weight="bold" />
      </span>
      <span className="flex-1 text-left">Поиск и действия</span>
      <kbd className="tnum hidden rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-3 shadow-[var(--shadow-xs)] lg:inline-flex">⌘K</kbd>
    </button>
  );
}

const PRIMARY_NAV = [
  { href: "/agent/cases", icon: Briefcase, label: "Кейсы" },
  { href: "/agent/meetings", icon: CalendarDots, label: "Календарь" },
  { href: "/agent/estimates", icon: FileText, label: "Сметы" },
  { href: "/agent/documents", icon: Files, label: "Документы" },
  { href: "/agent/tasks", icon: CheckSquare, label: "Задачи" },
] satisfies Array<{ href: string; icon: Icon; label: string }>;

const TOOL_NAV = [
  { href: "/agent/catalog", icon: Package, label: "Каталог" },
  { href: "/agent/settings", icon: GearSix, label: "Настройки" },
] satisfies Array<{ href: string; icon: Icon; label: string }>;

const ROLE_LABELS: Record<string, string> = {
  AGENT: "Агент",
  SENIOR_AGENT: "Старший агент",
  COORDINATOR: "Координатор",
  ADMIN: "Администратор",
  SUPPORT: "Поддержка",
};

function Brand({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="td-brand flex items-center gap-2">
        <Image src="/brand/tihiy-dom-mark.png" alt="" width={28} height={28} className="h-7 w-7 flex-shrink-0 rounded-[7px]" />
        <span className="text-[13px] font-semibold text-ink">
          Тихий дом <span className="font-medium text-ink-3">· Кабинет агента</span>
        </span>
      </div>
    );
  }
  return (
    <div className="td-brand flex items-center gap-2.5">
      <Image src="/brand/tihiy-dom-mark.png" alt="" width={36} height={36} className="h-9 w-9 flex-shrink-0 rounded-[9px]" />
      <span className="leading-none">
        <span className="block text-[15px] font-semibold tracking-[-0.01em] text-ink">Тихий дом</span>
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">Кабинет агента</span>
      </span>
    </div>
  );
}

function NavLinks({ pathname, onNavigate, overdue = 0 }: { pathname: string; onNavigate?: () => void; overdue?: number }) {
  return (
    <div className="space-y-6">
      <NavGroup label="Работа" items={PRIMARY_NAV} pathname={pathname} overdue={overdue} onNavigate={onNavigate} />
      <NavGroup label="Инструменты" items={TOOL_NAV} pathname={pathname} overdue={overdue} onNavigate={onNavigate} />
    </div>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  overdue,
  onNavigate,
}: {
  label: string;
  items: Array<{ href: string; icon: Icon; label: string }>;
  pathname: string;
  overdue: number;
  onNavigate?: () => void;
}) {
  return (
    <div>
      <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</p>
      <div className="space-y-1">
        {items.map(({ href, icon: IconComponent, label: itemLabel }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const badge = href === "/agent/tasks" && overdue > 0 ? overdue : 0;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              data-active={active ? "true" : undefined}
              className={[
                "td-side-nav-item td-press group flex items-center gap-3 px-2 py-2 text-[13px]",
                active ? "font-semibold text-ink" : "font-medium text-ink-2 hover:text-ink",
              ].join(" ")}
            >
              <span className="td-side-nav-icon" data-active={active ? "true" : undefined}>
                <IconComponent weight="fill" />
              </span>
              <span className="min-w-0 flex-1 truncate">{itemLabel}</span>
              {badge > 0 && (
                <span className="tnum inline-flex min-w-[20px] items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white" aria-label={`${badge} просроченных`}>
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
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
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full icon-3d text-[12px] font-semibold text-accent">
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
        className="td-mini-row flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-medium text-ink-2"
      >
        <GraduationCap size={16} weight="fill" className="text-ink-3" />
        Обучение
      </button>
      <button
        type="button"
        onClick={onLogout}
        className="td-mini-row flex w-full items-center gap-2.5 px-3 py-2 text-[12px] font-medium text-ink-3 hover:bg-danger-soft hover:text-danger"
      >
        <SignOut size={16} weight="bold" />
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
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <NavLinks pathname={pathname} overdue={overdue} />
        </div>
        <div className="border-t border-line px-4 py-4">
          <UserBlock session={session} onLogout={logout} onStartTour={startTour} />
        </div>
      </nav>

      {/* Mobile top bar */}
      <header className="td-glass fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between px-4 lg:hidden">
        <Brand compact />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="agent-mobile-menu"
          aria-label="Открыть меню"
          className="td-icon-button h-11 w-11 border border-line bg-surface text-ink hover:bg-surface-2"
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
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <Brand compact />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрыть меню"
              className="td-icon-button h-10 w-10 border border-line bg-surface text-ink hover:bg-surface-2"
            >
              <X size={20} />
            </button>
          </div>
          <div className="mx-4 mt-4">
            <CommandTrigger />
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-5">
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
