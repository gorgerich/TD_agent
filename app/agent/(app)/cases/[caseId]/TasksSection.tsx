"use client";

import { useMemo, useState } from "react";
import { CalendarBlank, Check, Clock, Flag, Plus, Prohibit, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/Toast";
import { dateTime } from "@/lib/format";

type Task = {
  id: number;
  title: string;
  type: string;
  priority: string;
  status: string;
  source: string;
  expectedOutcome: string | null;
  waitingReason: string | null;
  ownerName: string;
  version: number;
  dueAt: string | null;
  completedAt: string | null;
};

type TaskAction = { task: Task; type: "complete" | "cancel" | "reschedule" | "wait" | "resume" } | null;

export function TasksSection({ caseId, initial, canMutate = true }: { caseId: number; initial: Task[]; canMutate?: boolean }) {
  const [tasks, setTasks] = useState(initial);
  const [showCreate, setShowCreate] = useState(false);
  const [action, setAction] = useState<TaskAction>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const toast = useToast();
  const open = useMemo(() => tasks.filter((task) => task.status === "OPEN"), [tasks]);
  const closed = useMemo(() => tasks.filter((task) => task.status !== "OPEN"), [tasks]);
  const overdue = open.filter(isOverdue).length;

  async function createTask(input: NewTaskInput) {
    setPending(true);
    setMessage(null);
    const operationId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/agent/cases/${caseId}/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `task:create:${operationId}`,
          "X-Correlation-Id": operationId,
        },
        body: JSON.stringify({
          ...input,
          dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new CommandFailure(response.status, body.error ?? "Не удалось создать задачу", body.code);
      const created = body.task as { id: number; status: string; version: number; completedAt: string | null };
      setTasks((current) => [{
        id: created.id,
        title: input.title,
        type: "MANUAL",
        priority: input.priority,
        status: created.status,
        source: "Агент",
        expectedOutcome: input.expectedOutcome || null,
        waitingReason: input.waitingReason || null,
        ownerName: "Вы",
        version: created.version,
        dueAt: input.dueAt ? new Date(input.dueAt).toISOString() : null,
        completedAt: created.completedAt,
      }, ...current]);
      setShowCreate(false);
      toast({ type: "success", message: "Задача добавлена в рабочую очередь." });
    } catch (error) {
      setMessage(commandMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function runAction(value: string, dueAt?: string) {
    if (!action || !value.trim()) return;
    setPending(true);
    setMessage(null);
    const operationId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/agent/cases/${caseId}/tasks/${action.task.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `task:${action.type}:${action.task.id}:${operationId}`,
          "X-Correlation-Id": operationId,
        },
        body: JSON.stringify(taskCommandPayload(action, value, dueAt)),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new CommandFailure(response.status, body.error ?? "Не удалось изменить задачу", body.code);
      const updated = body.task as { status: string; version: number; completedAt: string | null; dueAt: string | null; waitingReason: string | null };
      setTasks((current) => current.map((task) => task.id === action.task.id
        ? { ...task, status: updated.status, version: updated.version, completedAt: updated.completedAt, dueAt: updated.dueAt, waitingReason: updated.waitingReason }
        : task));
      setAction(null);
      toast({ type: "success", message: taskSuccessMessage(action.type) });
    } catch (error) {
      setMessage(commandMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="td-work-kicker">
        <span>{open.length ? <><strong>{open.length}</strong> в работе</> : closed.length ? "Все действия закрыты" : "Нет открытых задач"}</span>
        {overdue > 0 && <span className="inline-flex items-center gap-1.5 font-semibold text-danger"><Warning size={13} weight="fill" /> {overdue} просрочено</span>}
      </div>

      {message && (
        <div role="alert" className="flex items-start gap-2 border-l-2 border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
          <Warning size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {open.length > 0 && (
        <ul className="td-work-list" aria-label="Открытые задачи">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onAction={canMutate ? (type) => { setMessage(null); setAction({ task, type }); } : undefined}
            />
          ))}
        </ul>
      )}

      {!tasks.length && !showCreate && (
        <div className="py-4 text-[13px] leading-relaxed text-ink-3">
          Следующее действие ещё не зафиксировано. Добавьте конкретный шаг и ожидаемый результат.
        </div>
      )}

      {action && (
        <OutcomeForm
          mode={action.type}
          task={action.task}
          pending={pending}
          onSubmit={runAction}
          onCancel={() => { setAction(null); setMessage(null); }}
        />
      )}

      {closed.length > 0 && (
        <details className="border-t border-line pt-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-ink-2">Закрытые действия · {closed.length}</summary>
          <ul className="mt-2 divide-y divide-line" aria-label="Закрытые задачи">
            {closed.map((task) => (
              <li key={task.id} className="py-2.5 text-[13px] text-ink-3">
                <span className="inline-flex items-center gap-2"><Check size={14} weight="bold" /> <span className="line-through">{task.title}</span></span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!canMutate && <p className="text-[12px] text-ink-3">Режим просмотра: изменение задач недоступно для этой роли.</p>}

      {canMutate && (showCreate ? (
        <NewTaskForm pending={pending} onSubmit={createTask} onCancel={() => { setShowCreate(false); setMessage(null); }} />
      ) : (
        <Button type="button" variant="secondary" size="sm" leftIcon={<Plus size={15} weight="bold" />} onClick={() => { setShowCreate(true); setAction(null); }}>
          Добавить действие
        </Button>
      ))}
    </div>
  );
}

function TaskRow({ task, onAction }: { task: Task; onAction?: (type: Exclude<NonNullable<TaskAction>["type"], never>) => void }) {
  const overdue = isOverdue(task);
  return (
    <li className="px-1 py-3 sm:px-2">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${overdue ? "bg-danger-soft text-danger" : "bg-surface-2 text-ink-3"}`}>
          {overdue ? <Warning size={14} weight="fill" /> : <Clock size={14} weight="fill" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <strong className="text-[13px] leading-snug text-ink">{task.title}</strong>
            <span className={`text-[11px] font-semibold ${priorityClass(task.priority)}`}><Flag size={12} weight="fill" className="mr-1 inline" />{priorityLabel(task.priority)}</span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">Результат: {task.expectedOutcome ?? "зафиксировать выполненное действие"}</p>
          <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
            <span>{task.ownerName}</span>
            <span>· {task.source}</span>
            <span className={overdue ? "font-semibold text-danger" : ""}>· {task.dueAt ? dateTime(task.dueAt) : "без срока"}</span>
          </p>
          {task.waitingReason && <p className="mt-2 border-l-2 border-warning pl-2 text-[12px] text-warning">Ожидание: {task.waitingReason}</p>}
          {onAction && <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => onAction("complete")}>{actionLabel(task.type)}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onAction("reschedule")}>Перенести</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => onAction(task.waitingReason ? "resume" : "wait")}>{task.waitingReason ? "Возобновить" : "В ожидание"}</Button>
            <Button type="button" size="sm" variant="ghost" leftIcon={<Prohibit size={14} weight="bold" />} onClick={() => onAction("cancel")}>Отменить</Button>
          </div>}
        </div>
      </div>
    </li>
  );
}

type NewTaskInput = { title: string; dueAt: string; priority: string; expectedOutcome: string; waitingReason: string };

function NewTaskForm({ pending, onSubmit, onCancel }: { pending: boolean; onSubmit: (input: NewTaskInput) => Promise<void>; onCancel: () => void }) {
  const [input, setInput] = useState<NewTaskInput>({ title: "", dueAt: "", priority: "NORMAL", expectedOutcome: "", waitingReason: "" });
  return (
    <form className="td-form-surface grid gap-4" onSubmit={(event) => { event.preventDefault(); void onSubmit(input); }}>
      <div>
        <strong className="text-[13px] text-ink">Новое действие</strong>
        <p className="mt-1 text-[12px] text-ink-3">Сформулируйте проверяемый результат, а не напоминание.</p>
      </div>
      <label className="grid gap-1.5">
        <span className="td-field-label">Что сделать</span>
        <input className="td-field" value={input.title} onChange={(event) => setInput({ ...input, title: event.target.value })} maxLength={500} required autoFocus />
      </label>
      <label className="grid gap-1.5">
        <span className="td-field-label">Ожидаемый результат</span>
        <input className="td-field" value={input.expectedOutcome} onChange={(event) => setInput({ ...input, expectedOutcome: event.target.value })} maxLength={500} placeholder="Например: клиент подтвердил время церемонии" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="td-field-label"><CalendarBlank size={14} weight="fill" className="mr-1 inline" /> Срок</span>
          <input type="datetime-local" className="td-field" value={input.dueAt} onChange={(event) => setInput({ ...input, dueAt: event.target.value })} />
        </label>
        <label className="grid gap-1.5">
          <span className="td-field-label">Приоритет</span>
          <select className="td-field" value={input.priority} onChange={(event) => setInput({ ...input, priority: event.target.value })}>
            <option value="LOW">Низкий</option>
            <option value="NORMAL">Обычный</option>
            <option value="HIGH">Высокий</option>
            <option value="CRITICAL">Критический</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1.5">
        <span className="td-field-label">Что блокирует (если есть)</span>
        <input className="td-field" value={input.waitingReason} onChange={(event) => setInput({ ...input, waitingReason: event.target.value })} maxLength={500} placeholder="Например: ждём документ от семьи" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={!input.title.trim()}>Добавить действие</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Отмена</Button>
      </div>
    </form>
  );
}

function OutcomeForm({ mode, task, pending, onSubmit, onCancel }: { mode: NonNullable<TaskAction>["type"]; task: Task; pending: boolean; onSubmit: (value: string, dueAt?: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const [dueAt, setDueAt] = useState(task.dueAt ? toLocalDateTime(task.dueAt) : "");
  return (
    <form className="border-l-2 border-accent bg-surface-2 px-4 py-3" onSubmit={(event) => { event.preventDefault(); void onSubmit(value, dueAt); }}>
      <strong className="text-[13px] text-ink">{taskFormTitle(mode, task.type)}</strong>
      <p className="mt-1 text-[12px] text-ink-3">{taskFormHint(mode, task)}</p>
      {mode === "reschedule" && (
        <input type="datetime-local" className="td-field mt-3" value={dueAt} onChange={(event) => setDueAt(event.target.value)} aria-label="Новый срок" />
      )}
      <textarea className="td-field mt-3 min-h-20 resize-y" value={value} onChange={(event) => setValue(event.target.value)} maxLength={1000} required autoFocus placeholder={taskFormPlaceholder(mode)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={!value.trim() || (mode === "reschedule" && !dueAt)}>{taskSubmitLabel(mode)}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Вернуться</Button>
      </div>
    </form>
  );
}

class CommandFailure extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}

function commandMessage(error: unknown) {
  if (error instanceof CommandFailure && error.status === 409) return `${error.message} Обновите страницу перед повтором.`;
  if (error instanceof CommandFailure && error.status === 403) return "Недостаточно прав для этого действия.";
  if (error instanceof CommandFailure) return error.message;
  return "Нет связи. Изменения не сохранены; повторите действие после восстановления сети.";
}

function isOverdue(task: Task) {
  return task.status === "OPEN" && Boolean(task.dueAt && new Date(task.dueAt) < new Date());
}

function actionLabel(type: string) {
  if (type === "PREPARATION") return "Завершить подготовку";
  if (type === "QUOTE_SEND") return "Зафиксировать отправку сметы";
  if (type === "MEETING_ESCALATION") return "Зафиксировать исход встречи";
  return "Зафиксировать результат";
}

function priorityLabel(priority: string) {
  if (priority === "CRITICAL") return "Критический";
  if (priority === "HIGH") return "Высокий";
  if (priority === "LOW") return "Низкий";
  return "Обычный";
}

function priorityClass(priority: string) {
  if (priority === "CRITICAL") return "text-danger";
  if (priority === "HIGH") return "text-warning";
  return "text-ink-3";
}

function taskCommandPayload(action: NonNullable<TaskAction>, value: string, dueAt?: string) {
  const base = { action: action.type, version: action.task.version };
  if (action.type === "complete") return { ...base, outcome: value.trim() };
  if (action.type === "wait") return { ...base, waitingReason: value.trim() };
  if (action.type === "reschedule") return { ...base, dueAt: dueAt ? new Date(dueAt).toISOString() : null, reason: value.trim() };
  return { ...base, reason: value.trim() };
}

function taskSuccessMessage(mode: NonNullable<TaskAction>["type"]) {
  if (mode === "complete") return "Результат задачи зафиксирован.";
  if (mode === "cancel") return "Задача отменена с причиной.";
  if (mode === "reschedule") return "Новый срок сохранён.";
  if (mode === "wait") return "Задача перенесена в ожидание.";
  return "Задача возвращена в работу.";
}

function taskFormTitle(mode: NonNullable<TaskAction>["type"], type: string) {
  if (mode === "complete") return actionLabel(type);
  if (mode === "cancel") return "Почему действие отменено?";
  if (mode === "reschedule") return "Перенести срок";
  if (mode === "wait") return "Что блокирует задачу?";
  return "Почему задача снова в работе?";
}

function taskFormHint(mode: NonNullable<TaskAction>["type"], task: Task) {
  if (mode === "complete") return `Ожидалось: ${task.expectedOutcome ?? "зафиксированный результат"}`;
  if (mode === "reschedule") return "Новый срок и причина останутся в истории.";
  if (mode === "wait") return "Очередь покажет задачу в разделе «Ожидание».";
  return "Причина останется в неизменяемом журнале действий.";
}

function taskFormPlaceholder(mode: NonNullable<TaskAction>["type"]) {
  if (mode === "complete") return "Что получилось и что делать дальше";
  if (mode === "cancel") return "Причина отмены";
  if (mode === "reschedule") return "Почему изменился срок";
  if (mode === "wait") return "Например: ждём документ от семьи";
  return "Что изменилось";
}

function taskSubmitLabel(mode: NonNullable<TaskAction>["type"]) {
  if (mode === "complete") return "Сохранить результат";
  if (mode === "cancel") return "Отменить задачу";
  if (mode === "reschedule") return "Перенести";
  if (mode === "wait") return "Перевести в ожидание";
  return "Вернуть в работу";
}

function toLocalDateTime(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
