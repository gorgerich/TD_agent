"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Warning } from "@phosphor-icons/react";

export default function NewLeadForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("agent");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, source, context }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Ошибка создания лида"); return; }
      router.push(`/agent/leads/${data.id}`);
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
        <Field label="Имя клиента">
          <input type="text" className={inputCls} placeholder="Иванов Иван Иванович" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>

        <Field label="Телефон">
          <input type="tel" className={inputCls} placeholder="+7 900 000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        </Field>

        <Field label="Источник">
          <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="agent">От агента</option>
            <option value="telegram">Telegram</option>
            <option value="form">Форма на сайте</option>
            <option value="referral">Рекомендация</option>
          </select>
        </Field>

        <Field label="Контекст" hint="ПДн — храните только необходимый минимум">
          <textarea className={`${inputCls} min-h-[88px] resize-none`} placeholder="Краткие сведения: ситуация, пожелания, бюджет" value={context} onChange={(e) => setContext(e.target.value)} />
        </Field>

        {error && (
          <p className="flex items-center gap-1.5 text-[13px] text-danger">
            <Warning size={14} /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !name || !phone}
          className="flex w-full items-center justify-center rounded-xl bg-accent py-3 text-[14.5px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
        >
          {loading ? "Создаю…" : "Создать лид"}
        </button>
      </div>
    </form>
  );
}

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
