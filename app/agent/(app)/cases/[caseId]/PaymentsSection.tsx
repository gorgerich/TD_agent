"use client";

import { useState, useTransition } from "react";
import { CurrencyRub, Plus, Trash, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { dateTime, moneyFromKopecks } from "@/lib/format";

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

export function PaymentsSection({ caseId, initial }: { caseId: number; initial: PaymentItem[] }) {
  const [items, setItems] = useState<PaymentItem[]>(initial);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<string>(KINDS[0]);
  const [method, setMethod] = useState<string>(METHODS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const total = items.reduce((sum, item) => sum + item.amountKopecks, 0);

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
      try {
        const res = await fetch(`/api/agent/cases/${caseId}/payments?id=${id}`, { method: "DELETE" });
        if (!res.ok) {
          setErr("Не удалось удалить оплату. Попробуйте снова.");
          return;
        }
        setItems((prev) => prev.filter((item) => item.id !== id));
      } catch {
        setErr("Нет связи. Оплата не удалена.");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="td-money-summary">
        <span>
          <span className="td-money-summary-label">Получено по кейсу</span>
          <span className="mt-1 block text-[12px] text-ink-3">{items.length > 0 ? `${items.length} ${items.length === 1 ? "запись" : "записи"}` : "Платежей пока нет"}</span>
        </span>
        <span className="td-money-summary-value tnum">{moneyFromKopecks(total)}</span>
      </div>

      {items.length > 0 && (
        <ul className="td-work-list" aria-label="История оплат">
          {items.map((payment) => (
            <li key={payment.id} className="td-work-row">
              <div className="flex min-w-0 items-center gap-3 px-1 py-2.5 sm:px-2">
                <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-gold-soft text-gold shadow-[var(--shadow-xs)]">
                  <CurrencyRub size={19} weight="bold" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="tnum block text-[14px] font-semibold text-ink">{moneyFromKopecks(payment.amountKopecks)}</span>
                  <span className="mt-1 block text-[12px] text-ink-3">{payment.kind} - {payment.method} - {dateTime(payment.paidAt)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => remove(payment.id)}
                  className="td-icon-button h-10 w-10 flex-shrink-0 hover:bg-danger-soft hover:text-danger"
                  aria-label={`Удалить оплату ${moneyFromKopecks(payment.amountKopecks)}`}
                >
                  <Trash size={16} weight="bold" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 && (
        <p className="text-[12px] leading-relaxed text-ink-3">Зафиксируйте аванс сразу после договорённости с семьёй. Это не заменяет платёжный документ.</p>
      )}

      <form onSubmit={add} className="td-form-surface grid gap-4" aria-label="Записать оплату">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[13px] bg-surface text-accent shadow-[var(--shadow-xs)]">
            <Plus size={18} weight="bold" />
          </span>
          <span>
            <span className="block text-[13px] font-semibold text-ink">Новая оплата</span>
            <span className="mt-0.5 block text-[12px] text-ink-3">Запись остаётся в истории кейса.</span>
          </span>
        </div>
        <label className="block">
          <span className="td-field-label">Сумма</span>
          <input
            aria-label="Сумма оплаты"
            className="td-field tnum text-[16px] font-semibold"
            placeholder="0 ₽"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <div className="grid gap-3">
          <div>
            <span className="td-field-label">Тип оплаты</span>
            <div className="td-segmented">
              {KINDS.map((item) => (
                <button key={item} type="button" className="td-segment min-h-10 flex-1 capitalize" data-active={kind === item ? "true" : undefined} onClick={() => setKind(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="td-field-label">Способ</span>
            <div className="td-segmented">
              {METHODS.map((item) => (
                <button key={item} type="button" className="td-segment min-h-10 flex-1 capitalize" data-active={method === item ? "true" : undefined} onClick={() => setMethod(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" size="sm" loading={busy} disabled={!amount}>Записать оплату</Button>
          {err && <span role="alert" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-danger"><Warning size={15} weight="fill" /> {err}</span>}
        </div>
      </form>
    </div>
  );
}

export default PaymentsSection;
