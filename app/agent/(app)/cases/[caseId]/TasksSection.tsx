"use client";

import { useState, useTransition } from "react";
import { CalendarBlank, Check, Plus, Trash, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/Button";
import { hapticTap } from "@/lib/haptics";
import { dateTime } from "@/lib/format";
import { useToast } from "@/components/Toast";

type Task = {
  id: number;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
};

function isOverdue(task: Task) {
  return !task.completedAt && task.dueAt && new Date(task.dueAt) < new Date();
}

export function TasksSection({ caseId, initial }: { caseId: number; initial: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [, startTransition] = useTransition();
  const toast = useToast();

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/agent/cases/${caseId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueAt: dueAt || null }),
      });
      if (!res.ok) {
        toast({ type: "error", message: "Не удалось добавить задачу. Попробуйте снова." });
        return;
      }
      const { task } = await res.json();
      setTasks((prev) => [{ ...task, dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null, completedAt: null }, ...prev]);
      setTitle("");
      setDueAt("");
      setShowForm(false);
    } catch {
      toast({ type: "error", message: "Нет связи. Задача не добавлена." });
    } finally {
      setAdding(false);
    }
  }

  function toggleTask(task: Task) {
    const next = task.completedAt ? false : true;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agent/cases/${caseId}/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: next }),
        });
        if (!res.ok) {
          toast({ type: "error", message: "Не удалось обновить задачу. Попробуйте снова." });
          return;
        }
        const { task: updated } = await res.json();
        setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, completedAt: updated.completedAt } : t));
        if (next) hapticTap();
      } catch {
        toast({ type: "error", message: "Нет связи. Задача не обновлена." });
      }
    });
  }

  function deleteTask(id: number) {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agent/cases/${caseId}/tasks/${id}`, { method: "DELETE" });
        if (!res.ok) {
          toast({ type: "error", message: "Не удалось удалить задачу. Попробуйте снова." });
          return;
        }
        setTasks((prev) => prev.filter((t) => t.id !== id));
      } catch {
        toast({ type: "error", message: "Нет связи. Задача не удалена." });
      }
    });
  }

  const open = tasks.filter((t) => !t.completedAt);
  const done = tasks.filter((t) => t.completedAt);
  const overdue = open.filter(isOverdue).length;

  return (
    <div className="space-y-4">
      <div className="td-work-kicker">
        <span>
          {open.length > 0
            ? <><strong>{open.length}</strong> в работе</>
            : done.length > 0
              ? "Все действия закрыты"
              : "Нет открытых задач"}
        </span>
        {overdue > 0 && <span className="inline-flex items-center gap-1.5 font-semibold text-danger"><Warning size={13} weight="fill" /> {overdue} просрочено</span>}
      </div>

      {open.length > 0 && (
        <ul className="td-work-list" aria-label="Открытые задачи">
          {open.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task)} onDelete={() => deleteTask(task.id)} />
          ))}
        </ul>
      )}

      {tasks.length === 0 && !showForm && (
        <div className="td-form-surface flex min-w-0 items-center gap-3 py-3.5">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[14px] bg-surface text-accent shadow-[var(--shadow-xs)]">
            <CalendarBlank size={19} weight="fill" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-ink">Следующее действие ещё не зафиксировано</span>
            <span className="mt-1 block max-w-[58ch] text-[12px] leading-relaxed text-ink-3">Запишите один конкретный шаг, чтобы кейс не потерялся после разговора.</span>
          </span>
        </div>
      )}

      {done.length > 0 && (
        <div>
          <div className="td-work-kicker mb-1.5">
            <span>Выполнено</span>
            <span className="tnum">{done.length}</span>
          </div>
          <ul className="td-work-list opacity-70" aria-label="Выполненные задачи">
            {done.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task)} onDelete={() => deleteTask(task.id)} />
            ))}
          </ul>
        </div>
      )}

      {showForm ? (
        <form onSubmit={addTask} className="td-form-surface grid gap-3" aria-label="Новая задача">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-ink">Новое действие</span>
            <span className="text-[12px] text-ink-3">Чёткий шаг и срок</span>
          </div>
          <label>
            <span className="sr-only">Что нужно сделать</span>
            <input
              autoFocus
              className="td-field"
              placeholder="Что нужно сделать"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={500}
              required
            />
          </label>
          <label className="grid gap-1.5 sm:max-w-[260px]">
            <span className="td-field-label flex items-center gap-1.5"><CalendarBlank size={14} weight="fill" /> Срок</span>
            <input
              type="datetime-local"
              className="td-field"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" size="sm" loading={adding} disabled={!title.trim()}>Добавить задачу</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>Отмена</Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="secondary" size="sm" leftIcon={<Plus size={15} weight="bold" />} onClick={() => setShowForm(true)}>
          Добавить задачу
        </Button>
      )}
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: () => void; onDelete: () => void }) {
  const overdue = isOverdue(task);
  return (
    <li className="td-work-row group">
      <div className="flex min-w-0 items-start gap-2.5 px-1 py-2.5 sm:px-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={task.completedAt ? "Снять отметку" : "Отметить выполненной"}
          className={`grid h-11 w-11 flex-shrink-0 place-items-center rounded-[14px] transition-[background-color,border-color,color,transform] duration-150 ${
            task.completedAt
              ? "bg-success text-on-accent shadow-[var(--shadow-xs)]"
              : overdue
                ? "bg-danger-soft text-danger ring-1 ring-danger/20"
                : "bg-surface text-ink-3 shadow-[var(--shadow-xs)] hover:bg-accent-soft hover:text-accent"
          }`}
        >
          {task.completedAt ? <Check size={18} weight="bold" /> : <span className="h-3 w-3 rounded-full border-2 border-current opacity-70" />}
        </button>
        <span className="min-w-0 flex-1 pt-1.5">
          <span className={`block text-[13px] leading-snug ${task.completedAt ? "text-ink-3 line-through" : "font-medium text-ink"}`}>
            {task.title}
          </span>
          {task.dueAt && (
            <span className={`mt-1 flex items-center gap-1.5 text-[12px] ${overdue ? "font-semibold text-danger" : "text-ink-3"}`}>
              {overdue && <Warning size={13} weight="fill" />}
              {dateTime(task.dueAt)}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="td-icon-button mt-0.5 h-10 w-10 flex-shrink-0 text-ink-3 hover:bg-danger-soft hover:text-danger"
          aria-label="Удалить задачу"
        >
          <Trash size={16} weight="bold" />
        </button>
      </div>
    </li>
  );
}
