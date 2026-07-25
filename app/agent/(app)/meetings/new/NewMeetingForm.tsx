"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react";
import { phone as fmtPhone } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { clearCommandId, commandIdFor, type ClientCommandIdentity } from "@/lib/clientCommandId";
import { zonedLocalToIso } from "@/lib/zonedDateTime";

type ClientOption = { id: number; name: string; phone: string };
type OwnerOption = { membershipId: string; name: string };

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="td-field-label">{label}</label>
      {children}
      {hint && <p className="td-field-help">{hint}</p>}
    </div>
  );
}

function FormInner({
  clients,
  owners,
  defaultOwnerMembershipId,
  timezone,
}: {
  clients: ClientOption[];
  owners: OwnerOption[];
  defaultOwnerMembershipId: string;
  timezone: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leadId, setLeadId] = useState(searchParams.get("leadId") ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [ownerMembershipId, setOwnerMembershipId] = useState(defaultOwnerMembershipId);
  const [type, setType] = useState("CONSULTATION");
  const [channel, setChannel] = useState("IN_PERSON");
  const [location, setLocation] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const command = useRef<ClientCommandIdentity | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const iso = scheduledAt ? zonedLocalToIso(scheduledAt, timezone) : null;
    if (scheduledAt && !iso) {
      setError("Проверьте дату и время.");
      setLoading(false);
      return;
    }
    try {
      const body = {
        leadId: Number(leadId),
        scheduledAt: iso,
        ownerMembershipId,
        type,
        channel,
        location: location.trim() || null,
        durationMinutes: Number(durationMinutes) || null,
      };
      const commandId = commandIdFor(command, JSON.stringify(body));
      const response = await fetch("/api/agent/meetings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": commandId,
          "X-Correlation-Id": commandId,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null) as { id?: number; error?: string } | null;
      if (!response.ok || !data?.id) {
        setError(response.status === 409 ? "Такая команда уже обработана. Обновите календарь." : data?.error ?? "Не удалось создать встречу.");
        return;
      }
      clearCommandId(command);
      router.push(`/agent/meetings/${data.id}`);
      router.refresh();
    } catch {
      setError("Нет связи. Встреча не создана, повторите после восстановления подключения.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-[720px] rounded-[var(--radius-card)] bg-surface px-5 py-5 shadow-[var(--shadow-xs),var(--hl-top)] sm:px-7 sm:py-6" aria-busy={loading}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id="meeting-lead-id" label="Клиент" hint="Встреча всегда привязана к каноническому кейсу">
            <select id="meeting-lead-id" className="td-field" value={leadId} onChange={(event) => setLeadId(event.target.value)} required>
              <option value="">Выберите клиента</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {fmtPhone(client.phone)}</option>)}
            </select>
          </Field>
        </div>

        <Field id="meeting-type" label="Тип встречи">
          <select id="meeting-type" className="td-field" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="CONSULTATION">Консультация</option>
            <option value="FOLLOW_UP">Повторная встреча</option>
            <option value="DOCUMENT_REVIEW">Проверка документов</option>
            <option value="CEREMONY_COORDINATION">Координация церемонии</option>
            <option value="OTHER">Другая</option>
          </select>
        </Field>
        <Field id="meeting-owner" label="Ответственный">
          <select id="meeting-owner" className="td-field" value={ownerMembershipId} onChange={(event) => setOwnerMembershipId(event.target.value)} required>
            {owners.map((owner) => <option key={owner.membershipId} value={owner.membershipId}>{owner.name}</option>)}
          </select>
        </Field>

        <Field id="meeting-scheduled-at" label="Дата и время" hint={`24-часовой формат · ${timezone}. Можно оставить пустым, если время ещё не согласовано.`}>
          <input id="meeting-scheduled-at" type="datetime-local" className="td-field" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
        </Field>
        <Field id="meeting-duration" label="Длительность, минут">
          <input id="meeting-duration" type="number" min={15} max={720} step={15} className="td-field" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
        </Field>

        <Field id="meeting-channel" label="Формат">
          <select id="meeting-channel" className="td-field" value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="IN_PERSON">Лично</option>
            <option value="PHONE">Телефон</option>
            <option value="VIDEO">Видео</option>
            <option value="OTHER">Другой</option>
          </select>
        </Field>
        <Field id="meeting-location" label="Место или ссылка">
          <input id="meeting-location" className="td-field" maxLength={300} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Офис, адрес или ссылка" />
        </Field>
      </div>

      {error && <p role="alert" className="mt-4 flex items-start gap-2 text-[13px] text-danger"><WarningCircle size={16} weight="fill" className="mt-0.5 flex-none" /> {error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" loading={loading} disabled={!leadId || !ownerMembershipId}>Создать встречу</Button>
        <p className="text-[12px] text-ink-3">Пустая дата создаст честный статус «Время не согласовано».</p>
      </div>
    </form>
  );
}

export default function NewMeetingForm(props: {
  clients: ClientOption[];
  owners: OwnerOption[];
  defaultOwnerMembershipId: string;
  timezone: string;
}) {
  return <Suspense><FormInner {...props} /></Suspense>;
}
