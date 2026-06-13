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

const inputCls =
  "min-h-12 w-full rounded-[12px] border border-line bg-surface px-3.5 py-2.5 text-[14px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] focus:border-accent focus:shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_0_3px_rgba(0,58,53,0.14)]";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] text-ink-3">{hint}</p>}
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
    <form onSubmit={handleSubmit} className="max-w-[620px] td-shell" aria-busy={loading}>
      <div className="td-core space-y-5 p-5 sm:p-7">
        {clients.length > 0 ? (
          <Field id="meeting-lead-id" label="Клиент" hint="Выберите клиента из текущих дел агента">
            <select
              id="meeting-lead-id"
              className={inputCls}
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
            <input id="meeting-lead-id" type="number" className={inputCls} placeholder="Номер дела, например 1" value={leadId} onChange={(e) => setLeadId(e.target.value)} required min="1" />
          </Field>
        )}

        <Field id="meeting-scheduled-at" label="Дата и время встречи">
          <input id="meeting-scheduled-at" type="datetime-local" className={inputCls} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-[13px] text-danger">
            <Warning size={14} /> {error}
          </p>
        )}

        <Button type="submit" size="lg" loading={loading} disabled={!leadId} className="w-full">
          Создать встречу
        </Button>
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
