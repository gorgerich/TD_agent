"use client";

// Нижняя навигация для mobile (big-tech-паттерн: Яндекс/МТС). Только <lg.
// Дублирует первичную навигацию сайдбара — палец достаёт без гамбургера.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Users, CalendarDots } from "@phosphor-icons/react";
import { CurrencyRub } from "@phosphor-icons/react/dist/csr/CurrencyRub";

const TABS = [
  { href: "/agent/dashboard", icon: House, label: "Главная" },
  { href: "/agent/leads", icon: Users, label: "Клиенты" },
  { href: "/agent/meetings", icon: CalendarDots, label: "Встречи" },
  { href: "/agent/commissions", icon: CurrencyRub, label: "Комиссии" },
];

export default function AgentBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      {TABS.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || (href !== "/agent/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors ${active ? "text-accent" : "text-ink-3"}`}
          >
            <Icon size={22} weight={active ? "fill" : "regular"} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
