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
  const [pendingAction, setPendingAction] = useState<"logout" | "revoke" | null>(null);
  const [sessionMessage, setSessionMessage] = useState("");
  const [sessionError, setSessionError] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const sessionBusy = pendingAction !== null;

  async function logout() {
    if (sessionBusy) return;
    setPendingAction("logout"); setSessionMessage(""); setSessionError(false);
    try {
      const response = await fetch("/api/agent/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("LOGOUT_UNCONFIRMED");
      router.push("/agent/login"); router.refresh();
    } catch {
      setSessionError(true); setSessionMessage("Не удалось подтвердить выход. Повторите попытку.");
    } finally { setPendingAction(null); }
  }

  async function revokeOtherSessions() {
    if (sessionBusy) return;
    setPendingAction("revoke"); setSessionMessage(""); setSessionError(false); setRequiresLogin(false);
    try {
      const response = await fetch("/api/platform-admin/sessions/revoke", { method: "POST" });
      if ([401, 403, 409].includes(response.status)) {
        setSessionError(true); setRequiresLogin(true);
        setSessionMessage("Состояние сеанса изменилось. Войдите снова.");
        return;
      }
      if (!response.ok) throw new Error("REVOCATION_UNCONFIRMED");
      setSessionMessage("Другие сеансы завершены.");
      router.refresh();
    } catch {
      setSessionError(true); setSessionMessage("Не удалось подтвердить завершение сеансов. Повторите запрос или войдите снова.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#f3f5f4] text-[#132421] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="border-b border-[#d7dedb] bg-[#0d2f2a] text-white lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r lg:border-[#21443e]">
        <div className="flex min-h-16 items-center justify-between gap-4 px-5 lg:block lg:px-5 lg:pb-5 lg:pt-7">
          <div className="flex min-w-0 items-center gap-3">
            <Wrench size={28} weight="fill" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="block text-[14px] font-semibold">Тихий дом</span>
              <span className="mt-0.5 block text-[11px] text-white/64">Администрирование платформы</span>
            </span>
          </div>
        </div>
        <nav aria-label="Администрирование платформы" className="grid grid-cols-2 gap-1 px-2 pb-3 min-[360px]:grid-cols-4 lg:block lg:space-y-1 lg:px-4">
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
                <span className="max-w-full text-center [overflow-wrap:anywhere] lg:text-left">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 lg:mt-auto lg:py-4">
          <p className="break-words px-2 text-[12px] font-semibold">{name ?? "Владелец платформы"}</p>
          <div className="mt-2 flex flex-wrap gap-1 lg:grid">
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
              className="flex min-h-11 items-center gap-2 rounded-[9px] px-2 text-left text-[12px] text-white/70 hover:bg-white/8 hover:text-white disabled:opacity-50"
            >
              <ShieldCheck size={17} weight="fill" />
              {pendingAction === "revoke" ? "Завершаем..." : "Завершить другие сеансы"}
            </button>
            <button type="button" onClick={logout} disabled={sessionBusy} className="flex min-h-11 items-center gap-2 rounded-[9px] px-2 text-left text-[12px] text-white/70 hover:bg-white/8 hover:text-white disabled:opacity-50">
              <SignOut size={17} weight="bold" />
              {pendingAction === "logout" ? "Выходим..." : "Выйти"}
            </button>
          </div>
          {sessionMessage && <p role={sessionError ? "alert" : "status"} className="mt-2 break-words px-2 text-[12px] text-white">{sessionMessage}</p>}
          {requiresLogin && <Link href="/agent/login" className="mt-1 inline-flex min-h-11 items-center px-2 text-[12px] text-white">Войти снова</Link>}
        </div>
      </aside>
      <main id="main-content" className="min-w-0 px-4 py-6 sm:px-7 lg:px-10 lg:py-9">
        {children}
      </main>
    </div>
  );
}
