"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Key, SignOut, Check, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";

const inputCls =
  "min-h-12 w-full rounded-[12px] border border-line bg-surface px-3.5 text-[14.5px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] focus:border-accent focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_0_3px_rgba(30,84,70,0.14)]";

export function SettingsClient({ notifyEnabled }: { notifyEnabled: boolean }) {
  const router = useRouter();

  // Уведомления
  const [notify, setNotify] = useState(notifyEnabled);
  const [notifyBusy, setNotifyBusy] = useState(false);

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
      if (!res.ok) setNotify(!next); // откат
    } catch {
      setNotify(!next);
    } finally {
      setNotifyBusy(false);
    }
  }

  // Смена пароля
  const [cur, setCur] = useState("");
  const [nxt, setNxt] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwErr(null);
    setPwOk(false);
    setPwBusy(true);
    try {
      const res = await fetch("/api/agent/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: cur, next: nxt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPwErr(data.error ?? "Не удалось сменить пароль");
        return;
      }
      setPwOk(true);
      setCur("");
      setNxt("");
    } catch {
      setPwErr("Сеть недоступна");
    } finally {
      setPwBusy(false);
    }
  }

  // Выход
  const [outBusy, setOutBusy] = useState(false);
  async function logout() {
    setOutBusy(true);
    try {
      await fetch("/api/agent/auth/logout", { method: "POST" });
      router.push("/agent/login");
      router.refresh();
    } finally {
      setOutBusy(false);
    }
  }

  return (
    <div className="rise rise-2 space-y-4">
      {/* Уведомления */}
      <section className="td-shell p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent">
              <Bell size={19} weight="duotone" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Уведомления</h2>
              <p className="text-[13px] text-ink-3">Подсказки о просроченных задачах и встречах внутри кабинета.</p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notify}
            aria-label="Уведомления"
            disabled={notifyBusy}
            onClick={toggleNotify}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${notify ? "bg-accent" : "bg-surface-3"} disabled:opacity-60`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-transform ${notify ? "translate-x-[22px]" : "translate-x-0.5"}`} />
          </button>
        </div>
      </section>

      {/* Смена пароля */}
      <section className="td-shell p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[12px] bg-accent-soft text-accent">
            <Key size={19} weight="duotone" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Смена пароля</h2>
            <p className="text-[13px] text-ink-3">Минимум 8 символов.</p>
          </div>
        </div>
        <form onSubmit={changePassword} className="grid gap-3 sm:max-w-[420px]">
          <input
            type="password"
            className={inputCls}
            placeholder="Текущий пароль"
            value={cur}
            onChange={(e) => setCur(e.target.value)}
            autoComplete="current-password"
            required
          />
          <input
            type="password"
            className={inputCls}
            placeholder="Новый пароль"
            value={nxt}
            onChange={(e) => setNxt(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          {pwErr && (
            <p role="alert" className="flex items-center gap-1.5 text-[13px] text-danger">
              <Warning size={14} /> {pwErr}
            </p>
          )}
          {pwOk && (
            <p className="flex items-center gap-1.5 text-[13px] text-success">
              <Check size={14} weight="bold" /> Пароль обновлён
            </p>
          )}
          <Button type="submit" variant="secondary" loading={pwBusy} disabled={!cur || nxt.length < 8} className="w-fit">
            Обновить пароль
          </Button>
        </form>
      </section>

      {/* Выход */}
      <section className="td-shell p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Выход из аккаунта</h2>
            <p className="text-[13px] text-ink-3">Завершить сессию на этом устройстве.</p>
          </div>
          <Button type="button" variant="danger" loading={outBusy} onClick={logout} leftIcon={<SignOut size={16} weight="bold" />}>
            Выйти
          </Button>
        </div>
      </section>
    </div>
  );
}

export default SettingsClient;
