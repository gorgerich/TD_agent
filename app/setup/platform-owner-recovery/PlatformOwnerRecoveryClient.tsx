"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Eye, EyeSlash, LockKey, WarningCircle } from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";

type State = "loading" | "ready" | "error" | "submitting" | "success";
type MfaSetup = { secret: string; uri: string };

const INVALID_MESSAGE = "Ссылка недействительна, истекла или уже была использована.";

export function PlatformOwnerRecoveryClient() {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<State>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async (rawToken: string) => {
    setError(null);
    setState("loading");
    try {
      const response = await fetch("/api/platform-admin/owner-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "VERIFY", token: rawToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status >= 500) {
          setError(typeof data.error === "string" ? data.error : "Сервис временно недоступен.");
          setState("error");
          return;
        }
        setToken(null);
        setError(INVALID_MESSAGE);
        setState("error");
        return;
      }
      setMfaSetup({ secret: data.mfaSecret, uri: data.mfaUri });
      setError(null);
      setState("ready");
    } catch {
      setError("Нет связи. Повторите проверку.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const rawToken = params.get("token")?.trim() ?? "";
    window.history.replaceState(window.history.state, "", window.location.pathname);
    if (!rawToken) {
      window.setTimeout(() => {
        setError(INVALID_MESSAGE);
        setState("error");
      }, 0);
      return;
    }
    window.setTimeout(() => {
      setToken(rawToken);
      void verify(rawToken);
    }, 0);
  }, [verify]);

  async function recover(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setState("submitting");
    try {
      const response = await fetch("/api/platform-admin/owner-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RECOVER",
          token,
          password,
          confirmation,
          mfaCode,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : INVALID_MESSAGE);
        setState(response.status === 422 ? "ready" : "error");
        if (response.status !== 422) setToken(null);
        return;
      }
      setToken(null);
      setPassword("");
      setConfirmation("");
      setMfaCode("");
      setMfaSetup(null);
      setState("success");
      window.setTimeout(() => {
        router.replace(typeof data.redirectTo === "string" ? data.redirectTo : "/platform-admin");
        router.refresh();
      }, 350);
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте снова.");
      setState("ready");
    }
  }

  const busy = state === "loading" || state === "submitting";

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#f3f5f4] px-4 py-8 sm:px-6">
      <section className="w-full max-w-[560px] rounded-[16px] bg-white px-5 py-7 shadow-[0_2px_12px_rgba(13,47,42,0.08)] sm:px-8 sm:py-9" aria-labelledby="recovery-title">
        <header className="max-w-[460px]">
          <div className="flex items-center gap-3 text-[#176b5d]">
            <LockKey size={24} weight="fill" aria-hidden />
            <span className="text-[12px] font-semibold">Тихий дом</span>
          </div>
          <h1 id="recovery-title" className="mt-6 text-[29px] font-semibold leading-tight text-[#132421] sm:text-[34px]">
            Восстановление доступа владельца
          </h1>
          <p className="mt-3 text-[14px] leading-6 text-[#536762]">
            Задайте новый пароль и заново подключите приложение-аутентификатор.
          </p>
        </header>

        <div className="mt-7" aria-live="polite">
          {state === "loading" && (
            <Status icon={<LockKey size={22} weight="fill" />} title="Проверяем защищённую ссылку" text="Это займёт несколько секунд." />
          )}

          {state === "error" && (
            <>
              <Status
                icon={<WarningCircle size={23} weight="fill" />}
                title="Не удалось восстановить доступ"
                text={error ?? INVALID_MESSAGE}
                tone="error"
              />
              {token && (
                <button
                  type="button"
                  onClick={() => void verify(token)}
                  className="min-h-11 rounded-[10px] bg-[#0d3b34] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#154d44]"
                >
                  Повторить проверку
                </button>
              )}
            </>
          )}

          {state === "success" && (
            <Status
              icon={<CheckCircle size={24} weight="fill" />}
              title="Доступ восстановлен"
              text="Старые сессии отозваны. Открываем администрирование платформы."
              tone="success"
            />
          )}

          {(state === "ready" || state === "submitting") && (
            <form onSubmit={recover} className="grid gap-5" aria-busy={busy}>
              <div>
                <label htmlFor="platform-owner-password" className="block text-[12px] font-semibold text-[#344b46]">
                  Новый пароль
                </label>
                <div className="relative mt-2">
                  <input
                    id="platform-owner-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    required
                    className="min-h-12 w-full rounded-[10px] bg-[#f3f5f4] px-4 pr-12 text-[15px] text-[#132421] outline-none ring-1 ring-[#d7dedb] focus:ring-2 focus:ring-[#176b5d]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-0 grid w-12 place-items-center text-[#60716d] hover:text-[#132421]"
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  >
                    {showPassword ? <EyeSlash size={20} weight="bold" /> : <Eye size={20} weight="bold" />}
                  </button>
                </div>
              </div>

              <label htmlFor="platform-owner-password-confirmation">
                <span className="block text-[12px] font-semibold text-[#344b46]">Повторите пароль</span>
                <input
                  id="platform-owner-password-confirmation"
                  type={showPassword ? "text" : "password"}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                  className="mt-2 min-h-12 w-full rounded-[10px] bg-[#f3f5f4] px-4 text-[15px] text-[#132421] outline-none ring-1 ring-[#d7dedb] focus:ring-2 focus:ring-[#176b5d]"
                />
              </label>

              <ul className="space-y-1 text-[12px] leading-5 text-[#60716d]" aria-label="Требования к паролю">
                <li>Не менее 12 символов</li>
                <li>Не используйте очевидные последовательности и название сервиса</li>
                <li>Пароль должен совпадать в обоих полях</li>
              </ul>

              {mfaSetup && (
                <section aria-labelledby="mfa-setup-title" className="grid gap-4 bg-[#f3f5f4] p-4 sm:grid-cols-[152px_1fr] sm:items-center">
                  <div
                    className="grid place-items-center bg-white p-3"
                    role="img"
                    aria-label="QR-код для приложения-аутентификатора"
                  >
                    <QRCodeSVG
                      value={mfaSetup.uri}
                      size={128}
                      level="M"
                      marginSize={0}
                    />
                  </div>
                  <div>
                    <h2 id="mfa-setup-title" className="text-[13px] font-semibold text-[#344b46]">Подключите защиту входа</h2>
                    <p className="mt-1 text-[12px] leading-5 text-[#60716d]">
                      Отсканируйте QR-код. Если камера недоступна, введите ключ вручную.
                    </p>
                    <code className="mt-2 block break-all text-[12px] leading-5 text-[#132421]">{mfaSetup.secret}</code>
                  </div>
                </section>
              )}

              <label htmlFor="platform-owner-mfa-code">
                <span className="block text-[12px] font-semibold text-[#344b46]">Код из приложения</span>
                <input
                  id="platform-owner-mfa-code"
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  minLength={6}
                  maxLength={6}
                  required
                  className="mt-2 min-h-12 w-full rounded-[10px] bg-[#f3f5f4] px-4 text-[16px] text-[#132421] outline-none ring-1 ring-[#d7dedb] focus:ring-2 focus:ring-[#176b5d]"
                />
              </label>

              {error && <p role="alert" className="text-[12px] font-medium text-[#b42318]">{error}</p>}

              <button
                type="submit"
                disabled={busy || password.length < 12 || confirmation.length < 12 || mfaCode.length !== 6}
                className="min-h-12 rounded-[10px] bg-[#0d3b34] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#154d44] disabled:cursor-not-allowed disabled:bg-[#aab7b3]"
              >
                {state === "submitting" ? "Восстанавливаем…" : "Обновить пароль"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-7 text-[11px] leading-5 text-[#71817d]">
          Ссылка одноразовая и действует 15 минут. После восстановления все старые сессии перестанут работать.
        </p>
      </section>
    </main>
  );
}

function Status({
  icon,
  title,
  text,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  tone?: "neutral" | "error" | "success";
}) {
  const color = tone === "error" ? "text-[#b42318]" : tone === "success" ? "text-[#176b5d]" : "text-[#60716d]";
  return (
    <div className={`py-6 ${color}`}>
      {icon}
      <h2 className="mt-4 text-[17px] font-semibold text-[#132421]">{title}</h2>
      <p className="mt-2 text-[13px] leading-6">{text}</p>
    </div>
  );
}
