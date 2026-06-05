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
      if (!res.ok) { setError(data.error ?? "Ошибка создания дела"); return; }
      router.push(`/agent/cases/${data.id}`);
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
        <Field id="lead-name" label="Имя клиента">
          <input id="lead-name" type="text" className={inputCls} placeholder="Иванов Иван Иванович" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
        </Field>

        <Field id="lead-phone" label="Телефон">
          <input id="lead-phone" type="tel" className={inputCls} placeholder="+7 900 000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
        </Field>

        <Field id="lead-source" label="Источник">
          <select id="lead-source" className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="agent">От агента</option>
            <option value="telegram">Telegram</option>
            <option value="form">Форма на сайте</option>
            <option value="referral">Рекомендация</option>
          </select>
        </Field>

        <Field id="lead-context" label="Контекст" hint="ПДн — храните только необходимый минимум">
          <textarea id="lead-context" className={`${inputCls} min-h-[88px] resize-y`} placeholder="Краткие сведения: ситуация, пожелания, бюджет" value={context} onChange={(e) => setContext(e.target.value)} />
        </Field>

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-[13px] text-danger">
            <Warning size={14} /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !name || !phone}
          className="flex min-h-14 w-full items-center justify-center rounded-full bg-accent py-3 text-[14.5px] font-semibold text-on-accent shadow-[0_18px_34px_-22px_rgba(32,79,67,0.9)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-hover disabled:cursor-default disabled:opacity-45"
        >
          {loading ? "Создаю…" : "Создать дело"}
        </button>
      </div>
    </form>
  );
}

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
