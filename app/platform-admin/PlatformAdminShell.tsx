"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Buildings,
  ChartDonut,
  ClockCounterClockwise,
  SignOut,
  ShieldCheck,
  SquaresFour,
  UsersThree,
  Wrench,
  type Icon,
} from "@phosphor-icons/react";

const NAV = [
  { href: "/platform-admin", label: "Обзор", icon: SquaresFour },
  { href: "/platform-admin/organizations", label: "Организации", icon: Buildings },
  { href: "/platform-admin/users", label: "Пользователи", icon: UsersThree },
  { href: "/platform-admin/audit", label: "Аудит", icon: ClockCounterClockwise },
] satisfies Array<{ href: string; label: string; icon: Icon }>;

export function PlatformAdminShell({
  children,
  name,
  hasWorkspace,
}: {
  children: React.ReactNode;
  name?: string;
  hasWorkspace: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sessionBusy, setSessionBusy] = useState(false);

  async function logout() {
    await fetch("/api/agent/auth/logout", { method: "POST" });
    router.push("/agent/login");
    router.refresh();
  }

  async function revokeOtherSessions() {
    setSessionBusy(true);
    try {
      const response = await fetch("/api/platform-admin/sessions/revoke", { method: "POST" });
      if (!response.ok) throw new Error("Не удалось завершить другие сеансы");
      router.refresh();
    } finally {
      setSessionBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#f3f5f4] text-[#132421] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="border-b border-[#d7dedb] bg-[#0d2f2a] text-white lg:sticky lg:top-0 lg:h-[100dvh] lg:border-b-0 lg:border-r lg:border-[#21443e]">
        <div className="flex min-h-16 items-center justify-between gap-4 px-5 lg:block lg:px-5 lg:pb-5 lg:pt-7">
          <div className="flex items-center gap-3">
            <Wrench size={28} weight="fill" aria-hidden />
            <span>
              <span className="block text-[14px] font-semibold">Тихий дом</span>
              <span className="mt-0.5 block text-[11px] text-white/64">Администрирование платформы</span>
            </span>
          </div>
        </div>
        <nav aria-label="Администрирование платформы" className="grid grid-cols-4 gap-1 px-2 pb-3 lg:block lg:space-y-1 lg:px-4">
          {NAV.map(({ href, label, icon: IconComponent }) => {
            const active = href === "/platform-admin" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-[10px] px-1 text-[10px] font-medium transition-colors lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-[13px]",
                  active ? "bg-white text-[#0d2f2a]" : "text-white/72 hover:bg-white/8 hover:text-white",
                ].join(" ")}
              >
                <IconComponent size={18} weight="fill" />
                <span className="max-w-full truncate">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="hidden border-t border-white/10 px-4 py-4 lg:absolute lg:inset-x-0 lg:bottom-0 lg:block">
          <p className="truncate px-2 text-[12px] font-semibold">{name ?? "Владелец платформы"}</p>
          <div className="mt-2 grid gap-1">
            {hasWorkspace && (
              <Link href="/agent/cases" className="flex min-h-10 items-center gap-2 rounded-[9px] px-2 text-[12px] text-white/70 hover:bg-white/8 hover:text-white">
                <ChartDonut size={17} weight="fill" />
                Рабочее пространство
              </Link>
            )}
            <button
              type="button"
              onClick={revokeOtherSessions}
              disabled={sessionBusy}
              className="flex min-h-10 items-center gap-2 rounded-[9px] px-2 text-left text-[12px] text-white/70 hover:bg-white/8 hover:text-white disabled:opacity-50"
            >
              <ShieldCheck size={17} weight="fill" />
              {sessionBusy ? "Завершаем…" : "Завершить другие сеансы"}
            </button>
            <button type="button" onClick={logout} className="flex min-h-10 items-center gap-2 rounded-[9px] px-2 text-left text-[12px] text-white/70 hover:bg-white/8 hover:text-white">
              <SignOut size={17} weight="bold" />
              Выйти
            </button>
          </div>
        </div>
      </aside>
      <main id="main-content" className="min-w-0 px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
        {children}
      </main>
    </div>
  );
}
