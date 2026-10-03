"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, Check, FileMagnifyingGlass, Warning, X } from "@phosphor-icons/react";
import { Button, buttonClasses } from "@/components/ui/Button";
import { clearCommandId, type ClientCommandIdentity } from "@/lib/clientCommandId";
import {
  commandEnvelopeFor,
  recoveryForResponse,
  recoveryForTransport,
  type RecoverableClientCommand,
} from "@/lib/clientCommandRecovery";

type QueueItem = {
  id: string;
  versionNumber: number;
  status: string;
  scanStatus: string;
  mimeType: string;
  size: number;
  createdAt: string;
  overdue: boolean;
  assignedReviewerMembershipId: string | null;
  case: { leadId: number; publicRef: string };
  document: { documentType: { code: string; name: string; version: number } };
  requirement: {
    stableKey: string;
    dueAt: string | null;
    conditionExplanation: string | null;
    policy: { scenario: string; version: number };
    reviewChecklist: string[];
  } | null;
};

export function DocumentReviewClient({
  membershipId,
  timezone,
  initial,
}: {
  membershipId: string;
  timezone: string;
  initial: QueueItem[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "available" | "mine">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewerBusyId, setViewerBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [escalatingId, setEscalatingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [checks, setChecks] = useState<Record<string, Record<string, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<(RecoverableClientCommand & { itemId: string }) | null>(null);
  const recoveryRef = useRef<(RecoverableClientCommand & { itemId: string }) | null>(null);
  const [viewer, setViewer] = useState<{ objectUrl: string; title: string } | null>(null);
  const viewerDialogRef = useRef<HTMLDivElement>(null);
  const viewerCloseRef = useRef<HTMLButtonElement>(null);
  const viewerReturnFocusRef = useRef<HTMLElement | null>(null);
  const commandIdentity = useRef<ClientCommandIdentity | null>(null);
  const mutationInFlight = useRef(false);
  const rows = useMemo(() => initial.filter((item) => {
    if (filter === "available") return item.status === "UPLOADED" && item.assignedReviewerMembershipId == null;
    if (filter === "mine") return item.assignedReviewerMembershipId === membershipId;
    return true;
  }), [filter, initial, membershipId]);

  function applyRecovery(next: (RecoverableClientCommand & { itemId: string }) | null) {
    recoveryRef.current = next;
    setRecovery(next);
  }

  useEffect(() => {
    if (!viewer) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    viewerCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewer(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(viewerDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), iframe, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        viewerCloseRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !viewerDialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !viewerDialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      URL.revokeObjectURL(viewer.objectUrl);
      if (viewerReturnFocusRef.current?.isConnected) viewerReturnFocusRef.current.focus();
      viewerReturnFocusRef.current = null;
    };
  }, [viewer]);

  async function sendCommand(envelope: RecoverableClientCommand & { itemId: string }) {
    let response: Response;
    try {
      response = await fetch(envelope.path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `document-review:${envelope.commandId}`,
          "X-Correlation-Id": envelope.commandId,
        },
        body: envelope.serializedBody ?? undefined,
      });
    } catch {
      applyRecovery({ ...recoveryForTransport(envelope), itemId: envelope.itemId });
      throw new Error("Результат решения не подтверждён. Повторите синхронизацию с теми же данными");
    }
    const result = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    const retained = recoveryForResponse(envelope, response.status, result?.code);
    applyRecovery(retained ? { ...retained, itemId: envelope.itemId } : null);
    if (!response.ok) {
      if (!retained) clearCommandId(commandIdentity);
      throw new Error(result?.error || "Команда проверки не выполнена");
    }
    applyRecovery(null);
    clearCommandId(commandIdentity);
  }

  async function command(itemId: string, path: string, body?: unknown) {
    const envelope = commandEnvelopeFor(commandIdentity, {
      path,
      serializedBody: body === undefined ? null : JSON.stringify(body),
    }, recoveryRef.current);
    await sendCommand({ ...envelope, itemId });
  }

  async function runMutation(itemId: string, operation: () => Promise<void>, fallback: string) {
    if (mutationInFlight.current) {
      setError("Дождитесь завершения текущей команды проверки");
      return false;
    }
    mutationInFlight.current = true;
    setBusyId(itemId);
    setError(null);
    try {
      await operation();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
      return false;
    } finally {
      mutationInFlight.current = false;
      setBusyId(null);
    }
  }

  async function retryRecovery() {
    const pending = recoveryRef.current;
    if (!pending) return;
    if (await runMutation(pending.itemId, () => sendCommand(pending), "Синхронизация решения не завершена")) {
      setRejectingId(null);
      setEscalatingId(null);
      setReason("");
      router.refresh();
    }
  }

  async function start(item: QueueItem) {
    if (await runMutation(
      item.id,
      () => command(item.id, `/api/agent/document-review/${item.id}/start`),
      "Документ не взят в работу",
    )) {
      router.refresh();
    }
  }

  async function decide(item: QueueItem, decision: "VERIFIED" | "REJECTED") {
    if (await runMutation(item.id, () => command(item.id, `/api/agent/document-review/${item.id}/decision`, {
        decision,
        checklist: checks[item.id] ?? {},
        reason: decision === "REJECTED" ? reason : null,
        expiresAt: null,
      }), "Решение не сохранено")) {
      setRejectingId(null);
      setReason("");
      router.refresh();
    }
  }

  async function escalate(item: QueueItem) {
    if (await runMutation(
      item.id,
      () => command(item.id, `/api/agent/document-review/${item.id}/escalate`, { reason }),
      "Эскалация не сохранена",
    )) {
      setEscalatingId(null);
      setReason("");
      router.refresh();
    }
  }

  async function open(item: QueueItem) {
    viewerReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setViewerBusyId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/agent/cases/${item.case.leadId}/documents/${item.id}`, {
        headers: {
          "X-Correlation-Id": crypto.randomUUID(),
        },
      });
      if (!response.ok) throw new Error("Файл недоступен");
      const objectUrl = URL.createObjectURL(await response.blob());
      setViewer({
        objectUrl,
        title: `${item.document.documentType.name}, ${item.case.publicRef}`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Файл недоступен");
    } finally {
      setViewerBusyId(null);
    }
  }

  const mutationLocked = busyId !== null || recovery !== null;

  return (
    <div className="td-page mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="mb-6">
        <h1 className="td-display text-[30px] text-ink sm:text-[38px]">Проверка документов</h1>
        <p className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-ink-2">
          Назначенные версии, сроки и решения по требованиям кейса.
        </p>
      </header>
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Фильтр очереди">
        {([ ["all", "Вся очередь"], ["available", "Свободные"], ["mine", "Мои"] ] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={buttonClasses({ variant: filter === value ? "primary" : "secondary", size: "sm" })} aria-pressed={filter === value}>
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mb-4 bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">{error}</p>}
      {recovery && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 bg-warning-soft px-3 py-3 text-[12px] text-warning">
          <p className="max-w-[68ch] leading-relaxed">
            {recovery.durability === "CONFIRMED_COMMIT"
              ? "Решение сохранено, синхронизация не завершена. Payload и ключ зафиксированы для безопасного повтора."
              : "Результат решения не подтверждён. Payload и ключ сохранены для безопасного повтора без дублирования."}
          </p>
          <Button type="button" size="sm" onClick={retryRecovery} loading={busyId === recovery.itemId}>Повторить синхронизацию</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="td-shell py-14 text-center">
          <FileMagnifyingGlass size={30} className="mx-auto text-ink-3" />
          <p className="mt-3 font-medium text-ink">Очередь пуста</p>
        </div>
      ) : (
        <div className="td-shell overflow-hidden">
          <ul className="divide-y divide-line">
            {rows.map((item) => {
              const mine = item.assignedReviewerMembershipId === membershipId;
              const requiredChecks = item.requirement?.reviewChecklist ?? [];
              const checklistComplete = requiredChecks.every((key) => checks[item.id]?.[key] === true);
              const due = item.requirement?.dueAt ? new Date(item.requirement.dueAt) : null;
              return (
                <li key={item.id} className="px-4 py-4 sm:px-5">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <strong className="text-[14px] text-ink">{item.document.documentType.name} · v{item.versionNumber}</strong>
                        <span className={`text-[12px] font-semibold ${mine ? "text-accent" : "text-ink-3"}`}>{mine ? "Назначен вам" : item.status === "UPLOADED" ? "Свободен" : "Назначен"}</span>
                      </div>
                      <p className="mt-1 text-[12px] text-ink-3">{item.case.publicRef} · {scenarioLabel(item.requirement?.policy.scenario)} · правило v{item.requirement?.policy.version}</p>
                      <p className={`mt-1 text-[12px] ${item.overdue ? "font-semibold text-danger" : "text-ink-3"}`}>
                        {due ? `${item.overdue ? "Срок нарушен" : "Срок"}: ${formatDateTime(due, timezone)}` : "Срок не задан правилом"}
                      </p>
                      {mine && item.status === "IN_REVIEW" && requiredChecks.length > 0 && (
                        <fieldset className="mt-3 grid gap-2" aria-label={`Проверочный перечень: ${item.document.documentType.name}`}>
                          <legend className="mb-1 text-[12px] font-semibold text-ink">Подтвердите каждый пункт</legend>
                          {requiredChecks.map((key) => (
                            <label key={key} className="flex min-h-11 items-center gap-2 bg-surface-2 px-3 text-[12px] text-ink-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={checks[item.id]?.[key] === true}
                                disabled={mutationLocked}
                                onChange={(event) => setChecks((current) => ({
                                  ...current,
                                  [item.id]: { ...current[item.id], [key]: event.target.checked },
                                }))}
                              />
                              {checklistLabel(key)}
                            </label>
                          ))}
                        </fieldset>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {mine && item.status === "IN_REVIEW" && (
                        <button type="button" onClick={() => open(item)} className={buttonClasses({ variant: "secondary", size: "sm" })} disabled={viewerBusyId !== null}>
                          <ArrowSquareOut size={14} weight="bold" /> Открыть
                        </button>
                      )}
                      {item.status === "UPLOADED" && !item.assignedReviewerMembershipId && (
                        <Button type="button" size="sm" onClick={() => start(item)} loading={busyId === item.id} disabled={mutationLocked}>Взять в работу</Button>
                      )}
                      {mine && item.status === "IN_REVIEW" && (
                        <>
                          <Button type="button" size="sm" onClick={() => decide(item, "VERIFIED")} disabled={!checklistComplete || mutationLocked} loading={busyId === item.id}>
                            <Check size={14} weight="bold" /> Проверено
                          </Button>
                          <button type="button" disabled={mutationLocked} onClick={() => { clearCommandId(commandIdentity); setReason(""); setEscalatingId(null); setRejectingId(item.id); }} className={buttonClasses({ variant: "secondary", size: "sm" })} aria-expanded={rejectingId === item.id}>
                            <X size={14} weight="bold" /> Отклонить
                          </button>
                          <button type="button" disabled={mutationLocked} onClick={() => { clearCommandId(commandIdentity); setReason(""); setRejectingId(null); setEscalatingId(item.id); }} className={buttonClasses({ variant: "secondary", size: "sm" })} aria-expanded={escalatingId === item.id}>
                            <Warning size={14} weight="bold" /> Эскалировать
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {rejectingId === item.id && (
                    <div className="mt-3 grid gap-2 bg-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <label>
                        <span className="td-field-label">Причина отклонения</span>
                        <textarea className="td-field min-h-20 resize-y" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} disabled={mutationLocked} />
                      </label>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" className={buttonClasses({ variant: "ghost", size: "sm" })} disabled={mutationLocked} onClick={() => { clearCommandId(commandIdentity); setRejectingId(null); setReason(""); }}>Отмена</button>
                        <Button type="button" size="sm" onClick={() => decide(item, "REJECTED")} disabled={reason.trim().length < 3 || mutationLocked} loading={busyId === item.id}>Сохранить решение</Button>
                      </div>
                    </div>
                  )}
                  {escalatingId === item.id && (
                    <div className="mt-3 grid gap-2 bg-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <label>
                        <span className="td-field-label">Причина и безопасное следующее действие</span>
                        <textarea className="td-field min-h-20 resize-y" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} disabled={mutationLocked} />
                      </label>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" className={buttonClasses({ variant: "ghost", size: "sm" })} disabled={mutationLocked} onClick={() => { clearCommandId(commandIdentity); setEscalatingId(null); setReason(""); }}>Отмена</button>
                        <Button type="button" size="sm" onClick={() => escalate(item)} disabled={reason.trim().length < 3 || mutationLocked} loading={busyId === item.id}>Передать владельцу кейса</Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {viewer && (
        <div ref={viewerDialogRef} className="fixed inset-0 z-[1000] flex flex-col bg-surface" role="dialog" aria-modal="true" aria-labelledby="document-viewer-title">
          <div className="flex min-h-14 items-center justify-between gap-4 border-b border-line px-4 sm:px-6">
            <h2 id="document-viewer-title" className="min-w-0 truncate text-[15px] font-semibold text-ink">
              {viewer.title}
            </h2>
            <button ref={viewerCloseRef} type="button" onClick={() => setViewer(null)} className="td-icon-button h-11 w-11 shrink-0" aria-label="Закрыть документ">
              <X size={18} weight="bold" />
            </button>
          </div>
          <iframe title={`Просмотр: ${viewer.title}`} src={viewer.objectUrl} className="min-h-0 flex-1 bg-white" />
        </div>
      )}
    </div>
  );
}

function formatDateTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(value);
}

function scenarioLabel(value: string | undefined) {
  if (value === "CREMATION_V1") return "Кремация";
  if (value === "FAMILY_PLOT_BURIAL_V1") return "Родственное захоронение";
  return value ?? "Сценарий не указан";
}

function checklistLabel(value: string) {
  const labels: Record<string, string> = {
    readable: "Документ читаем целиком",
    identity_match: "Идентификация соответствует кейсу",
    validity: "Срок действия проверен",
    completeness: "Обязательные поля заполнены",
    authority: "Основание и полномочия подтверждены",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}
