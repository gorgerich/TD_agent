"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Warning } from "@phosphor-icons/react";

const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14.5px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-accent";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</label>
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
    <form onSubmit={handleSubmit} className="max-w-[540px]">
      <div className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-soft sm:p-7">
        <Field label="ID лида" hint="Откройте раздел «Лиды», чтобы найти номер лида">
          <input type="number" className={inputCls} placeholder="Например: 1" value={leadId} onChange={(e) => setLeadId(e.target.value)} required min="1" />
        </Field>

        <Field label="Дата и время встречи">
          <input type="datetime-local" className={inputCls} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>

        {error && (
          <p className="flex items-center gap-1.5 text-[13px] text-danger">
            <Warning size={14} /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !leadId}
          className="flex w-full items-center justify-center rounded-xl bg-accent py-3 text-[14.5px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
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
