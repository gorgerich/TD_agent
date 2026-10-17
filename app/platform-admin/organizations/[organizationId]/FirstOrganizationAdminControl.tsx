"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CONFIRMATION = "НАЗНАЧИТЬ АДМИНИСТРАТОРА";

export function FirstOrganizationAdminControl({ organizationId, organizationName, candidates }: {
  organizationId: string;
  organizationName: string;
  candidates: { id: string; label: string }[];
}) {
  const router = useRouter();
  const employeeId = useId();
  const [membershipId, setMembershipId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<{ signature: string; key: string } | null>(null);
  const selectedCandidate = candidates.find((candidate) => candidate.id === membershipId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const payload = { membershipId, reason: reason.trim(), confirmation };
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature) request.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/platform-admin/organizations/${encodeURIComponent(organizationId)}/first-admin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": request.current.key, "X-Correlation-Id": request.current.key },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error ?? "Не удалось назначить ADMIN"); return; }
      setMessage("Первый ADMIN назначен.");
      router.refresh();
    } catch {
      setMessage("Нет связи. Повторите запрос с теми же данными.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 bg-surface p-5 text-ink">
      <h2 className="text-[17px] font-semibold">Первый администратор</h2>
      <p className="mt-2 break-words text-sm">{organizationName} · {organizationId}</p>
      {candidates.length ? (
        <form onSubmit={submit} className="mt-4 grid max-w-xl gap-4">
          <fieldset disabled={busy} className="grid min-w-0 gap-4">
            <div className="grid gap-2 text-sm">
              <label htmlFor={employeeId}>Сотрудник</label>
              <select id={employeeId} aria-describedby={selectedCandidate ? `${employeeId}-selection` : undefined} required value={membershipId} onChange={(event) => setMembershipId(event.target.value)} className="min-h-11 w-full min-w-0 rounded-xs bg-surface-2 px-3">
                <option value="">Выберите сотрудника</option>
                {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
              </select>
              {selectedCandidate && <p id={`${employeeId}-selection`} className="break-all text-sm">{selectedCandidate.label}</p>}
            </div>
            <label className="grid gap-2 text-sm">Причина назначения
              <textarea required minLength={3} maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-20 w-full rounded-xs bg-surface-2 p-3" />
            </label>
            <label className="grid gap-2 text-sm">Подтверждение: {CONFIRMATION}
              <input required autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="min-h-11 w-full rounded-xs bg-surface-2 px-3" />
            </label>
            <button disabled={!membershipId || reason.trim().length < 3 || confirmation !== CONFIRMATION} type="submit" className="min-h-11 justify-self-start rounded-xs bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink-2 disabled:opacity-40">{busy ? "Назначение..." : "Назначить первого ADMIN"}</button>
          </fieldset>
        </form>
      ) : <p className="mt-3 text-sm">Нет активного сотрудника с рабочим доступом для назначения.</p>}
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    </section>
  );
}
