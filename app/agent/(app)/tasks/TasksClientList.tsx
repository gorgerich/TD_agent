"use client";

import { Link } from "next-view-transitions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowClockwise,
  ArrowRight,
  CalendarBlank,
  CheckCircle,
  Clock,
  Hourglass,
  UserCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { OperationsQueue, QueueGroup, QueueItem } from "@/lib/operationsReadModel";
import { SavedViews } from "../operations/SavedViews";

const GROUPS: Array<{
  id: QueueGroup;
  title: string;
  description: string;
  icon: typeof WarningCircle;
}> = [
  { id: "OVERDUE", title: "Просрочено", description: "Нужна реакция сейчас", icon: WarningCircle },
  { id: "TODAY", title: "Сегодня", description: "План до конца дня", icon: Clock },
  { id: "UPCOMING", title: "Предстоящие", description: "Следующие обязательства", icon: CalendarBlank },
  { id: "WAITING", title: "Ожидание", description: "Нужно снять блокировку", icon: Hourglass },
];

type CompletionState = {
  item: QueueItem;
  outcome: string;
};

function useConnectivity() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

export function TasksClientList({
  initialQueue,
  loadError,
}: {
  initialQueue: OperationsQueue | null;
  loadError: string | null;
}) {
  const router = useRouter();
  const online = useConnectivity();
  const [queue, setQueue] = useState(initialQueue);
  const [completion, setCompletion] = useState<CompletionState | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<QueueGroup | "ALL">("ALL");
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "complete" | "error">("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const outcomeRef = useRef<HTMLTextAreaElement>(null);
  const syncStarted = useRef(false);

  useEffect(() => {
    if (completion) outcomeRef.current?.focus();
  }, [completion]);

  const syncQueue = useCallback(async () => {
    if (!navigator.onLine) {
      setSyncState("error");
      setSyncError("Сверка обязательств не выполнена: нет подключения к сети.");
      return;
    }

    setSyncState("syncing");
    setSyncError(null);
    try {
      const syncResponse = await fetch("/api/agent/operations/sync", {
        method: "POST",
        headers: { "X-Correlation-Id": crypto.randomUUID() },
      });
      const syncPayload = await syncResponse.json().catch(() => null) as { error?: string } | null;
      if (!syncResponse.ok) throw new Error(syncPayload?.error ?? "Не удалось сверить обязательства");

      const queueResponse = await fetch("/api/agent/operations?view=mine", { method: "GET", cache: "no-store" });
      const queuePayload = await queueResponse.json().catch(() => null) as (OperationsQueue & { error?: string }) | null;
      if (!queueResponse.ok || !queuePayload?.groups) {
        throw new Error(queuePayload?.error ?? "Сверка выполнена, но обновлённая очередь не загрузилась");
      }
      setQueue(queuePayload);
      setSyncState("complete");
    } catch (syncFailure) {
      setSyncState("error");
      setSyncError(syncFailure instanceof Error ? syncFailure.message : "Не удалось сверить обязательства");
    }
  }, []);

  useEffect(() => {
    if (!initialQueue || syncStarted.current) return;
    syncStarted.current = true;
    const start = window.setTimeout(() => void syncQueue(), 0);
    return () => window.clearTimeout(start);
  }, [initialQueue, syncQueue]);

  const total = useMemo(
    () => queue ? Object.values(queue.counts).reduce((sum, count) => sum + count, 0) : 0,
    [queue],
  );

  function beginCompletion(item: QueueItem) {
    setCommandError(null);
    setNotice(null);
    setCompletion({ item, outcome: "" });
  }

  async function completeTask() {
    if (!completion || completion.item.kind !== "TASK") return;
    const outcome = completion.outcome.trim();
    if (!outcome) {
      setCommandError("Опишите фактический результат. Пустая отметка не закрывает задачу.");
      outcomeRef.current?.focus();
      return;
    }
    if (!online) {
      setCommandError("Нет связи. Результат не отправлен и задача осталась открытой.");
      return;
    }

    const item = completion.item;
    setPendingId(item.id);
    setCommandError(null);
    try {
      const commandId = crypto.randomUUID();
      const response = await fetch(`/api/agent/cases/${item.caseId}/tasks/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": commandId,
          "X-Correlation-Id": commandId,
        },
        body: JSON.stringify({ action: "complete", outcome, version: item.version }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        if (response.status === 409) {
          setCommandError("Задача уже изменилась в другом окне. Обновите очередь перед повторным действием.");
        } else if (response.status === 403) {
          setCommandError("Недостаточно прав для закрытия этой задачи.");
        } else {
          setCommandError(payload?.error ?? "Результат не сохранён. Повторите действие.");
        }
        return;
      }

      setQueue((current) => removeQueueItem(current, item));
      setCompletion(null);
      setNotice(`Результат по задаче «${item.title}» зафиксирован.`);
    } catch {
      setCommandError("Связь прервалась. Результат не сохранён, задача осталась открытой.");
    } finally {
      setPendingId(null);
    }
  }

  if (!queue) {
    return (
      <StatePanel
        kind={online ? "error" : "offline"}
        title={online ? "Рабочий день не загрузился" : "Нет подключения к сети"}
        description={online ? (loadError ?? "Повторите запрос.") : "Когда связь вернётся, обновите очередь. Никакие действия не потеряны."}
        onRetry={() => router.refresh()}
      />
    );
  }

  return (
    <div className="space-y-5" aria-busy={pendingId !== null}>
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-[11px] text-ink-3" aria-live="polite">
        <span>
          {syncState === "syncing" && "Сверяю просроченные встречи и обязательства…"}
          {syncState === "complete" && "Обязательства сверены, очередь обновлена."}
          {syncState === "idle" && "Подготовка сверки обязательств."}
        </span>
        {syncState === "syncing" && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" aria-hidden />}
      </div>
      {syncState === "error" && syncError && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] bg-danger-soft px-4 py-3 text-[12px] text-danger">
          <span className="flex min-w-0 flex-1 items-start gap-2">
            <WarningCircle size={16} weight="fill" className="mt-0.5 flex-none" />
            <span>{syncError} Уже загруженная очередь сохранена и не подменена пустым состоянием.</span>
          </span>
          <button type="button" onClick={() => void syncQueue()} className="min-h-9 font-semibold text-ink underline decoration-line-strong underline-offset-4">
            Повторить сверку
          </button>
        </div>
      )}
      {!online && (
        <div role="status" className="flex items-start gap-3 rounded-[14px] bg-warning-soft px-4 py-3 text-[13px] text-ink-2">
          <WarningCircle className="mt-0.5 flex-none text-warning" size={18} weight="fill" />
          <span><strong className="text-ink">Офлайн.</strong> Очередь доступна для чтения, но результат нельзя сохранить до восстановления связи.</span>
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-[14px] bg-success-soft px-4 py-3 text-[13px] text-success">
          <CheckCircle className="mt-0.5 flex-none" size={18} weight="fill" />
          <span>{notice}</span>
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          title={syncState === "idle" || syncState === "syncing" ? "Сверяем рабочий день" : syncState === "error" ? "Загруженная очередь пуста" : "Очередь разобрана"}
          description={syncState === "idle" || syncState === "syncing"
            ? "Проверяем прошедшие встречи и обязательства. Если появится действие, оно будет добавлено в очередь."
            : syncState === "error"
              ? "Сверка не завершена, поэтому пустой список не считается подтверждением отсутствия обязательств. Повторите сверку выше."
              : "На сегодня нет открытых задач и встреч. Новые обязательства появятся здесь автоматически из кейсов и встреч."}
          primaryAction={{ label: "Открыть кейсы", href: "/agent/cases" }}
        />
      ) : (
        <>
      <nav aria-label="Группы рабочего дня" className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-xs),var(--hl-top)] sm:grid-cols-4">
        {GROUPS.map((group, index) => (
          <button
            key={group.id}
            type="button"
            onClick={() => setActiveGroup((current) => current === group.id ? "ALL" : group.id)}
            aria-pressed={activeGroup === group.id}
            className={`min-w-0 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 ${activeGroup === group.id ? "bg-accent-soft" : ""} ${index > 0 ? "border-l border-line" : ""} ${index > 1 ? "border-t border-line sm:border-t-0" : ""}`}
          >
            <span className="tnum block text-[20px] font-semibold leading-none text-ink">{queue.counts[group.id]}</span>
            <span className="mt-1 block text-[11px] font-medium text-ink-3">{group.title}</span>
          </button>
        ))}
      </nav>

      <SavedViews
        screen="today"
        scope="MY"
        query={{ group: activeGroup }}
        onApply={(savedQuery) => {
          const group = savedQuery.group;
          if (group === "ALL" || GROUPS.some((item) => item.id === group)) setActiveGroup(group as QueueGroup | "ALL");
        }}
      />

      {GROUPS.filter((group) => activeGroup === "ALL" || group.id === activeGroup).map((group) => {
        const items = queue.groups[group.id];
        if (items.length === 0) return null;
        return (
          <QueueSection
            key={group.id}
            group={group}
            items={items}
            timezone={queue.timezone}
            completion={completion}
            pendingId={pendingId}
            commandError={commandError}
            online={online}
            outcomeRef={outcomeRef}
            onBeginCompletion={beginCompletion}
            onOutcomeChange={(outcome) => setCompletion((current) => current ? { ...current, outcome } : current)}
            onCancelCompletion={() => {
              setCompletion(null);
              setCommandError(null);
            }}
            onComplete={() => void completeTask()}
            onRefresh={() => router.refresh()}
          />
        );
      })}
      {activeGroup !== "ALL" && queue.groups[activeGroup].length === 0 && (
        <section className="rounded-[var(--radius-card)] bg-surface px-5 py-9 text-center shadow-[var(--shadow-xs),var(--hl-top)]">
          <CheckCircle size={23} weight="fill" className="mx-auto text-success" />
          <h2 className="mt-3 text-[14px] font-semibold text-ink">В этой группе дел нет</h2>
          <button type="button" onClick={() => setActiveGroup("ALL")} className={buttonClasses({ variant: "ghost", size: "sm", className: "mt-3" })}>
            Показать весь день
          </button>
        </section>
      )}
        </>
      )}
    </div>
  );
}

function QueueSection({
  group,
  items,
  timezone,
  completion,
  pendingId,
  commandError,
  online,
  outcomeRef,
  onBeginCompletion,
  onOutcomeChange,
  onCancelCompletion,
  onComplete,
  onRefresh,
}: {
  group: (typeof GROUPS)[number];
  items: QueueItem[];
  timezone: string;
  completion: CompletionState | null;
  pendingId: number | null;
  commandError: string | null;
  online: boolean;
  outcomeRef: React.RefObject<HTMLTextAreaElement | null>;
  onBeginCompletion: (item: QueueItem) => void;
  onOutcomeChange: (value: string) => void;
  onCancelCompletion: () => void;
  onComplete: () => void;
  onRefresh: () => void;
}) {
  const Icon = group.icon;
  return (
    <section id={`queue-${group.id.toLowerCase()}`} className="scroll-mt-20 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-soft),var(--hl-top)]">
      <header className="flex items-center justify-between gap-4 bg-surface-2/60 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Icon size={19} weight="fill" className={group.id === "OVERDUE" ? "text-danger" : group.id === "TODAY" ? "text-warning" : "text-ink-3"} />
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">{group.title}</h2>
            <p className="text-[11px] text-ink-3">{group.description}</p>
          </div>
        </div>
        <span className="tnum text-[12px] font-semibold text-ink-3">{items.length}</span>
      </header>
      <ul className="divide-y divide-line">
        {items.map((item) => (
          <QueueRow
            key={item.key}
            item={item}
            timezone={timezone}
            completion={completion?.item.key === item.key ? completion : null}
            pending={pendingId === item.id}
            commandError={completion?.item.key === item.key ? commandError : null}
            online={online}
            outcomeRef={outcomeRef}
            onBeginCompletion={() => onBeginCompletion(item)}
            onOutcomeChange={onOutcomeChange}
            onCancelCompletion={onCancelCompletion}
            onComplete={onComplete}
            onRefresh={onRefresh}
          />
        ))}
      </ul>
    </section>
  );
}

function QueueRow({
  item,
  timezone,
  completion,
  pending,
  commandError,
  online,
  outcomeRef,
  onBeginCompletion,
  onOutcomeChange,
  onCancelCompletion,
  onComplete,
  onRefresh,
}: {
  item: QueueItem;
  timezone: string;
  completion: CompletionState | null;
  pending: boolean;
  commandError: string | null;
  online: boolean;
  outcomeRef: React.RefObject<HTMLTextAreaElement | null>;
  onBeginCompletion: () => void;
  onOutcomeChange: (value: string) => void;
  onCancelCompletion: () => void;
  onComplete: () => void;
  onRefresh: () => void;
}) {
  const isDirectOutcome = item.kind === "TASK" && item.actionLabel === "Зафиксировать результат";
  return (
    <li className="td-entity-row min-w-0 px-4 py-4 sm:px-5">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[14px] font-semibold leading-snug text-ink">{item.title}</h3>
            {(item.priority === "CRITICAL" || item.priority === "HIGH") && (
              <span className={`text-[11px] font-semibold ${item.priority === "CRITICAL" ? "text-danger" : "text-warning"}`}>
                {item.priority === "CRITICAL" ? "Критично" : "Высокий приоритет"}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-ink-2">{item.clientName}</p>
          <dl className="mt-2.5 grid min-w-0 gap-x-5 gap-y-2 text-[12px] text-ink-3 sm:grid-cols-2">
            <Metadata icon={<UserCircle size={15} weight="fill" />} label="Владелец" value={item.ownerName} />
            <Metadata icon={<Clock size={15} weight="fill" />} label="Срок" value={dateTimeLabel(item.dueAt, timezone)} />
            <Metadata icon={<ArrowRight size={15} weight="bold" />} label="Источник" value={item.source} />
            {item.reason && <Metadata icon={<Hourglass size={15} weight="fill" />} label="Ожидание" value={item.reason} />}
          </dl>
        </div>

        <div className="min-w-0 border-l-2 border-accent/20 pl-3.5">
          <p className="text-[11px] font-semibold text-ink-3">Ожидаемый результат</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{item.expectedOutcome}</p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
          {isDirectOutcome ? (
            <button type="button" onClick={onBeginCompletion} className={buttonClasses({ size: "sm" })}>
              <CheckCircle size={15} weight="fill" />
              {item.actionLabel}
            </button>
          ) : (
            <Link href={item.href} className={buttonClasses({ size: "sm" })}>
              {item.actionLabel}
              <ArrowRight size={14} weight="bold" />
            </Link>
          )}
          {item.kind === "TASK" && !isDirectOutcome && (
            <button type="button" onClick={onBeginCompletion} className={buttonClasses({ variant: "ghost", size: "sm" })}>
              Зафиксировать результат
            </button>
          )}
        </div>
      </div>

      {completion && (
        <form
          className="mt-4 grid gap-3 rounded-[14px] bg-surface-2 p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            onComplete();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !pending) onCancelCompletion();
          }}
        >
          <label className="min-w-0">
            <span className="td-field-label">Фактический результат</span>
            <textarea
              ref={outcomeRef}
              value={completion.outcome}
              onChange={(event) => onOutcomeChange(event.target.value)}
              className="td-field"
              placeholder={item.expectedOutcome}
              maxLength={1000}
              disabled={pending}
              aria-describedby={commandError ? `task-error-${item.id}` : undefined}
            />
          </label>
          <div className="flex flex-wrap gap-2 sm:pb-0.5">
            <button type="submit" disabled={pending || !online} className={buttonClasses({ size: "sm" })}>
              {pending ? "Сохраняю…" : "Сохранить результат"}
            </button>
            <button type="button" onClick={onCancelCompletion} disabled={pending} className={buttonClasses({ variant: "ghost", size: "sm" })}>
              Отмена
            </button>
          </div>
          {commandError && (
            <div id={`task-error-${item.id}`} role="alert" className="flex items-start gap-2 text-[12px] text-danger sm:col-span-2">
              <WarningCircle className="mt-0.5 flex-none" size={15} weight="fill" />
              <span>{commandError}</span>
              {commandError.includes("другом окне") && (
                <button type="button" onClick={onRefresh} className="font-semibold text-ink underline decoration-line-strong underline-offset-4">
                  Обновить
                </button>
              )}
            </div>
          )}
        </form>
      )}
    </li>
  );
}

function Metadata({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-px flex-none text-ink-3" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <dt className="sr-only">{label}</dt>
        <dd className="break-words"><span className="text-ink-3">{label}:</span> <span className="font-medium text-ink-2">{value}</span></dd>
      </div>
    </div>
  );
}

function StatePanel({ kind, title, description, onRetry }: {
  kind: "error" | "offline";
  title: string;
  description: string;
  onRetry: () => void;
}) {
  return (
    <section role={kind === "error" ? "alert" : "status"} className="rounded-[var(--radius-card)] bg-surface px-5 py-10 text-center shadow-[var(--shadow-soft),var(--hl-top)] sm:px-8">
      <WarningCircle size={26} weight="fill" className="mx-auto text-warning" />
      <h2 className="mt-4 text-[20px] font-semibold text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-[48ch] text-[13px] leading-relaxed text-ink-2">{description}</p>
      <button type="button" onClick={onRetry} className={buttonClasses({ size: "sm", className: "mt-5" })}>
        <ArrowClockwise size={15} weight="bold" /> Повторить
      </button>
    </section>
  );
}

function removeQueueItem(queue: OperationsQueue | null, item: QueueItem): OperationsQueue | null {
  if (!queue) return null;
  return {
    ...queue,
    groups: { ...queue.groups, [item.group]: queue.groups[item.group].filter((current) => current.key !== item.key) },
    counts: { ...queue.counts, [item.group]: Math.max(0, queue.counts[item.group] - 1) },
  };
}

function dateTimeLabel(value: string | null, timezone: string) {
  if (!value) return "Срок не задан";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Срок не задан";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
