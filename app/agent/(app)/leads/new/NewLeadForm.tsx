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
    <form onSubmit={handleSubmit} className="max-w-[520px]">
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-7 space-y-5">
        <Field label="Имя клиента">
          <input
            type="text"
            className={inputCls}
            placeholder="Иванов Иван Иванович"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </Field>

        <Field label="Телефон">
          <input
            type="tel"
            className={inputCls}
            placeholder="+7 900 000 00 00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
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
          <textarea
            className={`${inputCls} resize-none min-h-[80px]`}
            placeholder="Краткие сведения: ситуация, пожелания, бюджет"
            value={context}
            onChange={(e) => setContext(e.target.value)}
          />
        </Field>

        {error && (
          <p className="flex items-center gap-1.5 text-[12px] text-red-400">
            <Warning size={13} /> {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !name || !phone}
          className="w-full flex items-center justify-center bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 disabled:cursor-default text-white font-semibold text-[14px] py-2.5 rounded-lg transition-colors"
        >
          {loading ? "Создаю..." : "Создать лид"}
        </button>
      </div>
    </form>
  );
}

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
