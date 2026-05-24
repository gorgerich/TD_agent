"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  House,
  Users,
  CalendarDots,
  CurrencyDollar,
  SignOut,
  Circle,
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

export default function AgentSidebar({ session }: { session: AgentSession | null }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/agent/auth/logout", { method: "POST" });
    router.push("/agent/login");
    router.refresh();
  }

  const initials = session?.name
    ? session.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "А";

  return (
    <nav className="w-[240px] bg-[#0a0f1c] flex flex-col fixed inset-y-0 left-0 z-50 border-r border-white/[0.05]">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-white/[0.05]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Circle size={10} weight="fill" className="text-white" />
          </div>
          <div>
            <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-slate-600 leading-none mb-0.5">
              Тихий дом
            </div>
            <div className="text-[13px] font-semibold text-slate-200 leading-none">
              Кабинет агента
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 px-2.5 py-3 overflow-y-auto">
        <div className="space-y-0.5">
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = pathname === href || (href !== "/agent/dashboard" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={[
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-all duration-100",
                  active
                    ? "bg-blue-600/[0.16] text-blue-400"
                    : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-300",
                ].join(" ")}
              >
                <Icon
                  size={16}
                  weight={active ? "fill" : "regular"}
                  className={active ? "text-blue-400" : "text-slate-600"}
                />
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 pb-4 border-t border-white/[0.05] pt-3">
        {session && (
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-white/[0.03] mb-2">
            <div className="w-7 h-7 rounded-full bg-blue-900 flex items-center justify-center text-[11px] font-bold text-blue-300 flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-slate-200 truncate">{session.name ?? "Агент"}</div>
              <div className="text-[11px] text-slate-600">{ROLE_LABELS[session.role] ?? session.role}</div>
            </div>
          </div>
        )}
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-slate-600 hover:text-slate-400 hover:bg-white/[0.04] transition-all duration-100 font-medium"
        >
          <SignOut size={14} />
          Выйти
        </button>
      </div>
    </nav>
  );
}
