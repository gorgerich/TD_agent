"use client";

import { useId, useRef, useState } from "react";
import { STAFF_RECOVERY_CONFIRMATION } from "@/lib/staffRecoveryConfirmation";

export function StaffRecoveryControl({ memberships }: { memberships: { id: string; organizationId: string; label: string }[] }) {
  const issuedUrlId = useId();
  const membershipFieldId = useId();
  const [membershipId, setMembershipId] = useState(memberships[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [issued, setIssued] = useState<{ id: string; url: string; expiresAt: string; membershipId: string; organizationId: string } | null>(null);
  const pending = useRef(false);
  const command = useRef<{ signature: string; key: string } | null>(null);
  const selectedMembership = memberships.find((member) => member.id === membershipId);

  async function submit(event: React.FormEvent, revoke = false) {
    event.preventDefault();
    if (pending.current) return;
    const member = revoke ? issued : memberships.find((m) => m.id === membershipId);
    if (!member) return;
    pending.current = true; setBusy(true); setMessage("");
    if (!revoke) setIssued(null);
    try {
      const targetMembership = revoke ? issued!.membershipId : membershipId;
      const body = { organizationId: member.organizationId, membershipId: targetMembership, reason, confirmation,
        ...(revoke ? { recoveryId: issued!.id } : {}) };
      const signature = JSON.stringify(body);
      if (!revoke && command.current?.signature !== signature) command.current = { signature, key: crypto.randomUUID() };
      const response = await fetch("/api/platform-admin/staff-recovery", { method: revoke ? "DELETE" : "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", ...(!revoke ? { "Idempotency-Key": command.current!.key, "X-Correlation-Id": command.current!.key } : {}) },
        body: JSON.stringify(body) });
      const data = await response.json().catch(() => null);
      if (!response.ok) { setMessage("Не удалось выполнить действие. Проверьте доступ и состояние сотрудника."); return; }
      if (revoke) {
        if (data?.ok !== true) { setMessage("Результат отзыва не подтверждён. Повторите запрос."); return; }
        setIssued(null); setMessage("Ссылка отозвана.");
      }
      else if (data?.replayed === true) setMessage("Выдача уже сохранена. Ссылка повторно не выдаётся. Для замены создайте новую выдачу.");
      else if (typeof data?.url === "string" && typeof data.id === "string" && typeof data.expiresAt === "string") {
        setIssued({ ...data, membershipId, organizationId: member.organizationId });
      } else setMessage("Результат не подтверждён. Повторите запрос с теми же данными.");
    } catch { setMessage("Нет связи. Повторите запрос с теми же данными."); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="mt-6 grid min-w-0 gap-4 text-ink">
    <h2 className="text-lg font-semibold">Восстановление доступа</h2>
    <form onSubmit={submit} className="grid max-w-xl min-w-0 gap-4">
      <fieldset disabled={busy} className="grid min-w-0 gap-4">
        <div className="grid min-w-0 gap-2 text-sm">
          <label htmlFor={membershipFieldId}>Рабочее членство</label>
          <select id={membershipFieldId} aria-describedby={`${membershipFieldId}-selection`} required value={membershipId} onChange={(e) => setMembershipId(e.target.value)} className="min-h-11 min-w-0 rounded-xs bg-surface-2 px-3">{memberships.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          <p id={`${membershipFieldId}-selection`} className="[overflow-wrap:anywhere]">{selectedMembership?.label}</p>
        </div>
        <label className="grid gap-2 text-sm">Причина<input required minLength={3} maxLength={240} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-11 min-w-0 rounded-xs bg-surface-2 px-3" /></label>
        <label className="grid gap-2 text-sm">Подтверждение: {STAFF_RECOVERY_CONFIRMATION}<input required autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="min-h-11 min-w-0 rounded-xs bg-surface-2 px-3" /></label>
        <button type="submit" disabled={!membershipId || reason.trim().length < 3 || confirmation !== STAFF_RECOVERY_CONFIRMATION} className="min-h-11 justify-self-start rounded-xs bg-ink px-4 text-white disabled:opacity-40">Выдать / повторить запрос</button>
        <button type="button" onClick={() => { command.current = null; setIssued(null); setMessage("Подготовлена новая выдача. Подтвердите её: предыдущая ссылка будет отозвана."); }} className="min-h-11 justify-self-start text-ink-2">Начать новую выдачу</button>
      </fieldset>
    </form>
    {issued && <div data-sensitive="staff-recovery-url" className="grid min-w-0 max-w-xl gap-3">
      <div className="grid gap-2 text-sm"><label htmlFor={issuedUrlId}>Одноразовая ссылка</label><textarea id={issuedUrlId} readOnly value={issued.url} className="min-h-24 w-full min-w-0 break-all rounded-xs bg-surface-2 p-3" /></div>
      <p className="text-sm">Действует до {new Date(issued.expiresAt).toLocaleString("ru-RU")}</p>
      <button type="button" disabled={busy || reason.trim().length < 3 || confirmation !== STAFF_RECOVERY_CONFIRMATION} onClick={(e) => void submit(e, true)} className="min-h-11 justify-self-start text-danger disabled:opacity-40">Отозвать ссылку</button>
      <button type="button" onClick={() => setIssued(null)} className="min-h-11 justify-self-start text-ink-2">Скрыть ссылку</button>
    </div>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
