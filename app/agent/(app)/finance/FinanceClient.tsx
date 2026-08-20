"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, CurrencyCircleDollar, FileCsv, ListMagnifyingGlass, X } from "@phosphor-icons/react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { moneyFromKopecks } from "@/lib/format";

type LedgerEntry = {
  id: string;
  type: string;
  direction: "DEBIT" | "CREDIT";
  amountKopecks: number;
  currency: string;
  occurredAt: string;
  method: string | null;
  source: string;
  evidenceReference: string;
  relatedEntryId: string | null;
  remainingRefundableKopecks: number | null;
  approvalRequired: boolean;
  approval: { decision: string | null } | null;
};

type Obligation = {
  id: string;
  caseId: string;
  amountKopecks: number;
  currency: string;
  payerPartyId: string | null;
  createdAt: string;
  case: { publicRef: string; stage: string };
  contractVersion: { id: string; versionNumber: number; status: string; signedAt: string | null };
  ledgerEntries: LedgerEntry[];
  summary: {
    state: "KNOWN" | "LEGACY_INCOMPLETE";
    status: string | null;
    paidKopecks: number | null;
    refundedKopecks: number | null;
    balanceKopecks: number | null;
  };
};

type PendingApproval = {
  id: string;
  ledgerEntryId: string;
  policyVersion: number;
  requestReason: string;
  createdAt: string;
  requestedByMembershipId: string;
  ledgerEntry: {
    type: string;
    direction: string;
    amountKopecks: number;
    currency: string;
    caseId: string;
    evidenceReference: string;
  };
};

type FinanceAction =
  | { kind: "PAYMENT"; obligation: Obligation }
  | { kind: "REFUND"; obligation: Obligation; entry: LedgerEntry; remainingKopecks: number }
  | { kind: "ADJUSTMENT"; obligation: Obligation; entry: LedgerEntry };

type ApprovalAction = { item: PendingApproval; decision: "APPROVED" | "REJECTED" };

type CommandEnvelope = {
  idempotencyKey: string;
  correlationId: string;
  occurredAt: string;
};

type FinanceActionState = { action: FinanceAction; command: CommandEnvelope };
type ApprovalActionState = { action: ApprovalAction; command: CommandEnvelope };

const STATUS_LABELS: Record<string, string> = {
  UNPAID: "Не оплачено",
  PARTIALLY_PAID: "Частично оплачено",
  PAID: "Оплачено",
  OVERPAID: "Переплата",
  PARTIALLY_REFUNDED: "Частично возвращено",
  REFUNDED: "Возвращено",
  LEGACY_INCOMPLETE: "Недостаточно данных",
};

const ENTRY_LABELS: Record<string, string> = {
  OBLIGATION: "Обязательство",
  PAYMENT: "Оплата",
  REFUND: "Возврат",
  CORRECTION: "Коррекция",
  REVERSAL: "Сторно",
};

export function FinanceClient({
  membershipId,
  timezone,
  initial,
}: {
  membershipId: string;
  timezone: string;
  initial: { obligations: Obligation[]; pendingApprovals: PendingApproval[] };
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("ALL");
  const [actionState, setActionState] = useState<FinanceActionState | null>(null);
  const [ledger, setLedger] = useState<Obligation | null>(null);
  const [approvalState, setApprovalState] = useState<ApprovalActionState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(
    () => filter === "ALL" ? initial.obligations : initial.obligations.filter((item) => item.summary.status === filter),
    [filter, initial.obligations],
  );

  async function post(path: string, body: unknown, command: CommandEnvelope) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": command.idempotencyKey,
        "X-Correlation-Id": command.correlationId,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error || "Финансовая команда не выполнена");
  }

  async function submitAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actionState) return;
    const { action, command } = actionState;
    const form = new FormData(event.currentTarget);
    const rubles = Number(String(form.get("amount") ?? "").replace(/[^0-9]/g, ""));
    if (!Number.isSafeInteger(rubles) || rubles <= 0) {
      setError("Укажите положительную целую сумму в рублях");
      return;
    }
    setBusyId(action.kind === "PAYMENT" ? action.obligation.id : action.entry.id);
    setError(null);
    try {
      if (action.kind === "PAYMENT") {
        if (!action.obligation.payerPartyId) throw new Error("В обязательстве не определён плательщик");
        await post(`/api/agent/cases/${action.obligation.caseId}/payments`, {
          obligationId: action.obligation.id,
          payerPartyId: action.obligation.payerPartyId,
          amountKopecks: rubles * 100,
          currency: "RUB",
          occurredAt: command.occurredAt,
          method: form.get("method"),
          evidenceReference: form.get("evidenceReference"),
          reason: form.get("reason"),
        }, command);
      } else if (action.kind === "REFUND") {
        await post("/api/agent/finance/refunds", {
          paymentEntryId: action.entry.id,
          amountKopecks: rubles * 100,
          occurredAt: command.occurredAt,
          method: form.get("method"),
          evidenceReference: form.get("evidenceReference"),
          reason: form.get("reason"),
        }, command);
      } else {
        await post("/api/agent/finance/adjustments", {
          type: form.get("type"),
          relatedEntryId: action.entry.id,
          direction: form.get("direction"),
          amountKopecks: rubles * 100,
          occurredAt: command.occurredAt,
          evidenceReference: form.get("evidenceReference"),
          reason: form.get("reason"),
        }, command);
      }
      setActionState(null);
      setLedger(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Финансовая команда не выполнена");
    } finally {
      setBusyId(null);
    }
  }

  async function decide(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!approvalState) return;
    const { action: approval, command } = approvalState;
    const form = new FormData(event.currentTarget);
    setBusyId(approval.item.ledgerEntryId);
    setError(null);
    try {
      await post(`/api/agent/finance/adjustments/${approval.item.ledgerEntryId}`, {
        decision: approval.decision,
        reason: form.get("reason"),
      }, command);
      setApprovalState(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Решение не сохранено");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="td-page mx-auto w-full max-w-[1240px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="td-display text-[30px] text-ink sm:text-[38px]">Финансы</h1>
          <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
            Обязательства и неизменяемый реестр операций. Семейные заметки, документы и внутренняя коммерческая маржа не загружаются.
          </p>
        </div>
        <a href="/api/agent/finance/export" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          <FileCsv size={15} weight="bold" /> Скачать сверку
        </a>
      </header>
      {error && <p role="alert" className="mb-4 bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">{error}</p>}

      {initial.pendingApprovals.length > 0 && (
        <section className="td-shell mb-6 overflow-hidden" aria-labelledby="approval-title">
          <div className="border-b border-line px-4 py-3 sm:px-5"><h2 id="approval-title" className="text-[15px] font-semibold text-ink">Независимое решение</h2></div>
          <ul className="divide-y divide-line">
            {initial.pendingApprovals.map((item) => {
              const ownRequest = item.requestedByMembershipId === membershipId;
              return (
                <li key={item.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                  <div>
                    <strong className="text-[14px] text-ink">{ENTRY_LABELS[item.ledgerEntry.type] ?? item.ledgerEntry.type} · {moneyFromKopecks(item.ledgerEntry.amountKopecks)}</strong>
                    <p className="mt-1 text-[12px] text-ink-3">Правило v{item.policyVersion} · {item.requestReason}</p>
                    {ownRequest && <p className="mt-1 text-[12px] font-medium text-warning">Решение должен принять другой сотрудник Finance.</p>}
                  </div>
                  {!ownRequest && (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={() => openApproval({ item, decision: "APPROVED" })}><Check size={14} weight="bold" /> Одобрить</Button>
                      <button type="button" className={buttonClasses({ variant: "secondary", size: "sm" })} onClick={() => openApproval({ item, decision: "REJECTED" })}><X size={14} weight="bold" /> Отклонить</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Фильтр обязательств">
        {[["ALL", "Все"], ["UNPAID", "Не оплачены"], ["PARTIALLY_PAID", "Частично"], ["PAID", "Оплачены"], ["REFUNDED", "Возвраты"]].map(([value, label]) => (
          <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={buttonClasses({ variant: filter === value ? "primary" : "secondary", size: "sm" })}>{label}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="td-shell py-14 text-center"><CurrencyCircleDollar size={30} className="mx-auto text-ink-3" /><p className="mt-3 font-medium text-ink">Обязательств по фильтру нет</p></div>
      ) : (
        <>
          <div className="td-shell hidden overflow-hidden md:block">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-surface-2 text-[11px] font-medium text-ink-3">
                <tr><th className="px-4 py-3">Кейс</th><th className="px-4 py-3">Договор</th><th className="px-4 py-3">Обязательство</th><th className="px-4 py-3">Получено</th><th className="px-4 py-3">Остаток</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3"><span className="sr-only">Действия</span></th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((item) => <FinanceRow key={item.id} item={item} onPayment={() => openAction({ kind: "PAYMENT", obligation: item })} onLedger={() => setLedger(item)} />)}
              </tbody>
            </table>
          </div>
          <ul className="td-shell divide-y divide-line md:hidden" aria-label="Финансовые обязательства">
            {rows.map((item) => (
              <li key={item.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div><strong className="text-[14px] text-ink">{item.case.publicRef}</strong><p className="mt-1 text-[12px] text-ink-3">Договор v{item.contractVersion.versionNumber}</p></div>
                  <span className="text-right text-[12px] font-semibold text-ink-2">{statusLabel(item.summary.status)}</span>
                </div>
                <dl className="mt-3 grid gap-2 text-[12px]">
                  <MobileValue label="Обязательство" value={moneyFromKopecks(item.amountKopecks)} />
                  <MobileValue label="Получено" value={formatMaybeMoney(item.summary.paidKopecks)} />
                  <MobileValue label="Остаток" value={formatMaybeMoney(item.summary.balanceKopecks)} emphasize />
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => openAction({ kind: "PAYMENT", obligation: item })} disabled={!item.payerPartyId}>Записать оплату</Button>
                  <button type="button" className={buttonClasses({ variant: "secondary", size: "sm" })} onClick={() => setLedger(item)}><ListMagnifyingGlass size={15} /> Реестр</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {ledger && <LedgerDialog obligation={ledger} timezone={timezone} onClose={() => setLedger(null)} onAction={(nextAction) => { setLedger(null); openAction(nextAction); }} />}
      {actionState && <FinanceActionDialog action={actionState.action} busy={busyId != null} onClose={() => setActionState(null)} onSubmit={submitAction} />}
      {approvalState && <ApprovalDialog action={approvalState.action} busy={busyId != null} onClose={() => setApprovalState(null)} onSubmit={decide} />}
    </div>
  );

  function openAction(action: FinanceAction) {
    setActionState({ action, command: createCommandEnvelope("finance") });
  }

  function openApproval(action: ApprovalAction) {
    setApprovalState({ action, command: createCommandEnvelope("finance-approval") });
  }
}

function FinanceRow({ item, onPayment, onLedger }: { item: Obligation; onPayment: () => void; onLedger: () => void }) {
  return (
    <tr>
      <td className="px-4 py-4 font-medium text-ink">{item.case.publicRef}</td>
      <td className="px-4 py-4 text-ink-2">v{item.contractVersion.versionNumber}</td>
      <td className="tnum px-4 py-4 text-ink">{moneyFromKopecks(item.amountKopecks)}</td>
      <td className="tnum px-4 py-4 text-ink-2">{formatMaybeMoney(item.summary.paidKopecks)}</td>
      <td className="tnum px-4 py-4 font-medium text-ink">{formatMaybeMoney(item.summary.balanceKopecks)}</td>
      <td className="px-4 py-4 text-ink-2">{statusLabel(item.summary.status)}</td>
      <td className="px-4 py-4"><div className="flex justify-end gap-2"><Button type="button" size="sm" variant="secondary" onClick={onPayment} disabled={!item.payerPartyId}>Оплата</Button><button type="button" className={buttonClasses({ variant: "secondary", size: "sm" })} onClick={onLedger}><ListMagnifyingGlass size={15} /><span className="sr-only">Открыть ledger</span></button></div></td>
    </tr>
  );
}

function LedgerDialog({ obligation, timezone, onClose, onAction }: { obligation: Obligation; timezone: string; onClose: () => void; onAction: (action: FinanceAction) => void }) {
  return (
    <Dialog title={`Реестр · ${obligation.case.publicRef}`} onClose={onClose}>
      <ul className="max-h-[58vh] divide-y divide-line overflow-y-auto" aria-label="Финансовые операции">
        {obligation.ledgerEntries.map((entry) => {
          const remaining = entry.remainingRefundableKopecks ?? 0;
          return (
            <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <strong className="text-[13px] text-ink">{ENTRY_LABELS[entry.type] ?? entry.type} · {moneyFromKopecks(entry.amountKopecks)}</strong>
                  <p className="mt-1 text-[11px] text-ink-3">{entry.direction === "CREDIT" ? "Зачисление" : "Начисление"} · {new Intl.DateTimeFormat("ru-RU", { timeZone: timezone }).format(new Date(entry.occurredAt))}</p>
                  {entry.approvalRequired && <p className="mt-1 text-[11px] font-medium text-warning">Решение: {entry.approval?.decision ?? "ожидается"}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {entry.type === "PAYMENT" && remaining > 0 && <button type="button" className={buttonClasses({ variant: "secondary", size: "sm" })} onClick={() => onAction({ kind: "REFUND", obligation, entry, remainingKopecks: remaining })}>Возврат</button>}
                  <button type="button" className={buttonClasses({ variant: "secondary", size: "sm" })} onClick={() => onAction({ kind: "ADJUSTMENT", obligation, entry })}>Коррекция</button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function FinanceActionDialog({ action, busy, onClose, onSubmit }: { action: FinanceAction; busy: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const title = action.kind === "PAYMENT" ? "Записать подтверждённую оплату" : action.kind === "REFUND" ? "Записать возврат" : "Запросить коррекцию или сторно";
  const defaultDirection = action.kind === "ADJUSTMENT" && action.entry.direction === "DEBIT" ? "CREDIT" : "DEBIT";
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <p className="text-[12px] text-ink-3">
          {action.obligation.case.publicRef}
          {action.kind === "REFUND" ? ` · доступно к возврату ${moneyFromKopecks(action.remainingKopecks)}` : ""}
        </p>
        <div className="mt-4 grid gap-3">
          {action.kind === "ADJUSTMENT" && (
            <>
              <label><span className="td-field-label">Операция</span><select name="type" className="td-field" defaultValue="CORRECTION"><option value="CORRECTION">Коррекция</option><option value="REVERSAL">Сторно исходной записи</option></select></label>
              <label><span className="td-field-label">Направление</span><select name="direction" className="td-field" defaultValue={defaultDirection}><option value="DEBIT">Начисление</option><option value="CREDIT">Зачисление</option></select></label>
            </>
          )}
          <label><span className="td-field-label">Сумма, ₽</span><input name="amount" className="td-field tnum" inputMode="numeric" required /></label>
          {action.kind !== "ADJUSTMENT" && <label><span className="td-field-label">Способ</span><select name="method" className="td-field" defaultValue="BANK_TRANSFER"><option value="BANK_TRANSFER">Банковский перевод</option><option value="SBP_QR">СБП</option><option value="CARD">Карта</option><option value="CASH">Наличные</option></select></label>}
          <label><span className="td-field-label">Подтверждение</span><input name="evidenceReference" className="td-field" minLength={3} maxLength={240} required /></label>
          <label><span className="td-field-label">Причина</span><textarea name="reason" className="td-field min-h-20 resize-y" minLength={3} maxLength={500} required /></label>
        </div>
        {action.kind === "ADJUSTMENT" && <p className="mt-3 text-[11px] leading-relaxed text-ink-3">Чувствительная операция останется в ожидании независимого решения согласно утверждённому финансовому правилу. Исходная запись не изменяется.</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" className={buttonClasses({ variant: "ghost", size: "sm" })} onClick={onClose}>Отмена</button><Button type="submit" size="sm" loading={busy}>{action.kind === "ADJUSTMENT" ? "Создать запрос" : "Добавить в реестр"}</Button></div>
      </form>
    </Dialog>
  );
}

function ApprovalDialog({ action, busy, onClose, onSubmit }: { action: ApprovalAction; busy: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <Dialog title={action.decision === "APPROVED" ? "Одобрить коррекцию" : "Отклонить коррекцию"} onClose={onClose}>
      <form onSubmit={onSubmit}>
        <p className="text-[12px] text-ink-3">Решение принимает не автор запроса; результат становится частью неизменяемого журнала.</p>
        <label className="mt-4 block"><span className="td-field-label">Основание решения</span><textarea name="reason" className="td-field min-h-24 resize-y" minLength={3} maxLength={500} required /></label>
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" className={buttonClasses({ variant: "ghost", size: "sm" })} onClick={onClose}>Отмена</button><Button type="submit" size="sm" loading={busy}>Сохранить решение</Button></div>
      </form>
    </Dialog>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const initial = panel?.querySelector<HTMLElement>("[data-dialog-initial-focus]")
      ?? panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    initial?.focus();
    return () => previousFocusRef.current?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      .filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} tabIndex={-1} onKeyDown={handleKeyDown} className="w-full max-w-[560px] bg-surface p-5 shadow-[var(--shadow-lg)]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="mb-4 flex items-start justify-between gap-4"><h2 id={titleId} className="text-[18px] font-semibold text-ink">{title}</h2><button data-dialog-initial-focus type="button" onClick={onClose} className="grid h-11 w-11 place-items-center text-ink-2 hover:text-ink" aria-label="Закрыть"><X size={18} /></button></div>
        {children}
      </section>
    </div>
  );
}

const FOCUSABLE_SELECTOR = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function createCommandEnvelope(scope: string): CommandEnvelope {
  const commandId = crypto.randomUUID();
  return {
    idempotencyKey: `${scope}:${commandId}`,
    correlationId: commandId,
    occurredAt: new Date().toISOString(),
  };
}

function MobileValue({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-3">{label}</dt><dd className={`tnum text-right ${emphasize ? "font-semibold text-ink" : "text-ink-2"}`}>{value}</dd></div>;
}

function formatMaybeMoney(value: number | null | undefined) {
  return value == null ? "Неизвестно" : moneyFromKopecks(value);
}

function statusLabel(value: string | null) {
  return STATUS_LABELS[value ?? "LEGACY_INCOMPLETE"] ?? value ?? STATUS_LABELS.LEGACY_INCOMPLETE;
}

export default FinanceClient;
