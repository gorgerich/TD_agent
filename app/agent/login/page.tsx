"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "@/components/ui/Field";
import { Button, buttonClasses } from "@/components/ui/Button";
import { QuietShader } from "@/components/QuietShader";
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

function AgentLoginContent() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState<"login" | "register" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const registrationAvailable = process.env.NODE_ENV !== "production" || Boolean(inviteToken);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const rawInviteToken = hash.get("invite")?.trim() ?? "";
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    if (rawInviteToken.length >= 32) {
      window.setTimeout(() => {
        setInviteToken(rawInviteToken);
        setMode("register");
      }, 0);
    }
  }, []);

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
            ? { email, password, mfaCode: mfaRequired ? mfaCode : undefined }
            : { name, email, phone, password, inviteToken: inviteToken ?? undefined },
        ),
      });
      const data = await res.json();
      if (data.mfaRequired === true && !mfaRequired) {
        setMfaRequired(true);
        setError(data.error ?? "Введите код подтверждения");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Не удалось войти");
        return;
      }

      router.push(typeof data.redirectTo === "string" ? data.redirectTo : "/agent/cases");
      router.refresh();
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте снова.");
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
      setError("Нет связи. Проверьте интернет и попробуйте снова.");
    } finally {
      setLoading(null);
    }
  }

  const isRegister = mode === "register";

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.08fr_0.92fr]">
      <aside data-shader-host className="relative hidden flex-col justify-between overflow-hidden td-night px-14 py-14 text-on-accent lg:flex">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {/* CSS-фолбэк под канвасом: если WebGL недоступен, обложка остаётся прежней */}
          <div
            className="absolute inset-0 opacity-[0.10]"
            style={{ backgroundImage: "radial-gradient(1100px 600px at 12% 6%, rgba(255,255,255,0.6), transparent 62%)" }}
          />
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{ backgroundImage: "radial-gradient(760px 540px at 100% 100%, var(--color-accent), transparent 60%)" }}
          />
          {/* Живая обложка: тихое волновое поле, ripple под курсором (DELIGHT) */}
          <QuietShader palette="night" interactive className="absolute inset-0 h-full w-full" />
          {/* Бренд-мотив: концентричные кольца - «точка» бренда в масштабе */}
          <div className="pointer-events-none absolute -bottom-40 -right-28 h-[460px] w-[460px] rounded-full border border-on-accent/[0.06]" />
          <div className="pointer-events-none absolute -bottom-28 -right-16 h-[320px] w-[320px] rounded-full border border-on-accent/[0.05]" />
        </div>
        <div className="rise relative flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-on-accent/10 ring-1 ring-on-accent/15">
            <span className="block h-2.5 w-2.5 rounded-full bg-on-accent" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-on-accent/80">
            Тихий дом
          </span>
        </div>

        <div className="relative max-w-[560px]">
          <span className="rise rise-1 inline-flex rounded-full border border-on-accent/12 bg-on-accent/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-on-accent/64">
            агентская платформа
          </span>
          <h1 className="td-display rise rise-2 mt-6 text-[54px] leading-[1.02] text-on-accent">
            Кабинет для реальной работы агента и отдельный безопасный демо-вход.
          </h1>
        </div>

        <div className="rise relative flex items-center gap-2.5 text-[12px] text-on-accent/70" style={{ animationDelay: "0.55s" }}>
          <ShieldCheck size={16} weight="duotone" />
          Рабочий вход сохраняет ваши кейсы и данные клиентов
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
              <div className="td-segmented w-full">
                {(["login", ...(registrationAvailable ? ["register" as const] : [])] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setMode(item);
                      setError(null);
                    }}
                    data-active={mode === item ? "true" : undefined}
                    className="td-segment flex-1"
                  >
                    {item === "login" ? "Войти" : "Регистрация"}
                  </button>
                ))}
              </div>

              <span className="td-eyebrow mt-6">{isRegister ? "новый агент" : "вход для агента"}</span>
              <h2 className="mt-5 td-display text-[32px] leading-tight text-ink">
                {isRegister ? "Создать профиль агента" : "Войти в кабинет"}
              </h2>
              <p className="mt-2 text-[14px] leading-6 text-ink-2">
                {isRegister
                  ? "Приглашение привяжет профиль к рабочей организации и роли, указанной администратором."
                  : registrationAvailable
                    ? "Используйте email и пароль агента или перейдите к регистрации по приглашению."
                    : "Используйте email и пароль агента. Новые рабочие аккаунты создаются только по приглашению организации."}
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

                {!isRegister && mfaRequired && (
                  <Field
                    id="platform-mfa-code"
                    label="Код подтверждения"
                    icon={<ShieldCheck size={17} />}
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    minLength={6}
                    maxLength={6}
                    required
                  />
                )}

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
                      className="td-icon-button h-9 w-9"
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

                <Button
                  type="submit"
                  disabled={loading !== null || !email || !password || (isRegister && !name)}
                  size="lg"
                  loading={loading === mode}
                  className="group mt-2 w-full pr-3"
                >
                  {isRegister ? "Создать и войти" : "Войти"}
                  {loading !== mode && (
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-on-accent/12 transition-transform group-hover:translate-x-0.5">
                      <ArrowRight size={17} />
                    </span>
                  )}
                </Button>
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
                className={buttonClasses({ variant: "secondary", size: "lg", className: "w-full" })}
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

export default function AgentLoginPage() {
  return <Suspense><AgentLoginContent /></Suspense>;
}
