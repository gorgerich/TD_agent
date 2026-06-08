"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import {
  ArrowRight,
  EnvelopeSimple,
  Eye,
  EyeSlash,
  Key,
  Phone,
  ShieldCheck,
  User,
  Warning,
} from "@phosphor-icons/react";

type Mode = "login" | "register";

export default function AgentLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState<"login" | "register" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  async function submitAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(mode);

    try {
      const res = await fetch(`/api/agent/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "login"
            ? { email, password }
            : { name, email, phone, password },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось войти");
        return;
      }

      router.push("/agent/cases");
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(null);
    }
  }

  async function enterDemo() {
    setError(null);
    setLoading("demo");

    try {
      const res = await fetch("/api/agent/auth/demo", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Демо недоступно");
        return;
      }

      router.push("/agent/cases");
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(null);
    }
  }

  const isRegister = mode === "register";

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.08fr_0.92fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden td-night px-14 py-14 text-on-accent lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage:
              "radial-gradient(1100px 600px at 12% 6%, rgba(255,255,255,0.6), transparent 62%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-on-accent/10 ring-1 ring-on-accent/15">
            <span className="block h-2.5 w-2.5 rounded-full bg-on-accent" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-on-accent/80">
            Тихий дом
          </span>
        </div>

        <div className="relative max-w-[560px]">
          <span className="inline-flex rounded-full border border-on-accent/12 bg-on-accent/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-on-accent/64">
            агентская платформа
          </span>
          <h1 className="td-display mt-6 text-[54px] leading-[1.02] text-on-accent">
            Кабинет для реальной работы агента и отдельный безопасный демо-вход.
          </h1>
          <div className="mt-9 grid max-w-[520px] grid-cols-3 gap-3">
            {[
              ["до встречи", "Бриф и подготовка"],
              ["встреча", "Смета при семье"],
              ["после", "Задачи и сроки"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[14px] border border-on-accent/10 bg-on-accent/[0.07] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-on-accent/45">{label}</p>
                <p className="mt-2 td-display text-[18px] leading-tight text-on-accent">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-2.5 text-[12px] text-on-accent/70">
          <ShieldCheck size={16} weight="duotone" />
          Боевой вход хранит аккаунт в постоянной Postgres-БД
        </div>
      </aside>

      <main id="main-content" className="td-page flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[480px] rise">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-accent text-on-accent shadow-soft">
              <span className="block h-2.5 w-2.5 rounded-full bg-on-accent" />
            </span>
            <span className="leading-tight">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Тихий дом</span>
              <span className="block td-display text-[16px] text-ink">Кабинет агента</span>
            </span>
          </div>

          <section className="td-shell">
            <div className="td-core p-5 sm:p-7">
              <div className="inline-grid w-full grid-cols-2 rounded-full border border-line bg-surface-2 p-1">
                {(["login", "register"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setMode(item);
                      setError(null);
                    }}
                    className={`min-h-10 rounded-full px-4 text-[13px] font-semibold transition-colors ${
                      mode === item
                        ? "bg-surface text-ink shadow-[0_8px_18px_-16px_rgba(33,26,19,0.8)]"
                        : "text-ink-3 hover:text-ink-2"
                    }`}
                  >
                    {item === "login" ? "Войти" : "Регистрация"}
                  </button>
                ))}
              </div>

              <span className="td-eyebrow mt-6">{isRegister ? "новый агент" : "боевой вход"}</span>
              <h2 className="mt-5 td-display text-[32px] leading-tight text-ink">
                {isRegister ? "Создать профиль агента" : "Войти в кабинет"}
              </h2>
              <p className="mt-2 text-[14px] leading-6 text-ink-2">
                {isRegister
                  ? "Профиль будет создан в постоянной базе и сразу откроет агентский кабинет."
                  : "Используйте email и пароль агента. Демо-вход оставлен ниже отдельным вариантом."}
              </p>

              <form onSubmit={submitAuth} aria-busy={loading === mode} className="mt-8 grid gap-4">
                {isRegister && (
                  <Field
                    id="agent-name"
                    label="Имя агента"
                    icon={<User size={17} />}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Например, Анна Иванова"
                    autoComplete="name"
                    autoFocus
                    required
                  />
                )}

                <Field
                  id="agent-email"
                  label="Email"
                  icon={<EnvelopeSimple size={17} />}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="agent@example.com"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus={!isRegister}
                  required
                />

                {isRegister && (
                  <Field
                    id="agent-phone"
                    label="Телефон"
                    icon={<Phone size={17} />}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 900 000 00 00"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                )}

                <Field
                  id="agent-password"
                  label="Пароль"
                  icon={<Key size={17} />}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isRegister ? "Минимум 8 символов" : "Введите пароль"}
                  type={showPw ? "text" : "password"}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  minLength={isRegister ? 8 : undefined}
                  required
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
                      aria-pressed={showPw}
                      className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-2"
                    >
                      {showPw ? <EyeSlash size={17} /> : <Eye size={17} />}
                    </button>
                  }
                />

                {error && (
                  <p role="alert" className="flex items-center gap-1.5 text-[13px] text-danger">
                    <Warning size={14} /> {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading !== null || !email || !password || (isRegister && !name)}
                  className="group mt-2 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-accent py-3 pl-5 pr-3 text-[14px] font-semibold text-on-accent shadow-[0_18px_34px_-22px_rgba(32,79,67,0.9)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
                >
                  {loading === mode ? (
                    "Проверяю…"
                  ) : (
                    <>
                      {isRegister ? "Создать и войти" : "Войти"}
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-on-accent/12 transition-transform group-hover:translate-x-0.5">
                        <ArrowRight size={17} />
                      </span>
                    </>
                  )}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">или</span>
                <span className="h-px flex-1 bg-line" />
              </div>

              <button
                type="button"
                onClick={enterDemo}
                disabled={loading !== null}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-line bg-surface text-[14px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {loading === "demo" ? "Открываю демо…" : "Войти в демо-кабинет"}
              </button>
              <p className="mt-3 text-center text-[12px] leading-5 text-ink-3">
                Демо использует тестового агента и засеянные данные. Боевые аккаунты создаются отдельно.
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

