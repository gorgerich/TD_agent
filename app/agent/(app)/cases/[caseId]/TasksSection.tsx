"use client";

import { useState, useTransition } from "react";
import { Check, Trash, Plus, Warning } from "@phosphor-icons/react";
import { hapticTap } from "@/lib/haptics";

type Task = {
  id: number;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
};

function isOverdue(task: Task) {
  return !task.completedAt && task.dueAt && new Date(task.dueAt) < new Date();
}

function fmtDue(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function TasksSection({ caseId, initial }: { caseId: number; initial: Task[] }) {
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [, startTransition] = useTransition();

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
      if (!res.ok) return;
      const { task } = await res.json();
      setTasks((prev) => [{ ...task, dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null, completedAt: null }, ...prev]);
      setTitle("");
      setDueAt("");
      setShowForm(false);
    } finally {
      setAdding(false);
    }
  }

  function toggleTask(task: Task) {
    const next = task.completedAt ? false : true;
    startTransition(async () => {
      const res = await fetch(`/api/agent/cases/${caseId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: next }),
      });
      if (!res.ok) return;
      const { task: updated } = await res.json();
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, completedAt: updated.completedAt } : t));
      if (next) hapticTap();
    });
  }

  function deleteTask(id: number) {
    startTransition(async () => {
      const res = await fetch(`/api/agent/cases/${caseId}/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) return;
      setTasks((prev) => prev.filter((t) => t.id !== id));
    });
  }

  const open = tasks.filter((t) => !t.completedAt);
  const done = tasks.filter((t) => t.completedAt);

  return (
    <div>
      {/* Task list */}
      {tasks.length === 0 && !showForm && (
        <p className="text-[13px] text-ink-3">Нет задач</p>
      )}
      {open.length > 0 && (
        <ul className="mb-3 space-y-2">
          {open.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task)} onDelete={() => deleteTask(task.id)} />
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <ul className="mb-3 space-y-1.5 opacity-55">
          {done.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={() => toggleTask(task)} onDelete={() => deleteTask(task.id)} />
          ))}
        </ul>
      )}

      {/* Add form */}
      {showForm ? (
        <form onSubmit={addTask} className="mt-3 space-y-2.5 rounded-[14px] border border-line bg-surface-2 p-3.5">
          <input
            autoFocus
            className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            placeholder="Текст задачи"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            required
          />
          <input
            type="datetime-local"
            className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={adding || !title.trim()}
              className="min-h-9 flex-1 rounded-[10px] bg-accent px-4 text-[13px] font-semibold text-on-accent disabled:opacity-50"
            >
              {adding ? "Добавляю…" : "Добавить"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-9 rounded-[10px] border border-line bg-surface px-4 text-[13px] font-medium text-ink-2"
            >
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-3 flex items-center gap-1.5 text-[13px] font-medium text-accent transition-colors hover:text-accent-hover"
        >
          <Plus size={14} weight="bold" /> Добавить задачу
        </button>
      )}
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: () => void; onDelete: () => void }) {
  const overdue = isOverdue(task);
  return (
    <li className="flex items-start gap-2.5">
      <button
        type="button"
        onClick={onToggle}
        aria-label={task.completedAt ? "Снять отметку" : "Отметить выполненной"}
        className={`mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border transition-colors ${
          task.completedAt
            ? "border-success bg-success text-on-accent"
            : overdue
            ? "border-danger bg-danger-soft"
            : "border-line-strong bg-surface hover:border-accent"
        }`}
      >
        {task.completedAt && <Check size={11} weight="bold" />}
      </button>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] leading-snug ${task.completedAt ? "text-ink-3 line-through" : "text-ink"}`}>
          {task.title}
        </span>
        {task.dueAt && (
          <span className={`flex items-center gap-1 text-[11px] ${overdue ? "text-danger" : "text-ink-3"}`}>
            {overdue && <Warning size={11} weight="bold" />}
            {fmtDue(task.dueAt)}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onDelete}
        className="mt-0.5 flex-shrink-0 p-1 text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
        aria-label="Удалить задачу"
      >
        <Trash size={14} />
      </button>
    </li>
  );
}
