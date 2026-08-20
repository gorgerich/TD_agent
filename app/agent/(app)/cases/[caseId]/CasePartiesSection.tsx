"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PencilSimple, UserPlus } from "@phosphor-icons/react";
import { Button, buttonClasses } from "@/components/ui/Button";

export type CasePartyItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  preferredChannel: string;
  consentStatus: string;
  consentSource: string | null;
  consentAt: string | null;
  visibilityPolicy: string;
  roles: string[];
  createdAt: string;
};

const ROLE_OPTIONS = [
  ["APPLICANT", "Заявитель"],
  ["DECISION_MAKER", "Принимает решения"],
  ["PAYER", "Плательщик"],
  ["RESPONSIBLE_FOR_BURIAL", "Ответственный за захоронение"],
  ["ADDITIONAL_CONTACT", "Дополнительный контакт"],
] as const;

const CONSENT_LABELS: Record<string, string> = {
  UNKNOWN: "Не определено",
  NOT_REQUESTED: "Не запрашивалось",
  GRANTED: "Получено",
  WITHDRAWN: "Отозвано",
  RESTRICTED: "Ограничено",
};

export function CasePartiesSection({ caseId, parties, canMutate }: { caseId: number; parties: CasePartyItem[]; canMutate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roles = form.getAll("roles").map(String);
    const commandId = crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/cases/${caseId}/parties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `case-party:${commandId}`,
          "X-Correlation-Id": commandId,
        },
        body: JSON.stringify({
          name: form.get("name"),
          phone: String(form.get("phone") ?? "").trim() || null,
          email: String(form.get("email") ?? "").trim() || null,
          roles,
          preferredChannel: form.get("preferredChannel"),
          consentStatus: form.get("consentStatus"),
          consentSource: String(form.get("consentSource") ?? "").trim() || null,
          consentAt: form.get("consentStatus") === "GRANTED" ? new Date().toISOString() : null,
          visibilityPolicy: "CASE_TEAM",
        }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Участник не сохранён");
      event.currentTarget.reset();
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Участник не сохранён");
    } finally {
      setBusy(false);
    }
  }

  async function submitUpdate(event: React.FormEvent<HTMLFormElement>, party: CasePartyItem) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const consentStatus = String(form.get("consentStatus"));
    const commandId = crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/cases/${caseId}/parties/${party.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `case-party-update:${commandId}`,
          "X-Correlation-Id": commandId,
        },
        body: JSON.stringify({
          name: form.get("name"),
          phone: String(form.get("phone") ?? "").trim() || null,
          email: String(form.get("email") ?? "").trim() || null,
          roles: form.getAll("roles").map(String),
          preferredChannel: form.get("preferredChannel"),
          consentStatus,
          consentSource: String(form.get("consentSource") ?? "").trim() || null,
          consentAt: consentStatus === "GRANTED" ? party.consentAt ?? new Date().toISOString() : null,
          visibilityPolicy: party.visibilityPolicy,
        }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Изменения не сохранены");
      setEditingId(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Изменения не сохранены");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <p className="text-[12px] leading-relaxed text-ink-3">Роли привязаны к стабильному ID участника, а не к имени или позиции в списке.</p>
        {canMutate && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
            <UserPlus size={15} weight="bold" /> {open ? "Закрыть форму" : "Добавить участника"}
          </Button>
        )}
      </div>

      {error && <p role="alert" className="bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">{error}</p>}
      {open && (
        <form onSubmit={submit} className="grid gap-4 bg-surface-2 p-4" aria-label="Добавить участника кейса">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="td-field-label">Имя</span>
              <input className="td-field" name="name" minLength={2} maxLength={200} required autoComplete="off" />
            </label>
            <label>
              <span className="td-field-label">Телефон</span>
              <input className="td-field" name="phone" maxLength={80} inputMode="tel" autoComplete="off" />
            </label>
            <label>
              <span className="td-field-label">Email</span>
              <input className="td-field" name="email" type="email" maxLength={240} autoComplete="off" />
            </label>
            <label>
              <span className="td-field-label">Предпочтительный канал</span>
              <select className="td-field" name="preferredChannel" defaultValue="PHONE">
                <option value="PHONE">Телефон</option>
                <option value="EMAIL">Email</option>
                <option value="MESSENGER">Мессенджер</option>
                <option value="IN_PERSON">Лично</option>
                <option value="NONE">Не выбран</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="td-field-label">Роли</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_OPTIONS.map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 bg-surface px-3 text-[13px] text-ink-2">
                  <input type="checkbox" name="roles" value={value} className="h-4 w-4" /> {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="td-field-label">Согласие</span>
              <select className="td-field" name="consentStatus" defaultValue="UNKNOWN">
                <option value="UNKNOWN">Не определено</option>
                <option value="NOT_REQUESTED">Не запрашивалось</option>
                <option value="GRANTED">Получено</option>
                <option value="WITHDRAWN">Отозвано</option>
                <option value="RESTRICTED">Ограничено</option>
              </select>
            </label>
            <label>
              <span className="td-field-label">Источник согласия</span>
              <input className="td-field" name="consentSource" maxLength={240} placeholder="Например, бумажная форма" />
            </label>
          </div>
          <div><Button type="submit" size="sm" loading={busy}>Сохранить участника</Button></div>
        </form>
      )}

      {parties.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-3">Участники и их роли ещё не зафиксированы.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Участники кейса">
          {parties.map((party) => (
            <li key={party.id} className="py-3 first:pt-0 last:pb-0">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(220px,auto)_auto] sm:items-start">
                <div className="min-w-0">
                  <strong className="block truncate text-[14px] text-ink">{party.name}</strong>
                  <p className="mt-1 break-words text-[12px] text-ink-3">{[party.phone, party.email].filter(Boolean).join(" · ") || "Контакт не указан"}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-[12px] font-medium text-ink-2">{party.roles.map((role) => ROLE_OPTIONS.find(([value]) => value === role)?.[1] ?? role).join(", ")}</p>
                  <p className="mt-1 text-[11px] text-ink-3">Согласие: {CONSENT_LABELS[party.consentStatus] ?? party.consentStatus}</p>
                </div>
                {canMutate && (
                  <button type="button" className={buttonClasses({ variant: "secondary", size: "sm", className: "h-11 w-11 p-0" })} onClick={() => setEditingId(editingId === party.id ? null : party.id)} aria-label={`Изменить ${party.name}`}>
                    <PencilSimple size={15} />
                  </button>
                )}
              </div>
              {editingId === party.id && <PartyEditForm party={party} busy={busy} onCancel={() => setEditingId(null)} onSubmit={(event) => submitUpdate(event, party)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PartyEditForm({ party, busy, onCancel, onSubmit }: { party: CasePartyItem; busy: boolean; onCancel: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-4 bg-surface-2 p-4" aria-label={`Изменить участника ${party.name}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="td-field-label">Имя</span><input className="td-field" name="name" defaultValue={party.name} minLength={2} maxLength={200} required autoComplete="off" /></label>
        <label><span className="td-field-label">Телефон</span><input className="td-field" name="phone" defaultValue={party.phone ?? ""} maxLength={80} inputMode="tel" autoComplete="off" /></label>
        <label><span className="td-field-label">Email</span><input className="td-field" name="email" defaultValue={party.email ?? ""} type="email" maxLength={240} autoComplete="off" /></label>
        <label><span className="td-field-label">Предпочтительный канал</span><select className="td-field" name="preferredChannel" defaultValue={party.preferredChannel}><option value="PHONE">Телефон</option><option value="EMAIL">Email</option><option value="MESSENGER">Мессенджер</option><option value="IN_PERSON">Лично</option><option value="NONE">Не выбран</option></select></label>
      </div>
      <fieldset>
        <legend className="td-field-label">Роли</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ROLE_OPTIONS.map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-2 bg-surface px-3 text-[13px] text-ink-2">
              <input type="checkbox" name="roles" value={value} defaultChecked={party.roles.includes(value)} className="h-4 w-4" /> {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className="td-field-label">Согласие</span><select className="td-field" name="consentStatus" defaultValue={party.consentStatus}><option value="UNKNOWN">Не определено</option><option value="NOT_REQUESTED">Не запрашивалось</option><option value="GRANTED">Получено</option><option value="WITHDRAWN">Отозвано</option><option value="RESTRICTED">Ограничено</option></select></label>
        <label><span className="td-field-label">Источник согласия</span><input className="td-field" name="consentSource" defaultValue={party.consentSource ?? ""} maxLength={240} /></label>
      </div>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonClasses({ variant: "ghost", size: "sm" })} onClick={onCancel}>Отмена</button><Button type="submit" size="sm" loading={busy}>Сохранить</Button></div>
    </form>
  );
}
