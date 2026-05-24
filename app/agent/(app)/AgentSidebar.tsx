"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  House,
  Users,
  CalendarDots,
  CurrencyDollar,
  SignOut,
  List,
  X,
} from "@phosphor-icons/react";
import type { AgentSession } from "@/lib/auth";

const NAV = [
  { href: "/agent/dashboard", icon: House, label: "Дашборд" },
  { href: "/agent/leads", icon: Users, label: "Лиды" },
  { href: "/agent/meetings", icon: CalendarDots, label: "Встречи" },
  { href: "/agent/commissions", icon: CurrencyDollar, label: "Комиссии" },
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
      <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-[10px] bg-accent text-on-accent">
        <span className="block h-2 w-2 rounded-full bg-on-accent" />
      </span>
      <span className="leading-tight">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
          Тихий дом
        </span>
        <span className="block font-serif text-[15px] text-ink">Кабинет агента</span>
      </span>
    </div>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-1">
      {NAV.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || (href !== "/agent/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={[
              "group relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition-colors",
              active
                ? "bg-accent-soft text-accent"
                : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            ].join(" ")}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
            )}
            <Icon size={18} weight={active ? "fill" : "regular"} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function UserBlock({ session, onLogout }: { session: AgentSession | null; onLogout: () => void }) {
  const initials = session?.name
    ? session.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "А";
  return (
    <div className="space-y-2">
      {session && (
        <div className="flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2.5">
          <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-accent text-[12px] font-semibold text-on-accent">
            {initials}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-ink">{session.name ?? "Агент"}</span>
            <span className="block text-[11.5px] text-ink-3">{ROLE_LABELS[session.role] ?? session.role}</span>
          </span>
        </div>
      )}
      <button
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <SignOut size={16} />
        Выйти
      </button>
    </div>
  );
}

export default function AgentSidebar({ session }: { session: AgentSession | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-line bg-surface lg:flex">
        <div className="border-b border-line px-5 py-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-line px-3 py-4">
          <UserBlock session={session} onLogout={logout} />
        </div>
      </nav>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur-md lg:hidden">
        <Brand />
        <button
          onClick={() => setOpen(true)}
          aria-label="Открыть меню"
          className="grid h-10 w-10 place-items-center rounded-[10px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
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
        <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
        <nav
          className={[
            "absolute inset-y-0 left-0 flex w-[280px] max-w-[82vw] flex-col border-r border-line bg-surface shadow-pop transition-transform duration-200 ease-out",
            open ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <Brand />
            <button
              onClick={() => setOpen(false)}
              aria-label="Закрыть меню"
              className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
          <div className="border-t border-line px-3 py-4">
            <UserBlock session={session} onLogout={logout} />
          </div>
        </nav>
      </div>
    </>
  );
}
