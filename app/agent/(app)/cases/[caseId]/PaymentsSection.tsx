"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FilePlus, SealCheck, WarningCircle } from "@phosphor-icons/react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { clearCommandId, commandIdFor, type ClientCommandIdentity } from "@/lib/clientCommandId";
import { moneyFromKopecks } from "@/lib/format";

export type ContractLedgerVersion = {
  id: string;
  versionNumber: number;
  status: string;
  totalObligationKopecks: number;
  currency: string;
  issuedAt: string | null;
  signedAt: string | null;
  validUntil: string | null;
  quoteVersionId: number;
  obligation: { id: string } | null;
  payment: {
    state: "KNOWN" | "LEGACY_INCOMPLETE";
    status: string | null;
    currency: string;
    obligationKopecks: number | null;
    paidKopecks: number | null;
    refundedKopecks: number | null;
    balanceKopecks: number | null;
  } | null;
};

export type ContractPayer = { id: string; name: string; roles: string[] };

const CONTRACT_STATUS: Record<string, string> = {
  DRAFT: "Черновик",
  ISSUED: "Выдан",
  SIGNED: "Подписан",
  CANCELLED: "Отменён",
  SUPERSEDED: "Заменён",
};

const PAYMENT_STATUS: Record<string, string> = {
  UNPAID: "Не оплачен",
  PARTIALLY_PAID: "Частично оплачен",
  PAID: "Оплачен",
  OVERPAID: "Переплата",
  PARTIALLY_REFUNDED: "Частичный возврат",
  REFUNDED: "Возвращён",
};

export function PaymentsSection({
  caseId,
  versions,
  legacyCount,
  parties,
  canMutate,
}: {
  caseId: number;
  versions: ContractLedgerVersion[];
  legacyCount: number;
  parties: ContractPayer[];
  canMutate: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"CREATE" | "SIGN" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const commandIdentity = useRef<ClientCommandIdentity | null>(null);
  const current = versions[0] ?? null;
  const summary = current?.payment ?? null;
  const payers = parties.filter((party) => party.roles.includes("PAYER"));

  async function command(body: unknown) {
    const serializedBody = JSON.stringify(body);
    const commandId = commandIdFor(commandIdentity, serializedBody);
    const response = await fetch(`/api/agent/cases/${caseId}/contract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": `contract:${commandId}`,
        "X-Correlation-Id": commandId,
      },
      body: serializedBody,
    });
    const result = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(result?.error || "Команда договора не выполнена");
    clearCommandId(commandIdentity);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      if (mode === "CREATE") {
        await command({
          action: "CREATE",
          payerPartyId: form.get("payerPartyId"),
          paymentTerms: { description: form.get("paymentTerms") },
          validUntil: form.get("validUntil") ? new Date(String(form.get("validUntil"))).toISOString() : null,
        });
      } else if (mode === "SIGN" && current) {
        await command({
          action: "SIGN",
          contractVersionId: current.id,
          signatureEvidence: { type: form.get("evidenceType"), reference: form.get("evidenceReference") },
          signaturePolicyVersion: form.get("signaturePolicyVersion"),
        });
      }
      setMode(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Команда договора не выполнена");
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      await command({ action: "ISSUE", contractVersionId: current.id });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Договор не выдан");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {legacyCount > 0 && (
        <p role="status" className="flex gap-2 border-l-4 border-warning bg-warning-soft px-3 py-2 text-[12px] leading-relaxed text-warning">
          <WarningCircle size={17} weight="fill" className="mt-0.5 shrink-0" />
          {legacyCount} legacy-запись оплаты не является подтверждённой записью ledger и не влияет на статус.
        </p>
      )}
      {error && <p role="alert" className="bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">{error}</p>}

      {!current ? (
        <div className="py-7 text-center">
          <p className="font-medium text-ink">Обязательство ещё не создано</p>
          <p className="mx-auto mt-1 max-w-[60ch] text-[12px] leading-relaxed text-ink-3">Договор создаётся только из принятой immutable QuoteVersion и действующего участника с ролью «Плательщик».</p>
          {canMutate && payers.length > 0 && <Button type="button" size="sm" className="mt-4" onClick={() => { clearCommandId(commandIdentity); setMode("CREATE"); }}><FilePlus size={15} /> Создать черновик договора</Button>}
          {canMutate && payers.length === 0 && <p className="mt-3 text-[12px] font-medium text-warning">Следующее действие: добавьте в разделе «Семья» участника с ролью «Плательщик».</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 border-b border-line pb-4 sm:grid-cols-3">
            <TruthValue label="Договор" value={`v${current.versionNumber} · ${CONTRACT_STATUS[current.status] ?? current.status}`} />
            <TruthValue label="Обязательство" value={summary?.obligationKopecks == null ? "Не подтверждено" : moneyFromKopecks(summary.obligationKopecks)} />
            <TruthValue label="Статус оплаты" value={summary?.status ? PAYMENT_STATUS[summary.status] ?? summary.status : "Недостаточно данных"} tone={summary?.status === "PAID" || summary?.status === "OVERPAID" ? "success" : "warning"} />
          </div>
          <dl className="grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
            <MoneyRow label="Получено" value={summary?.paidKopecks} />
            <MoneyRow label="Возвращено" value={summary?.refundedKopecks} />
            <MoneyRow label="Остаток" value={summary?.balanceKopecks} emphasize />
            <div className="flex justify-between gap-4"><dt className="text-ink-3">Источник</dt><dd className="text-right font-medium text-ink">QuoteVersion #{current.quoteVersionId}</dd></div>
          </dl>
          {canMutate && current.status === "DRAFT" && <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-2 px-3 py-3"><p className="text-[12px] text-ink-2">Следующее действие: проверить snapshot и выдать эту версию.</p><Button type="button" size="sm" onClick={issue} loading={busy}>Выдать договор</Button></div>}
          {canMutate && current.status === "ISSUED" && <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-2 px-3 py-3"><p className="text-[12px] text-ink-2">Подписание доступно только по утверждённой Legal policy и подтверждению.</p><Button type="button" size="sm" onClick={() => { clearCommandId(commandIdentity); setMode("SIGN"); }}><SealCheck size={15} /> Зафиксировать подписание</Button></div>}
          <p className="text-[12px] leading-relaxed text-ink-3">Статус вычисляется только из immutable obligation и append-only ledger. Удаление записей и ручная установка PAID отсутствуют.</p>
        </div>
      )}

      {mode === "CREATE" && (
        <form onSubmit={submit} className="grid gap-3 bg-surface-2 p-4" aria-label="Создать черновик договора">
          <label><span className="td-field-label">Плательщик</span><select name="payerPartyId" className="td-field" required>{payers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}</select></label>
          <label><span className="td-field-label">Условия оплаты</span><textarea name="paymentTerms" className="td-field min-h-20 resize-y" minLength={3} maxLength={500} required /></label>
          <label><span className="td-field-label">Действителен до</span><input name="validUntil" type="date" className="td-field" /></label>
          <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonClasses({ variant: "secondary", size: "sm" })} onClick={() => { clearCommandId(commandIdentity); setMode(null); }}>Отмена</button><Button type="submit" size="sm" loading={busy}>Создать</Button></div>
        </form>
      )}
      {mode === "SIGN" && current && (
        <form onSubmit={submit} className="grid gap-3 bg-surface-2 p-4" aria-label="Зафиксировать подписание договора">
          <p className="text-[12px] leading-relaxed text-ink-2">Техническая запись не заменяет юридическое подтверждение. Сервер примет только тип evidence из действующей утверждённой policy.</p>
          <label><span className="td-field-label">Тип подтверждения</span><input name="evidenceType" className="td-field" minLength={1} maxLength={80} required /></label>
          <label><span className="td-field-label">Ссылка или реестр подтверждения</span><input name="evidenceReference" className="td-field" minLength={3} maxLength={240} required /></label>
          <label><span className="td-field-label">Версия Legal policy</span><input name="signaturePolicyVersion" className="td-field" minLength={1} maxLength={80} required /></label>
          <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonClasses({ variant: "secondary", size: "sm" })} onClick={() => { clearCommandId(commandIdentity); setMode(null); }}>Отмена</button><Button type="submit" size="sm" loading={busy}>Сохранить immutable evidence</Button></div>
        </form>
      )}
    </div>
  );
}

function TruthValue({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return <div><p className="text-[11px] font-medium text-ink-3">{label}</p><p className={`mt-1 text-[14px] font-semibold ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-ink"}`}>{value}</p></div>;
}

function MoneyRow({ label, value, emphasize = false }: { label: string; value: number | null | undefined; emphasize?: boolean }) {
  return <div className="flex justify-between gap-4"><dt className="text-ink-3">{label}</dt><dd className={`tnum text-right ${emphasize ? "font-semibold text-ink" : "text-ink-2"}`}>{value == null ? "Не рассчитан" : moneyFromKopecks(value)}</dd></div>;
}

export default PaymentsSection;
