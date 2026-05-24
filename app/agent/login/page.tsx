"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, ArrowRight, Key, ArrowLeft, Warning } from "@phosphor-icons/react";

export default function AgentLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const isDev = process.env.NODE_ENV === "development";

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
    <div className="min-h-screen bg-[#060a12] flex items-center justify-center px-4">
      {/* Subtle grid bg */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

      <div className="relative w-full max-w-[380px]">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 mb-4">
            <div className="w-3 h-3 rounded-full bg-white/90" />
          </div>
          <div className="text-[10px] font-bold tracking-[0.16em] uppercase text-slate-600 mb-1">Тихий дом</div>
          <div className="text-lg font-bold text-slate-200">Кабинет агента</div>
        </div>

        {/* Card */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-7">

          {isDev && step === "phone" && (
            <div className="flex items-start gap-2.5 bg-amber-500/[0.08] border border-amber-500/20 rounded-lg px-3.5 py-3 mb-5">
              <Warning size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-300/80 leading-relaxed">
                Режим разработки — введите любой телефон и код <strong className="text-amber-300">0000</strong>
              </p>
            </div>
          )}

          {step === "phone" ? (
            <form onSubmit={handleRequestOtp}>
              <h2 className="text-[17px] font-bold text-slate-100 mb-1">Войти</h2>
              <p className="text-[13px] text-slate-500 mb-6">Введите номер телефона — пришлём код</p>

              <div className="mb-5">
                <label className="block text-[11px] font-semibold tracking-[0.07em] uppercase text-slate-500 mb-2">
                  Телефон
                </label>
                <div className="relative">
                  <Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600" />
                  <input
                    type="tel"
                    className="w-full bg-white/[0.05] border border-white/[0.09] rounded-lg pl-9 pr-4 py-2.5 text-[14px] text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500/60 focus:bg-white/[0.07] transition-all"
                    placeholder="+7 900 000 00 00"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <p className="text-[11px] text-slate-600 mt-1.5">Должен быть привязан к профилю агента</p>
              </div>

              {error && (
                <p className="flex items-center gap-1.5 text-[12px] text-red-400 mb-4">
                  <Warning size={13} /> {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || phone.length < 10}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:cursor-default text-white font-semibold text-[14px] py-2.5 rounded-lg transition-colors"
              >
                {loading ? "Отправляю..." : <>Получить код <ArrowRight size={15} /></>}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <h2 className="text-[17px] font-bold text-slate-100 mb-1">Введите код</h2>
              <p className="text-[13px] text-slate-500 mb-5">
                Отправили на <span className="text-slate-300 font-medium">{phone}</span>
              </p>

              {devCode && (
                <div className="flex items-center gap-2.5 bg-blue-500/[0.08] border border-blue-500/20 rounded-lg px-3.5 py-3 mb-5">
                  <Key size={13} className="text-blue-400 flex-shrink-0" />
                  <p className="text-[12px] text-blue-300/80">
                    Dev-код: <strong className="text-blue-300">{devCode}</strong>
                  </p>
                </div>
              )}

              <div className="mb-5">
                <label className="block text-[11px] font-semibold tracking-[0.07em] uppercase text-slate-500 mb-2">
                  Код из SMS
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="w-full bg-white/[0.05] border border-white/[0.09] rounded-lg px-4 py-3 text-[22px] font-bold text-slate-100 text-center tracking-[0.4em] placeholder-slate-700 outline-none focus:border-blue-500/60 focus:bg-white/[0.07] transition-all tabular-nums"
                  placeholder="0000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                  maxLength={6}
                  required
                />
              </div>

              {error && (
                <p className="flex items-center gap-1.5 text-[12px] text-red-400 mb-4">
                  <Warning size={13} /> {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || code.length < 4}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:cursor-default text-white font-semibold text-[14px] py-2.5 rounded-lg transition-colors mb-3"
              >
                {loading ? "Проверяю..." : "Войти"}
              </button>

              <button
                type="button"
                onClick={() => { setStep("phone"); setCode(""); setError(null); }}
                className="w-full flex items-center justify-center gap-1.5 text-[13px] text-slate-600 hover:text-slate-400 transition-colors py-1.5"
              >
                <ArrowLeft size={13} /> Изменить номер
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
