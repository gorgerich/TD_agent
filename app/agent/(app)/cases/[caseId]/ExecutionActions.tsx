"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CheckCircle, LockSimple } from "@phosphor-icons/react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { clearCommandId, type ClientCommandIdentity } from "@/lib/clientCommandId";
import {
  commandEnvelopeFor,
  recoveryForResponse,
  recoveryForTransport,
  type RecoverableClientCommand,
} from "@/lib/clientCommandRecovery";

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
  const [recovery, setRecovery] = useState<RecoverableClientCommand | null>(null);
  const recoveryRef = useRef<RecoverableClientCommand | null>(null);
  const commandIdentity = useRef<ClientCommandIdentity | null>(null);
  const closing = executionConfirmed;

  function applyRecovery(next: RecoverableClientCommand | null) {
    recoveryRef.current = next;
    setRecovery(next);
  }

  async function sendCommand(envelope: RecoverableClientCommand) {
    let response: Response;
    try {
      response = await fetch(envelope.path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `execution:${envelope.commandId}`,
          "X-Correlation-Id": envelope.commandId,
        },
        body: envelope.serializedBody,
      });
    } catch {
      applyRecovery(recoveryForTransport(envelope));
      throw new Error("Результат команды не подтверждён. Повторите синхронизацию с теми же данными");
    }
    const result = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    const retained = recoveryForResponse(envelope, response.status, result?.code);
    applyRecovery(retained);
    if (!response.ok) {
      if (!retained) clearCommandId(commandIdentity);
      throw new Error(result?.error || "Команда исполнения не выполнена");
    }
    applyRecovery(null);
    clearCommandId(commandIdentity);
  }

  async function runCommand(envelope: RecoverableClientCommand) {
    setBusy(true);
    setError(null);
    try {
      await sendCommand(envelope);
      setConfirming(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Команда исполнения не выполнена");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const body = closing
      ? { eventType: "case.closure_requested.v1", payload: {} }
      : { eventType: "execution.confirmed.v1", payload: { confirmationSource: "OPERATOR_CONFIRMED" } };
    const envelope = commandEnvelopeFor(commandIdentity, {
      path: `/api/agent/cases/${caseId}/transition`,
      serializedBody: JSON.stringify(body),
    }, recoveryRef.current);
    await runCommand(envelope);
  }

  async function retryRecovery() {
    const pending = recoveryRef.current;
    if (pending) await runCommand(pending);
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className={buttonClasses({ size: "sm" })}
        onClick={() => {
          if (recoveryRef.current) return;
          clearCommandId(commandIdentity);
          setConfirming(true);
        }}
        disabled={busy || recovery !== null}
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
      {recovery && (
        <p className="mt-2 text-[12px] font-medium text-warning" role="status">
          {recovery.durability === "CONFIRMED_COMMIT"
            ? "Команда сохранена, синхронизация не завершена. Повтор использует тот же payload и ключ."
            : "Результат команды не подтверждён. Повтор использует сохранённые payload и ключ без дублирования."}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={recovery ? retryRecovery : submit} loading={busy}>
          {recovery ? "Повторить синхронизацию" : closing ? "Подтверждаю закрытие" : "Подтверждаю исполнение"}
        </Button>
        <button
          type="button"
          className={buttonClasses({ variant: "ghost", size: "sm" })}
          onClick={() => {
            if (recoveryRef.current) return;
            clearCommandId(commandIdentity);
            setConfirming(false);
          }}
          disabled={busy || recovery !== null}
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
