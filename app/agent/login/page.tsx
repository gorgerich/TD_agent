"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, ArrowRight, Key, ArrowLeft, Warning, ShieldCheck } from "@phosphor-icons/react";

export default function AgentLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const isDev = process.env.NODE_ENV === "development";
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Ошибка отправки"); return; }
      if (data.devCode) setDevCode(data.devCode);
      setStep("code");
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Неверный код"); return; }
      router.push("/agent/dashboard");
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — desktop only */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-accent px-12 py-14 text-on-accent lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "radial-gradient(900px 500px at 15% 10%, rgba(255,255,255,0.5), transparent 60%), radial-gradient(700px 500px at 95% 100%, rgba(0,0,0,0.35), transparent 55%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-on-accent/15">
            <span className="block h-2.5 w-2.5 rounded-full bg-on-accent" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-on-accent/80">
            Тихий дом
          </span>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-serif text-[34px] leading-[1.18] text-on-accent">
            Спокойная помощь семье — в нужный момент, рядом.
          </h1>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-on-accent/75">
            Рабочее пространство выездного агента: лиды, встречи, смета и сопровождение оплаты — в одном месте.
          </p>
        </div>

        <div className="relative flex items-center gap-2.5 text-[12.5px] text-on-accent/70">
          <ShieldCheck size={16} weight="duotone" />
          Данные клиентов защищены и не индексируются
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px] rise">
          {/* Mobile brand */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-on-accent">
              <span className="block h-2.5 w-2.5 rounded-full bg-on-accent" />
            </span>
            <span className="leading-tight">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Тихий дом</span>
              <span className="block font-serif text-[16px] text-ink">Кабинет агента</span>
            </span>
          </div>

          {(isDev || isDemo) && step === "phone" && (
            <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3">
              <Warning size={16} className="mt-0.5 flex-shrink-0 text-warning" />
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                {isDemo ? "Демо-версия" : "Режим разработки"} — введите любой телефон и код{" "}
                <strong className="font-semibold text-ink">0000</strong>
              </p>
            </div>
          )}

          {step === "phone" ? (
            <form onSubmit={handleRequestOtp}>
              <h2 className="font-serif text-[26px] text-ink">Войти в кабинет</h2>
              <p className="mt-1.5 text-[14px] text-ink-2">Введите номер телефона — отправим код подтверждения</p>

              <div className="mt-7">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  Телефон
                </label>
                <div className="relative">
                  <Phone size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    type="tel"
                    className="w-full rounded-xl border border-line bg-surface py-3 pl-10 pr-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
                    placeholder="+7 900 000 00 00"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <p className="mt-2 text-[12px] text-ink-3">Должен быть привязан к профилю агента</p>
              </div>

              {error && (
                <p className="mt-4 flex items-center gap-1.5 text-[13px] text-danger">
                  <Warning size={14} /> {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || phone.length < 10}
                className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-[15px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
              >
                {loading ? "Отправляю…" : <>Получить код <ArrowRight size={17} /></>}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <h2 className="font-serif text-[26px] text-ink">Введите код</h2>
              <p className="mt-1.5 text-[14px] text-ink-2">
                Отправили на <span className="font-medium text-ink">{phone}</span>
              </p>

              {devCode && (
                <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-accent/20 bg-accent-soft px-4 py-3">
                  <Key size={15} className="flex-shrink-0 text-accent" />
                  <p className="text-[12.5px] text-ink-2">
                    Код для входа: <strong className="font-semibold tnum text-accent">{devCode}</strong>
                  </p>
                </div>
              )}

              <div className="mt-6">
                <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  Код из SMS
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="tnum w-full rounded-xl border border-line bg-surface px-4 py-3.5 text-center text-[24px] font-semibold tracking-[0.4em] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent"
                  placeholder="0000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                  maxLength={6}
                  required
                />
              </div>

              {error && (
                <p className="mt-4 flex items-center gap-1.5 text-[13px] text-danger">
                  <Warning size={14} /> {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || code.length < 4}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-[15px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
              >
                {loading ? "Проверяю…" : "Войти"}
              </button>

              <button
                type="button"
                onClick={() => { setStep("phone"); setCode(""); setError(null); }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 py-2 text-[13px] text-ink-3 transition-colors hover:text-ink-2"
              >
                <ArrowLeft size={14} /> Изменить номер
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
