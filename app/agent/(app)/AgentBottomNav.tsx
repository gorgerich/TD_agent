"use client";

// Нижняя навигация для mobile (big-tech-паттерн: Яндекс/МТС). Только <lg.
// Дублирует первичную навигацию сайдбара - палец достаёт без гамбургера.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, CalendarDots, CheckSquare, FileText, type Icon } from "@phosphor-icons/react";

const TABS = [
  { href: "/agent/cases", icon: Briefcase, label: "Кейсы" },
  { href: "/agent/meetings", icon: CalendarDots, label: "Календарь" },
  { href: "/agent/estimates", icon: FileText, label: "Сметы" },
  { href: "/agent/tasks", icon: CheckSquare, label: "Задачи" },
] satisfies Array<{ href: string; icon: Icon; label: string }>;

export default function AgentBottomNav({ overdue = 0 }: { overdue?: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Основная навигация"
      className="td-mobile-dock fixed z-40 grid grid-cols-4 px-2 py-1 lg:hidden"
    >
      {TABS.map(({ href, icon: IconComponent, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const badge = href === "/agent/tasks" && overdue > 0 ? overdue : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            data-active={active ? "true" : undefined}
            className={`td-mobile-dock-item td-press flex min-h-[56px] flex-col items-center justify-center gap-1 text-[10px] font-medium ${active ? "text-ink" : "text-ink-3"}`}
          >
            <span
              className="td-nav-orb"
              data-active={active ? "true" : undefined}
            >
              <IconComponent size={22} weight="regular" />
              {badge > 0 && (
                <span className="tnum absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[15px] text-white" aria-label={`${badge} просроченных`}>
                  {badge}
                </span>
              )}
            </span>
            <span className="leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
