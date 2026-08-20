"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle, LockSimple } from "@phosphor-icons/react";
import { Button, buttonClasses } from "@/components/ui/Button";

export function ExecutionActions({
  caseId,
  executionConfirmed,
}: {
  caseId: number;
  executionConfirmed: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closing = executionConfirmed;

  async function submit() {
    const commandId = crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/cases/${caseId}/transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `execution:${commandId}`,
          "X-Correlation-Id": commandId,
        },
        body: JSON.stringify(closing
          ? { eventType: "case.closure_requested.v1", payload: {} }
          : { eventType: "execution.confirmed.v1", payload: { confirmationSource: "OPERATOR_CONFIRMED" } }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Команда исполнения не выполнена");
      setConfirming(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Команда исполнения не выполнена");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className={buttonClasses({ size: "sm" })}
        onClick={() => setConfirming(true)}
      >
        {closing ? <LockSimple size={15} weight="bold" /> : <CheckCircle size={15} weight="bold" />}
        {closing ? "Закрыть кейс" : "Подтвердить исполнение"}
      </button>
    );
  }

  return (
    <div
      className="w-full max-w-[560px] bg-surface px-3 py-3"
      role="group"
      aria-label={closing ? "Подтверждение закрытия кейса" : "Подтверждение исполнения"}
    >
      <p className="text-[12px] leading-relaxed text-ink-2">
        {closing
          ? "Кейс будет закрыт только после повторной серверной проверки документов, договора, ledger и сценарного подтверждения."
          : "Подтвердите только фактически выполненный сценарий. Действие фиксируется в неизменяемой истории кейса."}
      </p>
      {error && <p className="mt-2 text-[12px] font-medium text-danger" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={submit} loading={busy}>
          {closing ? "Подтверждаю закрытие" : "Подтверждаю исполнение"}
        </Button>
        <button
          type="button"
          className={buttonClasses({ variant: "ghost", size: "sm" })}
          onClick={() => setConfirming(false)}
          disabled={busy}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
