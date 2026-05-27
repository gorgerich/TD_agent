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
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.08fr_0.92fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden td-night px-14 py-14 text-on-accent lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "radial-gradient(900px 500px at 15% 10%, rgba(255,255,255,0.5), transparent 60%), radial-gradient(700px 500px at 95% 100%, rgba(0,0,0,0.35), transparent 55%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-[18px] bg-gold-soft text-accent">
            <span className="block h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-on-accent/80">
            Тихий дом
          </span>
        </div>

        <div className="relative max-w-[560px]">
          <span className="inline-flex rounded-full border border-on-accent/12 bg-on-accent/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-on-accent/64">
            агентская платформа
          </span>
          <h1 className="mt-6 font-serif text-[48px] leading-[1.04] text-on-accent">
            Спокойная работа с семьей, документами и оплатой.
          </h1>
          <div className="mt-9 grid max-w-[520px] grid-cols-3 gap-3">
            <div className="rounded-[22px] border border-on-accent/10 bg-on-accent/[0.07] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-on-accent/45">поток</p>
              <p className="mt-2 font-serif text-[20px] text-on-accent">Лид</p>
            </div>
            <div className="rounded-[22px] border border-on-accent/10 bg-on-accent/[0.07] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-on-accent/45">дальше</p>
              <p className="mt-2 font-serif text-[20px] text-on-accent">Встреча</p>
            </div>
            <div className="rounded-[22px] border border-on-accent/10 bg-on-accent/[0.07] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-on-accent/45">итог</p>
              <p className="mt-2 font-serif text-[20px] text-on-accent">Смета</p>
            </div>
          </div>
        </div>

        <div className="relative flex items-center gap-2.5 text-[12.5px] text-on-accent/70">
          <ShieldCheck size={16} weight="duotone" />
          Данные клиентов защищены и не индексируются
        </div>
      </aside>

      {/* Form panel */}
      <main id="main-content" className="td-page flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[460px] rise">
          {/* Mobile brand */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-12 w-12 place-items-center rounded-[17px] bg-accent text-on-accent shadow-soft">
              <span className="block h-2.5 w-2.5 rounded-full bg-on-accent" />
            </span>
            <span className="leading-tight">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Тихий дом</span>
              <span className="block font-serif text-[16px] text-ink">Кабинет агента</span>
            </span>
          </div>

          {(isDev || isDemo) && step === "phone" && (
            <div className="mb-5 flex items-start gap-2.5 rounded-[18px] border border-warning/25 bg-warning-soft px-4 py-3">
              <Warning size={16} className="mt-0.5 flex-shrink-0 text-warning" />
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                {isDemo ? "Демо-версия" : "Режим разработки"}: введите любой телефон и код{" "}
                <strong className="font-semibold text-ink">0000</strong>
              </p>
            </div>
          )}

          {step === "phone" ? (
            <form onSubmit={handleRequestOtp} aria-busy={loading} className="td-shell">
              <div className="td-core p-5 sm:p-7">
              <span className="td-eyebrow">безопасный вход</span>
              <h2 className="mt-5 font-serif text-[32px] leading-tight text-ink">Войти в кабинет</h2>
              <p className="mt-2 text-[14.5px] leading-6 text-ink-2">Введите номер телефона, отправим код подтверждения</p>

              <div className="mt-8">
                <label htmlFor="agent-phone" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  Телефон
                </label>
                <div className="relative">
                  <Phone size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    id="agent-phone"
                    type="tel"
                    className="min-h-14 w-full rounded-[16px] border border-line bg-surface py-3 pl-11 pr-4 text-[15px] text-ink outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-colors placeholder:text-ink-3 focus:border-accent"
                    placeholder="+7 900 000 00 00"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    autoFocus
                    required
                  />
                </div>
                <p className="mt-2 text-[12px] text-ink-3">Должен быть привязан к профилю агента</p>
              </div>

              {error && (
                <p role="alert" className="mt-4 flex items-center gap-1.5 text-[13px] text-danger">
                  <Warning size={14} /> {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || phone.length < 10}
                className="group mt-7 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-accent py-3 pl-5 pr-3 text-[15px] font-semibold text-on-accent shadow-[0_18px_34px_-22px_rgba(32,79,67,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
              >
                {loading ? "Отправляю…" : <>Получить код <span className="grid h-9 w-9 place-items-center rounded-full bg-on-accent/12 transition-transform group-hover:translate-x-0.5"><ArrowRight size={17} /></span></>}
              </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} aria-busy={loading} className="td-shell">
              <div className="td-core p-5 sm:p-7">
              <span className="td-eyebrow">подтверждение</span>
              <h2 className="mt-5 font-serif text-[32px] leading-tight text-ink">Введите код</h2>
              <p className="mt-2 text-[14.5px] leading-6 text-ink-2">
                Отправили на <span className="font-medium text-ink">{phone}</span>
              </p>

              {devCode && (
                <div className="mt-6 flex items-center gap-2.5 rounded-[18px] border border-accent/20 bg-accent-soft px-4 py-3">
                  <Key size={15} className="flex-shrink-0 text-accent" />
                  <p className="text-[12.5px] text-ink-2">
                    Код для входа: <strong className="font-semibold tnum text-accent">{devCode}</strong>
                  </p>
                </div>
              )}

              <div className="mt-6">
                <label htmlFor="agent-code" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                  Код из SMS
                </label>
                <input
                  id="agent-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="tnum min-h-16 w-full rounded-[18px] border border-line bg-surface px-4 py-3.5 text-center text-[24px] font-semibold tracking-[0.4em] text-ink outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-colors placeholder:text-ink-3 focus:border-accent"
                  placeholder="0000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  required
                />
              </div>

              {error && (
                <p role="alert" className="mt-4 flex items-center gap-1.5 text-[13px] text-danger">
                  <Warning size={14} /> {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || code.length < 4}
                className="mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-accent py-3 text-[15px] font-semibold text-on-accent shadow-[0_18px_34px_-22px_rgba(32,79,67,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
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
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
