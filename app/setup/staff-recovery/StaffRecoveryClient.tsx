"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { LockKey } from "@phosphor-icons/react";

type Setup = { secret: string; uri: string; resetMfa: boolean };
const INVALID = "Ссылка недействительна, истекла или уже была использована.";
const field = "min-h-12 w-full min-w-0 rounded-xs bg-surface-2 px-3 text-base text-ink";

async function readRecoverySetup(bearer: string): Promise<{ status: "ready"; setup: Setup } | { status: "invalid" | "unavailable" }> {
  const response = await fetch("/api/agent/auth/staff-recovery", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "VERIFY", token: bearer }) });
  const data = await response.json().catch(() => null);
  if (response.ok && data?.valid === true && typeof data.mfaSecret === "string" && typeof data.mfaUri === "string" && typeof data.resetMfa === "boolean") {
    return { status: "ready", setup: { secret: data.mfaSecret, uri: data.mfaUri, resetMfa: data.resetMfa } };
  }
  return { status: response.status === 400 ? "invalid" : "unavailable" };
}

export function StaffRecoveryClient() {
  const router = useRouter();
  const started = useRef(false);
  const inFlight = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [complete, setComplete] = useState(false);

  const verify = useCallback(async (bearer: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await readRecoverySetup(bearer);
      if (result.status === "ready") {
        setSetup(result.setup);
      } else {
        setSetup(null);
        setMessage(result.status === "invalid" ? INVALID : "Проверка недоступна. Повторите позже.");
        if (result.status === "invalid") setToken(null);
      }
    } catch { setMessage("Нет связи. Повторите проверку."); }
    finally { inFlight.current = false; setBusy(false); }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const bearer = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(window.history.state, "", window.location.pathname);
    window.setTimeout(() => {
      if (!/^[A-Za-z0-9_-]{43}$/.test(bearer)) { setBusy(false); setMessage(INVALID); return; }
      setToken(bearer);
      void verify(bearer);
    }, 0);
  }, [verify]);

  async function recover(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !setup || inFlight.current) return;
    if (password !== confirmation) { setMessage("Пароли не совпадают."); return; }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/agent/auth/staff-recovery", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RECOVER", token, password, confirmation, mfaCode: code }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.ok !== true) {
        if (response.status === 400) {
          // The API deliberately does not distinguish an invalid TOTP from a dead link.
          const rechecked = await readRecoverySetup(token);
          if (rechecked.status === "ready") {
            setSetup(rechecked.setup); setCode("");
            setMessage("Не удалось восстановить доступ. Проверьте код из приложения и повторите.");
          } else if (rechecked.status === "invalid") {
            setToken(null); setSetup(null); setPassword(""); setConfirmation(""); setCode(""); setMessage(INVALID);
          } else setMessage("Проверка недоступна. Повторите позже.");
          return;
        }
        setMessage(response.status === 400 ? INVALID : response.status === 422 ? "Проверьте пароль и подтверждение." : "Восстановление недоступно. Повторите позже.");
        return;
      }
      setToken(null); setSetup(null); setPassword(""); setConfirmation(""); setCode(""); setComplete(true);
      router.replace(data.redirectTo === "/agent/finance" || data.redirectTo === "/agent/document-review" ? data.redirectTo : "/agent/cases");
      router.refresh();
    } catch { setMessage("Нет связи. Повторите запрос с теми же данными."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <main className="min-h-[100dvh] bg-canvas px-4 py-10 text-ink sm:px-6">
    <div className="mx-auto grid w-full max-w-lg min-w-0 gap-6">
      <header><LockKey size={28} aria-hidden /><h1 className="mt-4 text-lg font-semibold [overflow-wrap:anywhere]">Восстановление доступа сотрудника</h1></header>
      {busy && !setup && <p role="status">Проверяем ссылку...</p>}
      {complete && <p role="status">Доступ восстановлен. Старые сессии отозваны.</p>}
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      {!setup && token && !busy && <button type="button" onClick={() => void verify(token)} className="min-h-11 justify-self-start rounded-xs bg-ink px-4 text-white">Повторить проверку</button>}
      {setup && <form onSubmit={recover} className="grid min-w-0 gap-5" aria-busy={busy}>
        <fieldset disabled={busy} className="grid min-w-0 gap-5">
          <label className="grid gap-2 text-sm">Новый пароль
            <input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          </label>
          <label className="grid gap-2 text-sm">Повторите пароль
            <input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={field} />
          </label>
          <p className="text-sm">{setup.resetMfa ? "Подключите новый ключ входа в приложении-аутентификаторе." : "Добавьте одноразовую проверку восстановления в приложение-аутентификатор."}</p>
          <div data-sensitive="staff-recovery-mfa" className="grid min-w-0 gap-3">
            <div role="img" aria-label="QR-код для приложения-аутентификатора" className="w-fit bg-white p-3"><QRCodeSVG value={setup.uri} size={128} level="M" /></div>
            <code className="break-all text-sm">{setup.secret}</code>
          </div>
          <label className="grid gap-2 text-sm">Код из приложения
            <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className={field} />
          </label>
          <button type="submit" disabled={password.length < 12 || password !== confirmation || code.length !== 6} className="min-h-12 rounded-xs bg-ink px-4 font-semibold text-white disabled:opacity-40">{busy ? "Восстанавливаем..." : "Восстановить доступ"}</button>
        </fieldset>
      </form>}
    </div>
  </main>;
}
