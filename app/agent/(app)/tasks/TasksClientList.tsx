"use client";

import { Link } from "next-view-transitions";
import { useMemo, useState } from "react";
import { ArrowRight, Check, Clock, Warning } from "@phosphor-icons/react";
import { buttonClasses } from "@/components/ui/Button";
import { useSwipeX } from "@/lib/useSwipeX";
import { hapticTap } from "@/lib/haptics";

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

  const groups = useMemo(() => {
    const map: Record<GroupId, TaskListRow[]> = { overdue: [], today: [], later: [], done: [] };
    for (const task of tasks) map[groupTask(task)].push(task);
    return map;
  }, [tasks]);
  const openCount = tasks.filter((task) => !task.completedAt).length;

  // Возвращает успех, чтобы swipe-ряд мог откатить жест при ошибке сети.
  async function markDone(task: TaskListRow): Promise<boolean> {
    setPendingId(task.id);
    try {
      const res = await fetch(`/api/agent/cases/${task.leadId}/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      if (!res.ok) return false;
      const { task: updated } = await res.json();
      setTasks((current) => current.map((item) => (
        item.id === task.id ? { ...item, completedAt: updated.completedAt } : item
      )));
      hapticTap();
      return true;
    } catch {
      return false;
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="rise rise-1 space-y-4">
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCell label="Открыто" value={String(openCount)} />
        <SummaryCell label="Просрочено" value={String(groups.overdue.length)} tone="danger" />
        <SummaryCell label="Сегодня" value={String(groups.today.length)} tone="warning" />
        <SummaryCell label="Выполнено" value={String(groups.done.length)} tone="success" />
      </div>

      {GROUPS.map((group) => {
        const items = groups[group.id];
        return (
          <section key={group.id} className="td-entity-list">
            <header className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/55 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <GroupIcon group={group.id} />
                <div>
                  <h2 className="text-[13px] font-semibold text-ink">{group.title}</h2>
                  <p className="text-[11px] text-ink-3">{group.hint}</p>
                </div>
              </div>
              <span className="td-pill tnum text-[11px]">{items.length}</span>
            </header>
            {items.length === 0 ? (
              <div className="px-4 py-4 text-[13px] text-ink-3">Нет задач в группе</div>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((task) => (
                  <SwipeableTaskRow
                    key={task.id}
                    task={task}
                    group={group.id}
                    pending={pendingId === task.id}
                    onComplete={() => markDone(task)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// Свайп вправо = выполнить (touch/pen; мышь и десктоп - кнопка «Отметить»).
// Под рядом - success-подложка с галкой, растёт по мере жеста. Откат при ошибке.
function SwipeableTaskRow({ task, group, pending, onComplete }: {
  task: TaskListRow;
  group: GroupId;
  pending: boolean;
  onComplete: () => Promise<boolean>;
}) {
  const [out, setOut] = useState(false);
  const swipe = useSwipeX({
    dir: "right",
    threshold: 88,
    enabled: !task.completedAt && !pending,
    onCommit: () => {
      setOut(true);
      hapticTap();
      void onComplete().then((ok) => {
        if (!ok) {
          setOut(false);
          swipe.reset();
        }
      });
    },
  });

  const bar = task.completedAt
    ? "before:bg-success"
    : group === "overdue"
    ? "before:bg-danger"
    : group === "today"
    ? "before:bg-warning"
    : "before:bg-accent";
  const reveal = out ? 1 : swipe.progress;

  return (
    <li className="td-entity-row relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 flex items-center bg-success-soft pl-5 text-success"
        style={{ opacity: reveal }}
      >
        <Check size={18} weight="bold" style={{ transform: `scale(${0.6 + 0.4 * reveal})` }} />
      </div>
      <div
        {...swipe.bind}
        className={`relative grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 py-3.5 pl-5 pr-4 before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${bar}`}
        style={{
          transform: out ? "translateX(calc(100% + 24px))" : `translateX(${swipe.dx}px)`,
          transition: swipe.dragging ? "none" : "transform 0.24s var(--ease-out)",
          touchAction: "pan-y",
          backgroundColor: out || swipe.dx !== 0 ? "var(--color-surface)" : undefined,
        }}
      >
        <Link href={`/agent/cases/${task.leadId}`} className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] font-semibold ${task.completedAt ? "text-ink-3 line-through" : "text-ink"}`}>{task.title}</span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
            <span className="truncate">{task.clientName}</span>
            <span className="text-ink-3">·</span>
            <span className="text-ink-3">Кейс #{task.leadId}</span>
            <span className="text-ink-3">·</span>
            <span className="text-ink-3">{dueLabel(task.dueAt)}</span>
          </span>
        </Link>
        {task.completedAt ? (
          <span className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-full border border-success/20 bg-success-soft px-3 text-[12px] font-semibold text-success">
            <Check size={13} weight="bold" /> Выполнена
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onComplete()}
            disabled={pending}
            className={buttonClasses({ size: "sm", className: "w-fit" })}
          >
            <Check size={13} weight="bold" />
            {pending ? "Сохраняю" : "Отметить"}
          </button>
        )}
      </div>
    </li>
  );
}

function SummaryCell({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" | "success" }) {
  const cls = tone === "danger"
    ? "td-metric-danger"
    : tone === "warning"
      ? "td-metric-warning"
      : tone === "success"
        ? "td-metric-success"
        : "text-ink";
  return (
    <div className={`td-metric ${cls}`}>
      <div className="truncate text-[11px] font-medium opacity-75">{label}</div>
      <div className="tnum mt-0.5 truncate text-[15px] font-semibold">{value}</div>
    </div>
  );
}

function GroupIcon({ group }: { group: GroupId }) {
  if (group === "overdue") return <Warning size={16} weight="duotone" className="text-danger" />;
  if (group === "today") return <Clock size={16} weight="duotone" className="text-warning" />;
  if (group === "done") return <Check size={16} weight="bold" className="text-success" />;
  return <ArrowRight size={16} className="text-ink-3" />;
}
