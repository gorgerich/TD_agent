import Link from "next/link";
import { ArrowRight, CheckSquare } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateTime } from "@/lib/format";

type TaskRow = {
  id: number;
  leadId: number;
  title: string;
  clientName: string;
  dueAt: Date | null;
  completedAt: Date | null;
};

async function getTasks(agentId: number): Promise<TaskRow[]> {
  if (!agentId) return [];
  try {
    const tasks = await prisma.task.findMany({
      where: { agentId },
      orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      include: { lead: { select: { id: true, name: true } } },
      take: 120,
    });
    return tasks.map((task) => ({
      id: task.id,
      leadId: task.lead.id,
      title: task.title,
      clientName: task.lead.name,
      dueAt: task.dueAt,
      completedAt: task.completedAt,
    }));
  } catch {
    return [];
  }
}

function taskStatus(task: TaskRow): { label: string; cls: string; priority: string } {
  if (task.completedAt) return { label: "Готово", cls: "border-success/20 bg-success-soft text-success", priority: "Низкий" };
  if (task.dueAt && task.dueAt.getTime() < Date.now()) return { label: "Просрочена", cls: "border-danger/20 bg-danger-soft text-danger", priority: "Высокий" };
  if (task.dueAt && task.dueAt.getTime() - Date.now() < 86_400_000) return { label: "Сегодня", cls: "border-warning/20 bg-warning-soft text-warning", priority: "Средний" };
  return { label: "Открыта", cls: "border-line bg-surface text-ink-2", priority: "Низкий" };
}

export default async function TasksPage() {
  const session = await getAgentSession();
  const tasks = await getTasks(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto max-w-[1100px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-6">
        <span className="td-eyebrow">Операционка</span>
        <h1 className="mt-2 text-[30px] font-semibold leading-tight text-ink sm:text-[36px]">Задачи</h1>
      </header>

      {tasks.length === 0 ? (
        <div className="rise rise-1 td-shell px-6 py-14 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
            <CheckSquare size={26} weight="duotone" />
          </span>
          <h2 className="text-[20px] font-semibold text-ink">Задач пока нет</h2>
          <p className="mx-auto mt-1.5 max-w-[340px] text-[13.5px] leading-relaxed text-ink-2">
            Задачи создаются внутри кейса и собираются здесь в общий список.
          </p>
        </div>
      ) : (
        <ul className="rise rise-1 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <li className="hidden grid-cols-[minmax(260px,1fr)_180px_150px_110px_100px_28px] gap-3 border-b border-line bg-surface-2/55 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 md:grid">
            <span>Задача</span>
            <span>Клиент</span>
            <span>Дедлайн</span>
            <span>Статус</span>
            <span>Приоритет</span>
            <span />
          </li>
          {tasks.map((task) => {
            const status = taskStatus(task);
            return (
              <li key={task.id} className="border-b border-line last:border-0">
                <Link href={`/agent/cases/${task.leadId}`} className="group grid gap-2 px-4 py-3.5 transition-colors hover:bg-surface-2/60 md:grid-cols-[minmax(260px,1fr)_180px_150px_110px_100px_28px] md:items-center md:gap-3">
                  <span className="truncate text-[14px] font-semibold text-ink">{task.title}</span>
                  <span className="truncate text-[13.5px] text-ink-2">{task.clientName}</span>
                  <span className="text-[12.5px] text-ink-3">{task.dueAt ? dateTime(task.dueAt) : "Без срока"}</span>
                  <span className={`w-fit rounded-full border px-2.5 py-1 text-[12px] font-medium ${status.cls}`}>{status.label}</span>
                  <span className="text-[12.5px] font-medium text-ink-2">{status.priority}</span>
                  <ArrowRight size={15} className="hidden text-ink-3 transition-colors group-hover:text-accent md:block" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
