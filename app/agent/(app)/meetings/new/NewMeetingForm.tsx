"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Warning } from "@phosphor-icons/react";
import { phone as fmtPhone } from "@/lib/format";
import { Button } from "@/components/ui/Button";

type ClientOption = {
  id: number;
  name: string;
  phone: string;
};

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="td-field-label">{label}</label>
      {children}
      {hint && <p className="td-field-help">{hint}</p>}
    </div>
  );
}

function FormInner({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [leadId, setLeadId] = useState(searchParams.get("leadId") ?? "");
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: Number(leadId), scheduledAt: scheduledAt || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Не удалось создать встречу. Попробуйте снова."); return; }
      router.push(`/agent/meetings/${data.id}`);
      router.refresh();
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте снова.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-[620px] td-shell-elevated p-5 sm:p-7" aria-busy={loading}>
      <div className="mb-6 flex items-start gap-3 border-b border-line pb-5">
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-accent-soft text-[13px] font-bold text-accent shadow-[var(--shadow-xs)]">1</span>
        <span>
          <span className="block text-[15px] font-semibold text-ink">Детали встречи</span>
          <span className="mt-1 block text-[13px] leading-relaxed text-ink-3">Достаточно клиента и времени. Остальные детали заполняются уже в кейсе.</span>
        </span>
      </div>
      <div className="space-y-5">
        {clients.length > 0 ? (
          <Field id="meeting-lead-id" label="Клиент" hint="Выберите клиента из текущих дел агента">
            <select
              id="meeting-lead-id"
              className="td-field"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              required
            >
              <option value="">Выберите клиента</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} · {fmtPhone(client.phone)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field id="meeting-lead-id" label="Клиент" hint="Клиенты не загрузились. Можно временно указать номер дела вручную">
            <input id="meeting-lead-id" type="number" className="td-field" placeholder="Номер дела, например 1" value={leadId} onChange={(e) => setLeadId(e.target.value)} required min="1" />
          </Field>
        )}

        <Field id="meeting-scheduled-at" label="Дата и время встречи">
          <input id="meeting-scheduled-at" type="datetime-local" className="td-field" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-[13px] text-danger">
            <Warning size={14} /> {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" size="lg" loading={loading} disabled={!leadId}>Создать встречу</Button>
          <span className="text-[12px] text-ink-3">Время можно уточнить позже.</span>
        </div>
      </div>
    </form>
  );
}

export default function NewMeetingForm({ clients = [] }: { clients?: ClientOption[] }) {
  return (
    <Suspense>
      <FormInner clients={clients} />
    </Suspense>
  );
}
