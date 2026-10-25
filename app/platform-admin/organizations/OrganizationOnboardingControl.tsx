"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Copy, ArrowClockwise } from "@phosphor-icons/react";
import Button from "@/components/ui/Button";

const CONFIRMATION = "НАЗНАЧИТЬ АДМИНИСТРАТОРА";
type Command = { path: string; body: string; key: string };
type Result = { organizationId: string; replayed: boolean; inviteUrl: string | null };

export function OrganizationOnboardingControl({ organizationId }: { organizationId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const command = useRef<Command | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; command.current = null; }; }, []);

  async function send(envelope: Command) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(envelope.path, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": envelope.key, "X-Correlation-Id": envelope.key }, body: envelope.body,
      });
      const data = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok) {
        setPending(response.status >= 500);
        setMessage(typeof data?.error === "string" ? data.error : "Не удалось выполнить операцию. Повторите запрос.");
        return;
      }
      if (typeof data?.organizationId !== "string" || !data.organizationId || typeof data.replayed !== "boolean"
        || (data.inviteUrl !== null && typeof data.inviteUrl !== "string")) throw new Error("Invalid acknowledgement");
      if (data.inviteUrl !== null) {
        const invite = new URL(data.inviteUrl);
        if (invite.origin !== window.location.origin || invite.pathname !== "/agent/login" || !/^#invite=[A-Za-z0-9_-]{43}$/.test(invite.hash)) {
          throw new Error("Invalid invitation acknowledgement");
        }
      }
      setPending(false);
      setResult(data);
      command.current = null;
      router.refresh();
    } catch {
      if (mounted.current) { setPending(true); setMessage("Результат не подтверждён. Повторите исходный запрос без изменения данных."); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || pending || result) return;
    const fields = new FormData(event.currentTarget);
    const body = JSON.stringify({
      ...(organizationId ? {} : { name: String(fields.get("name") ?? "").trim(), slug: String(fields.get("slug") ?? "").trim(), timezone: String(fields.get("timezone") ?? "").trim() }),
      email: String(fields.get("email") ?? "").trim(), reason: String(fields.get("reason") ?? "").trim(), confirmation: String(fields.get("confirmation") ?? ""),
    });
    const path = organizationId ? `/api/platform-admin/organizations/${encodeURIComponent(organizationId)}/first-admin-invite` : "/api/platform-admin/organizations";
    if (command.current?.body !== body) command.current = { path, body, key: crypto.randomUUID() };
    void send(command.current);
  }

  async function copyInvitation() {
    if (!result?.inviteUrl) return;
    try { await navigator.clipboard.writeText(result.inviteUrl); if (mounted.current) setMessage("Приглашение скопировано."); }
    catch { if (mounted.current) setMessage("Копирование недоступно. Выделите и скопируйте ссылку ниже."); }
  }

  return <section className="mt-5 min-w-0 text-ink">
    {!open ? <Button type="button" className="rounded-xs" onClick={() => setOpen(true)} leftIcon={<Plus aria-hidden size={18} />}>{organizationId ? "Пригласить первого ADMIN" : "Создать организацию"}</Button> : <>
      <h2 className="text-[17px] font-semibold">{organizationId ? "Приглашение первого ADMIN" : "Новая организация"}</h2>
      {!result && <form onSubmit={submit} className="mt-4 grid max-w-xl gap-4">
        <fieldset disabled={busy || pending} className="grid min-w-0 gap-4">
          {!organizationId && <>
            <label className="grid min-w-0 gap-2 text-sm">Название<input name="name" required minLength={2} maxLength={160} className="min-h-11 min-w-0 rounded-xs bg-surface-2 px-3" /></label>
            <label className="grid min-w-0 gap-2 text-sm">Идентификатор организации<input name="slug" required minLength={3} maxLength={80} pattern="[a-z0-9]+(-[a-z0-9]+)*" autoCapitalize="none" autoComplete="off" className="min-h-11 min-w-0 rounded-xs bg-surface-2 px-3" /></label>
            <label className="grid min-w-0 gap-2 text-sm">Часовой пояс<input name="timezone" required maxLength={100} defaultValue="Europe/Moscow" className="min-h-11 min-w-0 rounded-xs bg-surface-2 px-3" /></label>
          </>}
          <label className="grid min-w-0 gap-2 text-sm">Email первого ADMIN<input name="email" type="email" autoComplete="email" required maxLength={254} className="min-h-11 min-w-0 rounded-xs bg-surface-2 px-3" /></label>
          <label className="grid min-w-0 gap-2 text-sm">Основание<textarea name="reason" required minLength={3} maxLength={240} className="min-h-20 min-w-0 rounded-xs bg-surface-2 p-3" /></label>
          <label className="grid min-w-0 gap-2 text-sm [overflow-wrap:anywhere]">Подтверждение: {CONFIRMATION}<input name="confirmation" required autoComplete="off" className="min-h-11 min-w-0 rounded-xs bg-surface-2 px-3" /></label>
          <Button type="submit" loading={busy} className="justify-self-start rounded-xs">{organizationId ? "Выдать новое приглашение" : "Создать и пригласить ADMIN"}</Button>
        </fieldset>
        {pending && <Button type="button" loading={busy} className="justify-self-start rounded-xs" leftIcon={<ArrowClockwise aria-hidden size={18} />} onClick={() => { if (command.current) void send(command.current); }}>Повторить исходный запрос</Button>}
      </form>}
      {result && <div role="status" className="mt-4 grid min-w-0 max-w-xl gap-3 text-sm">
        <p>{result.inviteUrl ? "Приглашение первого ADMIN создано. Ссылка доступна только сейчас." : "Команда уже выполнена. Для новой ссылки перевыпустите приглашение в карточке организации."}</p>
        {result.inviteUrl && <>
          <textarea aria-label="Одноразовое приглашение ADMIN" readOnly value={result.inviteUrl} className="min-h-24 w-full min-w-0 rounded-xs bg-surface-2 p-3 [overflow-wrap:anywhere]" />
          <Button type="button" className="justify-self-start rounded-xs" onClick={copyInvitation} leftIcon={<Copy aria-hidden size={18} />}>Копировать приглашение</Button>
        </>}
        <Link href={`/platform-admin/organizations/${encodeURIComponent(result.organizationId)}`} className="inline-flex min-h-11 items-center font-semibold">Открыть организацию</Link>
        {organizationId && <Button type="button" variant="ghost" className="justify-self-start rounded-xs" onClick={() => { setResult(null); setMessage(""); }}>Перевыпустить приглашение</Button>}
      </div>}
      {message && <p role="status" className="mt-3 max-w-xl text-sm [overflow-wrap:anywhere]">{message}</p>}
    </>}
  </section>;
}
