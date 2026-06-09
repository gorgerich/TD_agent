"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";

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
      if (!res.ok) { setError(data.error ?? "Ошибка создания кейса"); return; }
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

        <Field id="lead-context" label="Контекст" hint="ПДн - храните только необходимый минимум">
          <textarea id="lead-context" className={`${inputCls} min-h-[88px] resize-y`} placeholder="Краткие сведения: ситуация, пожелания, бюджет" value={context} onChange={(e) => setContext(e.target.value)} />
        </Field>

        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-[13px] text-danger">
            <Warning size={14} /> {error}
          </p>
        )}

        <Button type="submit" size="lg" loading={loading} disabled={!name || !phone} className="w-full">
          Создать кейс
        </Button>
      </div>
    </form>
  );
}

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
