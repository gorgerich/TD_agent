"use client";

import { useState, useTransition } from "react";
import { Trash, Warning } from "@phosphor-icons/react";

export type PaymentItem = {
  id: number;
  amountKopecks: number;
  kind: string;
  method: string;
  note: string | null;
  paidAt: string;
};

const KINDS = ["аванс", "остаток", "полная"] as const;
const METHODS = ["наличные", "карта", "счёт"] as const;

const inputCls =
  "min-h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[13px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3 focus:border-accent";

function fmtRub(kopecks: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(kopecks / 100);
}
function fmtDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function PaymentsSection({ caseId, initial }: { caseId: number; initial: PaymentItem[] }) {
  const [items, setItems] = useState<PaymentItem[]>(initial);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<string>(KINDS[0]);
  const [method, setMethod] = useState<string>(METHODS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const total = items.reduce((s, p) => s + p.amountKopecks, 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const rub = Number(amount.replace(/\D/g, ""));
    if (!rub) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/agent/cases/${caseId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountRub: rub, kind, method }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error ?? "Не удалось сохранить оплату. Попробуйте снова.");
        return;
      }
      setItems((prev) => [{ ...data.payment, paidAt: new Date(data.payment.paidAt).toISOString() }, ...prev]);
      setAmount("");
    } catch {
      setErr("Нет связи. Проверьте интернет и попробуйте снова.");
    } finally {
      setBusy(false);
    }
  }

  function remove(id: number) {
    startTransition(async () => {
      const res = await fetch(`/api/agent/cases/${caseId}/payments?id=${id}`, { method: "DELETE" });
      if (res.ok) setItems((prev) => prev.filter((p) => p.id !== id));
    });
  }

  return (
    <div>
      {items.length > 0 && (
        <p className="mb-3 text-[13px] text-ink-2">
          Получено: <span className="tnum font-semibold text-ink">{fmtRub(total)}</span>
        </p>
      )}

      {items.length === 0 ? (
        <p className="mb-3 text-[13px] text-ink-3">Оплат пока нет. Зафиксируйте аванс после договорённости с семьёй.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {items.map((p) => (
            <li key={p.id} className="group flex items-center gap-3 rounded-[12px] border border-line bg-surface-2 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="tnum block text-[13px] font-semibold text-ink">{fmtRub(p.amountKopecks)}</span>
                <span className="block text-[11px] text-ink-3">{p.kind} · {p.method} · {fmtDate(p.paidAt)}</span>
              </span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-[10px] text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                aria-label="Удалить оплату"
              >
                <Trash size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputCls} w-[130px] flex-none`}
          placeholder="Сумма, ₽"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${inputCls} w-auto flex-none`}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${inputCls} w-auto flex-none`}>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button
          type="submit"
          disabled={busy || !amount}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-55"
        >
          {busy ? "Сохраняю…" : "Записать"}
        </button>
      </form>
      {err && <p role="alert" className="mt-2 flex items-center gap-1 text-[12px] text-danger"><Warning size={14} /> {err}</p>}
    </div>
  );
}

export default PaymentsSection;
