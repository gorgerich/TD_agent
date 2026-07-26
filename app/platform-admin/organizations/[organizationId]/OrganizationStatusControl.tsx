"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OrganizationStatusControl({ organizationId, status }: { organizationId: string; status: "ACTIVE" | "SUSPENDED" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const expected = next === "SUSPENDED" ? "ПРИОСТАНОВИТЬ ОРГАНИЗАЦИЮ" : "ВОЗОБНОВИТЬ ОРГАНИЗАЦИЮ";

  async function submit() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/platform-admin/organizations/${organizationId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next, confirmation }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "Не удалось изменить статус");
      return;
    }
    setOpen(false);
    setConfirmation("");
    router.refresh();
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className={`min-h-10 rounded-[9px] px-4 text-[12px] font-semibold ${status === "ACTIVE" ? "bg-[#f7ead7] text-[#7b5016]" : "bg-[#0d2f2a] text-white"}`}>{status === "ACTIVE" ? "Приостановить" : "Возобновить"}</button>;
  }
  return (
    <div className="w-full max-w-[460px] rounded-[12px] bg-[#f3f5f4] p-4">
      <p className="text-[13px] font-semibold">{status === "ACTIVE" ? "Рабочий доступ сотрудников будет остановлен." : "Рабочий доступ активных сотрудников будет восстановлен."}</p>
      <label className="mt-3 block text-[12px] text-[#60716d]">
        Введите <strong>{expected}</strong>
        <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 min-h-11 w-full rounded-[9px] bg-white px-3 text-[13px]" />
      </label>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={busy || confirmation !== expected} onClick={submit} className="min-h-10 rounded-[9px] bg-[#0d2f2a] px-4 text-[12px] font-semibold text-white disabled:opacity-40">Подтвердить</button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-[9px] px-3 text-[12px] font-semibold text-[#536762]">Отмена</button>
      </div>
    </div>
  );
}
