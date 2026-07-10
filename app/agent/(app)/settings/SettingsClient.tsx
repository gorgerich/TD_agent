"use client";

import { useState } from "react";
import { Bell, Check, Key, SignOut, Warning } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function SettingsClient({ notifyEnabled }: { notifyEnabled: boolean }) {
  const router = useRouter();
  const [notify, setNotify] = useState(notifyEnabled);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);

  async function toggleNotify() {
    const next = !notify;
    setNotify(next);
    setNotifyBusy(true);
    try {
      const res = await fetch("/api/agent/settings/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) setNotify(!next);
    } catch {
      setNotify(!next);
    } finally {
      setNotifyBusy(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    setPasswordBusy(true);
    try {
      const res = await fetch("/api/agent/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: currentPassword, next: nextPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPasswordError(data.error ?? "Не удалось сменить пароль");
        return;
      }
      setPasswordSaved(true);
      setCurrentPassword("");
      setNextPassword("");
    } catch {
      setPasswordError("Нет связи. Проверьте интернет и попробуйте снова.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function logout() {
    setLogoutBusy(true);
    try {
      await fetch("/api/agent/auth/logout", { method: "POST" });
      router.push("/agent/login");
      router.refresh();
    } finally {
      setLogoutBusy(false);
    }
  }

  return (
    <section className="rise rise-2 td-shell overflow-hidden" aria-label="Настройки кабинета">
      <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-accent-soft text-accent shadow-[var(--shadow-xs)]">
            <Bell size={19} weight="fill" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-ink">Уведомления</span>
            <span className="mt-0.5 block max-w-[54ch] text-[12px] leading-relaxed text-ink-3">Напоминания о просроченных задачах и встречах внутри кабинета.</span>
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={notify}
          aria-label="Включить уведомления"
          disabled={notifyBusy}
          onClick={toggleNotify}
          className={`relative h-11 w-[54px] flex-shrink-0 rounded-full p-1 transition-[background-color,transform] duration-150 ${notify ? "bg-accent shadow-[var(--shadow-accent)]" : "bg-surface-3 shadow-[var(--shadow-xs)]"} disabled:opacity-60`}
        >
          <span className={`block h-9 w-9 rounded-full bg-surface shadow-[var(--shadow-xs)] transition-transform duration-150 ${notify ? "translate-x-[12px]" : "translate-x-0"}`} />
        </button>
      </div>

      <div className="border-t border-line px-5 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-accent-soft text-accent shadow-[var(--shadow-xs)]">
            <Key size={19} weight="fill" />
          </span>
          <span>
            <span className="block text-[14px] font-semibold text-ink">Смена пароля</span>
            <span className="mt-0.5 block text-[12px] text-ink-3">Минимум 8 символов.</span>
          </span>
        </div>
        <form onSubmit={changePassword} className="mt-5 grid max-w-[500px] gap-4">
          <label>
            <span className="td-field-label">Текущий пароль</span>
            <input
              aria-label="Текущий пароль"
              type="password"
              className="td-field"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            <span className="td-field-label">Новый пароль</span>
            <input
              aria-label="Новый пароль"
              type="password"
              className="td-field"
              value={nextPassword}
              onChange={(e) => setNextPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="submit" variant="secondary" size="sm" loading={passwordBusy} disabled={!currentPassword || nextPassword.length < 8}>Обновить пароль</Button>
            {passwordError && <span role="alert" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-danger"><Warning size={15} weight="fill" /> {passwordError}</span>}
            {passwordSaved && <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-success"><Check size={15} weight="bold" /> Пароль обновлён</span>}
          </div>
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-5 py-5 sm:px-6">
        <span>
          <span className="block text-[14px] font-semibold text-ink">Выход из аккаунта</span>
          <span className="mt-0.5 block text-[12px] text-ink-3">Завершить сессию на этом устройстве.</span>
        </span>
        <Button type="button" variant="danger" size="sm" loading={logoutBusy} onClick={logout} leftIcon={<SignOut size={16} weight="bold" />}>Выйти</Button>
      </div>
    </section>
  );
}

export default SettingsClient;
