"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Warning } from "@phosphor-icons/react";

const inputCls =
  "min-h-12 w-full rounded-[16px] border border-line bg-surface px-3.5 py-2.5 text-[14.5px] text-ink outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.76)] transition-colors placeholder:text-ink-3 focus:border-accent";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[11.5px] text-ink-3">{hint}</p>}
    </div>
  );
}

function FormInner() {
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
      if (!res.ok) { setError(data.error ?? "Ошибка создания встречи"); return; }
      router.push(`/agent/meetings/${data.id}`);
      router.refresh();
    } catch {
      setError("Сеть недоступна");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-[620px] td-shell" aria-busy={loading}>
      <div className="td-core space-y-5 p-5 sm:p-7">
        <Field id="meeting-lead-id" label="ID клиента" hint="Откройте раздел «Клиенты», чтобы найти номер клиента">
          <input id="meeting-lead-id" type="number" className={inputCls} placeholder="Например: 1" value={leadId} onChange={(e) => setLeadId(e.target.value)} required min="1" />
        </Field>

        <Field id="meeting-scheduled-at" label="Дата и время встречи">
          <input id="meeting-scheduled-at" type="datetime-local" className={inputCls} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-[13px] text-danger">
            <Warning size={14} /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !leadId}
          className="flex min-h-14 w-full items-center justify-center rounded-full bg-accent py-3 text-[14.5px] font-semibold text-on-accent shadow-[0_18px_34px_-22px_rgba(32,79,67,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
        >
          {loading ? "Создаю…" : "Создать встречу"}
        </button>
      </div>
    </form>
  );
}

export default function NewMeetingForm() {
  return (
    <Suspense>
      <FormInner />
    </Suspense>
  );
}
