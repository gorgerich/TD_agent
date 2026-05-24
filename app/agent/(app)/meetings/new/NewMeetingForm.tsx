"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Warning } from "@phosphor-icons/react";

const inputCls = "w-full bg-white/[0.05] border border-white/[0.09] rounded-lg px-3.5 py-2.5 text-[14px] text-slate-200 placeholder-slate-600 outline-none focus:border-blue-500/60 focus:bg-white/[0.07] transition-all font-[inherit]";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold tracking-[0.07em] uppercase text-slate-500 mb-2">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-600 mt-1.5">{hint}</p>}
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
    <form onSubmit={handleSubmit} className="max-w-[520px]">
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-7 space-y-5">
        <Field label="ID лида" hint="Перейдите в раздел «Лиды», чтобы скопировать ID">
          <input
            type="number"
            className={inputCls}
            placeholder="Например: 1"
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            required
            min="1"
          />
        </Field>

        <Field label="Дата и время встречи">
          <input
            type="datetime-local"
            className={inputCls}
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </Field>

        {error && (
          <p className="flex items-center gap-1.5 text-[12px] text-red-400">
            <Warning size={13} /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !leadId}
          className="w-full flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:cursor-default text-white font-semibold text-[14px] py-2.5 rounded-lg transition-colors"
        >
          {loading ? "Создаю..." : "Создать встречу"}
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
