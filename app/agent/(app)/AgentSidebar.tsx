"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  House,
  Users,
  CalendarDots,
  SignOut,
  List,
  X,
} from "@phosphor-icons/react";
import { CurrencyRub } from "@phosphor-icons/react/dist/csr/CurrencyRub";
import type { AgentSession } from "@/lib/auth";

const NAV = [
  { href: "/agent/dashboard", icon: House, label: "Дашборд" },
  { href: "/agent/leads", icon: Users, label: "Лиды" },
  { href: "/agent/meetings", icon: CalendarDots, label: "Встречи" },
  { href: "/agent/commissions", icon: CurrencyRub, label: "Комиссии" },
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
      <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-[15px] bg-gold-soft/95 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]">
        <span className="block h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
      <span className="leading-tight">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-on-accent/62">
          Тихий дом
        </span>
        <span className="block font-serif text-[16px] text-on-accent">Кабинет агента</span>
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
            aria-current={active ? "page" : undefined}
            className={[
              "group relative flex min-h-12 items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-[14px] font-medium transition-all duration-200",
              active
                ? "bg-on-accent text-accent shadow-[0_12px_28px_-20px_rgba(255,248,234,0.55)]"
                : "text-on-accent/66 hover:bg-on-accent/9 hover:text-on-accent",
            ].join(" ")}
          >
            {active && (
              <span className="absolute left-1 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gold" />
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
        <div className="flex items-center gap-3 rounded-[18px] bg-on-accent/10 px-3 py-3 ring-1 ring-on-accent/10">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-gold-soft text-[12px] font-semibold text-accent">
            {initials}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-on-accent">{session.name ?? "Агент"}</span>
            <span className="block text-[11.5px] text-on-accent/56">{ROLE_LABELS[session.role] ?? session.role}</span>
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-[13px] font-medium text-on-accent/58 transition-colors hover:bg-danger-soft hover:text-danger"
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
      <nav className="fixed inset-y-0 left-0 z-40 hidden w-[280px] flex-col border-r border-white/10 td-night lg:flex">
        <div className="px-5 pb-5 pt-6">
          <Brand />
        </div>
        <div className="mx-5 mb-5 rounded-[20px] border border-on-accent/10 bg-on-accent/[0.06] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-on-accent/45">Сегодня</p>
          <p className="mt-1 font-serif text-[18px] leading-tight text-on-accent">Рабочий контур</p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-on-accent/10 px-4 py-4">
          <UserBlock session={session} onLogout={logout} />
        </div>
      </nav>

      {/* Mobile top bar */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 td-night px-4 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="agent-mobile-menu"
          aria-label="Открыть меню"
          className="grid h-11 w-11 place-items-center rounded-[14px] bg-on-accent/10 text-on-accent transition-colors hover:bg-on-accent/16"
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
          id="agent-mobile-menu"
          aria-label="Меню агента"
          className={[
            "absolute inset-y-0 left-0 flex w-[292px] max-w-[86vw] flex-col border-r border-on-accent/10 td-night shadow-pop transition-transform duration-200 ease-out",
            open ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <div className="flex items-center justify-between border-b border-on-accent/10 px-5 py-4">
            <Brand />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Закрыть меню"
              className="grid h-10 w-10 place-items-center rounded-[14px] bg-on-accent/10 text-on-accent transition-colors hover:bg-on-accent/16"
            >
              <X size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
          </div>
          <div className="border-t border-on-accent/10 px-4 py-4">
            <UserBlock session={session} onLogout={logout} />
          </div>
        </nav>
      </div>
    </>
  );
}
