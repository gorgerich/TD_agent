"use client";

// Нижняя навигация для mobile (big-tech-паттерн: Яндекс/МТС). Только <lg.
// Дублирует первичную навигацию сайдбара — палец достаёт без гамбургера.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, CalendarDots, FileText, CheckSquare } from "@phosphor-icons/react";

const TABS = [
  { href: "/agent/cases", icon: Briefcase, label: "Кейсы" },
  { href: "/agent/meetings", icon: CalendarDots, label: "Календарь" },
  { href: "/agent/estimates", icon: FileText, label: "Сметы" },
  { href: "/agent/tasks", icon: CheckSquare, label: "Задачи" },
];

export default function AgentBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Основная навигация"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      {TABS.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] font-medium transition-colors ${active ? "text-accent" : "text-ink-3"}`}
          >
            <span
              className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${active ? "bg-accent-soft" : "bg-transparent"}`}
            >
              <Icon size={21} weight={active ? "fill" : "regular"} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
