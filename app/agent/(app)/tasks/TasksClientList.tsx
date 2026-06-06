"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ArrowRight, Check, Clock, Warning } from "@phosphor-icons/react";

export type TaskListRow = {
  id: number;
  leadId: number;
  title: string;
  clientName: string;
  dueAt: string | null;
  completedAt: string | null;
};

type GroupId = "overdue" | "today" | "later" | "done";

const GROUPS: Array<{ id: GroupId; title: string; hint: string }> = [
  { id: "overdue", title: "Просрочены", hint: "Нужно закрыть первым" },
  { id: "today", title: "Сегодня", hint: "Дедлайн сегодня" },
  { id: "later", title: "Позже", hint: "Есть срок или без срока" },
  { id: "done", title: "Выполненные", hint: "Закрытые задачи" },
];

const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function groupTask(task: TaskListRow, now = new Date()): GroupId {
  if (task.completedAt) return "done";
  if (!task.dueAt) return "later";
  const due = new Date(task.dueAt);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  if (due.getTime() < start.getTime()) return "overdue";
  if (due.getTime() <= end.getTime()) return "today";
  return "later";
}

function dueLabel(value: string | null) {
  if (!value) return "Без срока";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Без срока" : dayFmt.format(date);
}

export function TasksClientList({ initialTasks }: { initialTasks: TaskListRow[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const groups = useMemo(() => {
    const map: Record<GroupId, TaskListRow[]> = { overdue: [], today: [], later: [], done: [] };
    for (const task of tasks) map[groupTask(task)].push(task);
    return map;
  }, [tasks]);

  function markDone(task: TaskListRow) {
    setPendingId(task.id);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/agent/cases/${task.leadId}/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: true }),
        });
        if (!res.ok) return;
        const { task: updated } = await res.json();
        setTasks((current) => current.map((item) => (
          item.id === task.id ? { ...item, completedAt: updated.completedAt } : item
        )));
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <div className="rise rise-1 space-y-4">
      {GROUPS.map((group) => {
        const items = groups[group.id];
        return (
          <section key={group.id} className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
            <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/55 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <GroupIcon group={group.id} />
                <div>
                  <h2 className="text-[13px] font-semibold text-ink">{group.title}</h2>
                  <p className="text-[11.5px] text-ink-3">{group.hint}</p>
                </div>
              </div>
              <span className="tnum rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] font-semibold text-ink-2">{items.length}</span>
            </header>
            {items.length === 0 ? (
              <div className="px-4 py-4 text-[13px] text-ink-3">Нет задач в группе</div>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((task) => (
                  <li key={task.id} className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(260px,1fr)_170px_120px_120px_148px] md:items-center md:gap-3">
                    <Link href={`/agent/cases/${task.leadId}`} className="min-w-0">
                      <span className={`block truncate text-[14px] font-semibold ${task.completedAt ? "text-ink-3 line-through" : "text-ink"}`}>{task.title}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-3 md:hidden">{task.clientName} · Кейс #{task.leadId}</span>
                    </Link>
                    <span className="hidden truncate text-[13px] text-ink-2 md:block">{task.clientName}</span>
                    <Link href={`/agent/cases/${task.leadId}`} className="hidden text-[12.5px] font-medium text-accent hover:text-accent-hover md:inline">Кейс #{task.leadId}</Link>
                    <span className="text-[12.5px] text-ink-3">{dueLabel(task.dueAt)}</span>
                    {task.completedAt ? (
                      <span className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full border border-success/20 bg-success-soft px-3 text-[12.5px] font-semibold text-success">
                        <Check size={13} weight="bold" /> Выполнена
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => markDone(task)}
                        disabled={pendingId === task.id}
                        className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full bg-accent px-3 text-[12.5px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-55"
                      >
                        <Check size={13} weight="bold" />
                        {pendingId === task.id ? "Сохраняю" : "Отметить выполненной"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function GroupIcon({ group }: { group: GroupId }) {
  if (group === "overdue") return <Warning size={16} weight="duotone" className="text-danger" />;
  if (group === "today") return <Clock size={16} weight="duotone" className="text-warning" />;
  if (group === "done") return <Check size={16} weight="bold" className="text-success" />;
  return <ArrowRight size={16} className="text-ink-3" />;
}
