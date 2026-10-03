"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, WarningCircle } from "@phosphor-icons/react";

type Setup = { secret: string; uri: string };

export function PlatformMfaSetupClient({ purpose, redirectTo }: { purpose: "PLATFORM" | "FINANCE"; redirectTo: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/platform-admin/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "BEGIN" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Не удалось подготовить защиту");
      setSetup({ secret: data.secret, uri: data.uri });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Нет связи");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
  }, []);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/platform-admin/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CONFIRM", code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Не удалось подтвердить код");
      router.replace(data.redirectTo ?? redirectTo);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Нет связи");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f3f5f4] px-4 py-8">
      <section className="w-full max-w-[520px] rounded-[16px] bg-white px-5 py-7 shadow-[0_2px_12px_rgba(13,47,42,0.08)] sm:px-8 sm:py-9">
        <ShieldCheck size={26} weight="fill" className="text-[#176b5d]" aria-hidden />
        <h1 className="mt-5 text-[29px] font-semibold leading-tight text-[#132421]">
          {purpose === "FINANCE" ? "Защитите финансовый доступ" : "Защитите доступ владельца"}
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[#536762]">
          Добавьте ключ в приложение-аутентификатор, затем введите шестизначный код.
        </p>
        {error && (
          <div role="alert" className="mt-5 flex gap-2 text-[13px] text-[#b42318]">
            <WarningCircle size={18} weight="fill" aria-hidden />
            <span>{error}</span>
          </div>
        )}
        {!setup && (
          <button type="button" disabled={busy} onClick={begin} className="mt-6 min-h-12 rounded-[10px] bg-[#0d3b34] px-5 text-[14px] font-semibold text-white disabled:opacity-50">
            {busy ? "Подготавливаем…" : "Повторить"}
          </button>
        )}
        {setup && (
          <form onSubmit={confirm} className="mt-6 grid gap-5">
            <div className="rounded-[10px] bg-[#f3f5f4] p-4">
              <p className="text-[12px] font-semibold text-[#344b46]">Ключ настройки</p>
              <code className="mt-2 block break-all text-[14px] leading-6 text-[#132421]">{setup.secret}</code>
              <a href={setup.uri} className="mt-3 inline-flex min-h-10 items-center text-[13px] font-semibold text-[#176b5d]">
                Открыть приложение-аутентификатор
              </a>
            </div>
            <label>
              <span className="block text-[12px] font-semibold text-[#344b46]">Код подтверждения</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="mt-2 min-h-12 w-full rounded-[10px] bg-[#f3f5f4] px-4 text-[16px] text-[#132421] outline-none ring-1 ring-[#d7dedb] focus:ring-2 focus:ring-[#176b5d]"
                required
                minLength={6}
                maxLength={6}
              />
            </label>
            <button type="submit" disabled={busy || code.length !== 6} className="min-h-12 rounded-[10px] bg-[#0d3b34] px-5 text-[14px] font-semibold text-white disabled:opacity-50">
              {busy ? "Проверяем…" : "Включить защиту"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
