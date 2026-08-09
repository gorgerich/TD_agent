"use client";

// Нижняя навигация держит только четыре ежедневных действия.
// Второстепенные разделы остаются в меню, чтобы dock не превращался в панель CRM.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, CalendarDots, CheckSquare, FileText, UsersThree, type Icon } from "@phosphor-icons/react";
import type { OperationalRole } from "@/lib/operationalAuth";

const TABS = [
  { href: "/agent/cases", icon: Briefcase, label: "Кейсы" },
  { href: "/agent/meetings", icon: CalendarDots, label: "Календарь" },
  { href: "/agent/estimates", icon: FileText, label: "Сметы" },
  { href: "/agent/tasks", icon: CheckSquare, label: "Сегодня" },
] satisfies Array<{ href: string; icon: Icon; label: string }>;

const TEAM_TABS = [
  { href: "/agent/cases", icon: Briefcase, label: "Кейсы" },
  { href: "/agent/meetings", icon: CalendarDots, label: "Календарь" },
  { href: "/agent/tasks", icon: CheckSquare, label: "Сегодня" },
  { href: "/agent/operations", icon: UsersThree, label: "Команда" },
] satisfies Array<{ href: string; icon: Icon; label: string }>;

export default function AgentBottomNav({ overdue = 0, role }: { overdue?: number; role: OperationalRole }) {
  const pathname = usePathname();
  const tabs = role === "AGENT" ? TABS : TEAM_TABS;
  // В открытом кейсе глобальный dock конкурирует с маршрутной панелью и
  // перекрывает рабочие элементы на mobile. Навигация остаётся в шапке и
  // во вкладках самого кейса.
  const isFocusedCaseWorkspace = /^\/agent\/cases\/[^/]+/.test(pathname);
  if (isFocusedCaseWorkspace) return null;

  return (
    <nav
      aria-label="Основная навигация"
      className="td-mobile-dock fixed z-40 grid grid-cols-4 px-2 py-1 lg:hidden"
    >
      {tabs.map(({ href, icon: IconComponent, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const badge = href === "/agent/tasks" && overdue > 0 ? overdue : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            data-active={active ? "true" : undefined}
            className={`td-mobile-dock-item td-press flex min-h-[58px] flex-col items-center justify-center gap-1.5 text-[10px] font-semibold ${active ? "text-ink" : "text-ink-3"}`}
          >
            <span
              className="td-nav-orb"
              data-active={active ? "true" : undefined}
            >
              <IconComponent size={24} weight="fill" />
              {badge > 0 && (
                <span className="tnum absolute -right-0.5 -top-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[15px] text-white" aria-label={`${badge} просроченных`}>
                  {badge}
                </span>
              )}
            </span>
            <span className="td-mobile-dock-label leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
