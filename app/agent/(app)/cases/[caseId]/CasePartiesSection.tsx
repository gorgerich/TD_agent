"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PencilSimple, UserPlus } from "@phosphor-icons/react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { zonedLocalInput, zonedLocalToIso } from "@/lib/zonedDateTime";

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
  updatedAt: string;
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

function isCasePartyItem(value: unknown): value is CasePartyItem {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["id", "name", "preferredChannel", "consentStatus", "visibilityPolicy", "createdAt", "updatedAt"].every((key) => typeof row[key] === "string")
    && Number.isFinite(Date.parse(row.updatedAt as string))
    && ["phone", "email", "consentSource", "consentAt"].every((key) => row[key] === null || typeof row[key] === "string")
    && Array.isArray(row.roles) && row.roles.every((role) => typeof role === "string");
}

type CasePartiesProps = { caseId: number; parties: CasePartyItem[]; canMutate: boolean; timezone: string };

export function CasePartiesSection(props: CasePartiesProps) {
  return <CasePartiesContent key={props.caseId} {...props} />;
}

function CasePartiesContent({ caseId, parties, canMutate, timezone }: CasePartiesProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newPartyRoles, setNewPartyRoles] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const pendingCreate = useRef<{ key: string; body: string } | null>(null);
  const pendingUpdate = useRef<{ key: string; body: string } | null>(null);
  const active = useRef(true);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    abort.current = new AbortController();
    return () => { active.current = false; abort.current?.abort(); };
  }, []);
  const [pendingAcknowledgement, setPendingAcknowledgement] = useState(false);
  const [savedParties, setSavedParties] = useState<CasePartyItem[]>([]);
  const [previousParties, setPreviousParties] = useState(parties);
  const [pendingSync, setPendingSync] = useState<{ partyId: string } | null>(null);
  const visibleParties = parties.map((party) => savedParties.find((saved) => saved.id === party.id
    && Date.parse(saved.updatedAt) > Date.parse(party.updatedAt)) ?? party)
    .concat(savedParties.filter((saved) => !parties.some((party) => party.id === saved.id)));

  // A delayed refresh must not replace a canonical read-back with an older SSR row.
  if (parties !== previousParties) {
    setPreviousParties(parties);
    setSavedParties((current) => current.filter((saved) => !parties.some((party) => (
      party.id === saved.id && Date.parse(party.updatedAt) >= Date.parse(saved.updatedAt)
    ))));
  }

  async function synchronize(partyId: string) {
    const response = await fetch(`/api/agent/cases/${caseId}/parties`, { cache: "no-store", signal: abort.current?.signal });
    const result = await response.json();
    if (!active.current) return;
    const rows: unknown = result?.parties;
    if (!response.ok || !Array.isArray(rows) || !rows.every(isCasePartyItem) || (partyId && !rows.some((party) => party.id === partyId))) {
      throw new Error("Участник сохранён, но список недоступен. Повторите синхронизацию.");
    }
    const saved = rows.filter((party) => party.id === partyId);
    setSavedParties((current) => [...current.filter((party) => !saved.some((row) => row.id === party.id)), ...saved]);
    setPendingSync(null);
    router.refresh();
  }

  async function retrySynchronization() {
    if (submitting.current || !pendingSync) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await synchronize(pendingSync.partyId);
    } catch {
      setError("Участник сохранён, но список недоступен. Повторите синхронизацию.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || pendingSync || pendingUpdate.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const roles = newPartyRoles;
    const commandId = pendingCreate.current?.key ?? crypto.randomUUID();
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/cases/${caseId}/parties`, {
        method: "POST",
        signal: abort.current?.signal,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `case-party:${commandId}`,
          "X-Correlation-Id": commandId,
        },
        body: (pendingCreate.current ??= { key: commandId, body: JSON.stringify({
          name: form.get("name"),
          phone: String(form.get("phone") ?? "").trim() || null,
          email: String(form.get("email") ?? "").trim() || null,
          roles,
          preferredChannel: form.get("preferredChannel"),
          consentStatus: form.get("consentStatus"),
          consentSource: String(form.get("consentSource") ?? "").trim() || null,
          consentAt: form.get("consentStatus") === "GRANTED" ? zonedLocalToIso(String(form.get("consentAt") ?? ""), timezone) : null,
          visibilityPolicy: "CASE_TEAM",
        }) }).body,
      });
      const result = await response.json().catch(() => null) as { error?: string; partyId?: string } | null;
      if (!active.current) return;
      if (!response.ok) {
        if (response.status >= 500) setPendingAcknowledgement(true);
        else { pendingCreate.current = null; setPendingAcknowledgement(false); }
        throw new Error(result?.error || "Участник не сохранён");
      }
      if (typeof result?.partyId !== "string" || !result.partyId.trim()) {
        setPendingAcknowledgement(true);
        throw new Error("Сохранение не подтверждено. Повторите сохранение: будет отправлена та же команда.");
      }
      formElement.reset();
      pendingCreate.current = null;
      setPendingAcknowledgement(false);
      setNewPartyRoles([]);
      setOpen(false);
      const sync = { partyId: result.partyId };
      setPendingSync(sync);
      try { await synchronize(sync.partyId); } catch {
        setError("Участник сохранён, но список недоступен. Повторите синхронизацию.");
      }
    } catch (cause) {
      if (pendingCreate.current) setPendingAcknowledgement(true);
      setError(cause instanceof Error ? cause.message : "Участник не сохранён");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function submitUpdate(event: React.FormEvent<HTMLFormElement>, party: CasePartyItem) {
    event.preventDefault();
    if (submitting.current || pendingSync || pendingCreate.current) return;
    const form = new FormData(event.currentTarget);
    const consentStatus = String(form.get("consentStatus"));
    const commandId = pendingUpdate.current?.key ?? crypto.randomUUID();
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/cases/${caseId}/parties/${party.id}`, {
        method: "PATCH",
        signal: abort.current?.signal,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `case-party-update:${commandId}`,
          "X-Correlation-Id": commandId,
        },
        body: (pendingUpdate.current ??= { key: commandId, body: JSON.stringify({
          name: form.get("name"),
          phone: String(form.get("phone") ?? "").trim() || null,
          email: String(form.get("email") ?? "").trim() || null,
          roles: form.getAll("roles").map(String),
          preferredChannel: form.get("preferredChannel"),
          consentStatus,
          consentSource: String(form.get("consentSource") ?? "").trim() || null,
          consentAt: consentStatus === "GRANTED" ? zonedLocalToIso(String(form.get("consentAt") ?? ""), timezone) : null,
          visibilityPolicy: party.visibilityPolicy,
        }) }).body,
      });
      const result = await response.json().catch(() => null) as { error?: string; partyId?: string } | null;
      if (!active.current) return;
      if (!response.ok) {
        if (response.status >= 500) setPendingAcknowledgement(true);
        else { pendingUpdate.current = null; setPendingAcknowledgement(false); }
        throw new Error(result?.error || "Изменения не сохранены");
      }
      if (result?.partyId !== party.id) {
        setPendingAcknowledgement(true);
        throw new Error("Сохранение не подтверждено. Повторите сохранение: будет отправлена та же команда.");
      }
      pendingUpdate.current = null;
      setPendingAcknowledgement(false);
      setEditingId(null);
      setPendingSync({ partyId: party.id });
      try { await synchronize(party.id); } catch {
        setError("Участник сохранён, но список недоступен. Повторите синхронизацию.");
      }
    } catch (cause) {
      if (pendingUpdate.current) setPendingAcknowledgement(true);
      setError(cause instanceof Error ? cause.message : "Изменения не сохранены");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <p className="text-[12px] leading-relaxed text-ink-3">Участников: {visibleParties.length}</p>
        {canMutate && (
          <Button type="button" size="sm" variant="secondary" disabled={busy || !!pendingSync || pendingAcknowledgement} onClick={() => setOpen((value) => !value)}>
            <UserPlus size={15} weight="bold" /> {open ? "Закрыть форму" : "Добавить участника"}
          </Button>
        )}
      </div>

      {error && <p role="alert" className="bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">{error}</p>}
      {pendingSync && <Button type="button" size="sm" variant="secondary" loading={busy} onClick={retrySynchronization}>Повторить синхронизацию</Button>}
      {open && (
        <form onSubmit={submit} onChange={() => { if (!pendingAcknowledgement) pendingCreate.current = null; }} className="grid gap-4 bg-surface-2 p-4" aria-label="Добавить участника кейса">
          <fieldset disabled={busy || pendingAcknowledgement} className="grid gap-4">
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
                  <input
                    type="checkbox"
                    name="roles"
                    value={value}
                    checked={newPartyRoles.includes(value)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setNewPartyRoles((current) => (
                        checked
                          ? [...new Set([...current, value])]
                          : current.filter((role) => role !== value)
                      ));
                    }}
                    className="h-4 w-4"
                  /> {label}
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
            <label>
              <span className="td-field-label">Когда получено согласие ({timezone})</span>
              <input className="td-field" name="consentAt" type="datetime-local" max={zonedLocalInput(new Date().toISOString(), timezone)} />
            </label>
          </div>
          </fieldset>
          <div><Button type="submit" size="sm" loading={busy} disabled={!!pendingUpdate.current}>Сохранить участника</Button></div>
        </form>
      )}

      {visibleParties.length === 0 ? (
        !pendingSync && <p className="py-6 text-center text-[13px] text-ink-3">Участники и их роли ещё не зафиксированы.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Участники кейса">
          {visibleParties.map((party) => (
            <li key={party.id} className="py-3 first:pt-0 last:pb-0">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(220px,auto)_auto] sm:items-start">
                <div className="min-w-0">
                  <strong className="block break-words text-[14px] text-ink">{party.name}</strong>
                  <p className="mt-1 break-words text-[12px] text-ink-3">{[party.phone, party.email].filter(Boolean).join(" · ") || "Контакт не указан"}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-[12px] font-medium text-ink-2">{party.roles.map((role) => ROLE_OPTIONS.find(([value]) => value === role)?.[1] ?? role).join(", ")}</p>
                  <p className="mt-1 text-[11px] text-ink-3">Согласие: {CONSENT_LABELS[party.consentStatus] ?? party.consentStatus}</p>
                </div>
                {canMutate && (
                  <button type="button" disabled={busy || !!pendingSync || pendingAcknowledgement} className={buttonClasses({ variant: "secondary", size: "sm", className: "h-11 w-11 p-0" })} onClick={() => setEditingId(editingId === party.id ? null : party.id)} aria-label={`Изменить ${party.name}`}>
                    <PencilSimple size={15} />
                  </button>
                )}
              </div>
              {editingId === party.id && <PartyEditForm party={party} timezone={timezone} busy={busy} locked={pendingAcknowledgement} onCancel={() => setEditingId(null)} onSubmit={(event) => submitUpdate(event, party)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PartyEditForm({ party, timezone, busy, locked, onCancel, onSubmit }: { party: CasePartyItem; timezone: string; busy: boolean; locked: boolean; onCancel: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-4 bg-surface-2 p-4" aria-label={`Изменить участника ${party.name}`}>
      <fieldset disabled={busy || locked} className="grid gap-4">
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
        <label><span className="td-field-label">Когда получено согласие ({timezone})</span><input className="td-field" name="consentAt" type="datetime-local" defaultValue={party.consentAt ? zonedLocalInput(party.consentAt, timezone) : ""} max={zonedLocalInput(new Date().toISOString(), timezone)} /></label>
      </div>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy || locked} className={buttonClasses({ variant: "ghost", size: "sm" })} onClick={onCancel}>Отмена</button><Button type="submit" size="sm" loading={busy}>Сохранить</Button></div>
    </form>
  );
}
