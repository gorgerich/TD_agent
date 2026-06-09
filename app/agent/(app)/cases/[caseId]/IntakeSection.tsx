"use client";

import { useState } from "react";
import { Check, Warning } from "@phosphor-icons/react";

export type Intake = {
  ceremonyType: string;
  budget: string;
  religion: string;
  needs: string;
};

const CEREMONY = ["кремация", "погребение"] as const;
const inputCls =
  "min-h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[13px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 focus:border-accent focus:shadow-[0_0_0_3px_rgba(0,58,53,0.12)]";

export function IntakeSection({ caseId, initial }: { caseId: number; initial: Intake }) {
  const [v, setV] = useState<Intake>(initial);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof Intake>(k: K, val: Intake[K]) {
    setV((prev) => ({ ...prev, [k]: val }));
    setOk(false);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const res = await fetch(`/api/agent/cases/${caseId}/intake`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(v),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? "Не удалось сохранить");
        return;
      }
      setOk(true);
    } catch {
      setErr("Сеть недоступна");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-ink-2">Тип церемонии</label>
        <div className="td-segmented rounded-[12px]">
          {CEREMONY.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set("ceremonyType", v.ceremonyType === c ? "" : c)}
              data-active={v.ceremonyType === c ? "true" : undefined}
              className="td-segment min-h-10 flex-1 capitalize"
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-2">Бюджет</label>
          <input className={inputCls} placeholder="например, 80-120 тыс ₽" value={v.budget} onChange={(e) => set("budget", e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-ink-2">Традиция / конфессия</label>
          <input className={inputCls} placeholder="например, православная" value={v.religion} onChange={(e) => set("religion", e.target.value)} />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[12px] font-medium text-ink-2">Особые пожелания</label>
        <textarea
          className={`${inputCls} min-h-[72px] resize-y py-2`}
          placeholder="Пожелания семьи, ограничения, важные детали"
          value={v.needs}
          onChange={(e) => set("needs", e.target.value)}
          maxLength={2000}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-on-accent shadow-[0_1px_2px_rgba(0,31,39,0.16)] transition-colors duration-150 hover:bg-accent-hover disabled:opacity-55"
        >
          {busy ? "Сохраняю…" : "Сохранить потребности"}
        </button>
        {ok && <span className="flex items-center gap-1 text-[12px] text-success"><Check size={14} weight="bold" /> Сохранено</span>}
        {err && <span className="flex items-center gap-1 text-[12px] text-danger"><Warning size={14} /> {err}</span>}
      </div>
    </div>
  );
}

export default IntakeSection;
