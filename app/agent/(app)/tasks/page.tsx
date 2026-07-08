import { CheckSquare } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/EmptyState";
import { TasksClientList, type TaskListRow } from "./TasksClientList";

async function getTasks(agentId: number): Promise<TaskListRow[]> {
  if (!agentId) return [];
  try {
    const tasks = await prisma.task.findMany({
      where: { agentId },
      orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
      include: { lead: { select: { id: true, name: true } } },
      take: 160,
    });
    return tasks.map((task) => ({
      id: task.id,
      leadId: task.lead.id,
      title: task.title,
      clientName: task.lead.name,
      dueAt: task.dueAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
    }));
  } catch {
    return [];
  }
}

export default async function TasksPage() {
  const session = await getAgentSession();
  const tasks = await getTasks(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-5">
        <span className="td-eyebrow">Работа по кейсам</span>
        <h1 className="td-display mt-1.5 text-[30px] text-ink sm:text-[38px]">Задачи</h1>
      </header>

      {tasks.length === 0 ? (
        <EmptyState
          icon={<CheckSquare size={28} weight="fill" />}
          eyebrow="Задачи"
          title="Активных задач пока нет"
          description="Задачи создаются внутри кейса и автоматически собираются здесь по группам: сегодня, просрочены, позже и выполненные."
          primaryAction={{ label: "Открыть кейсы", href: "/agent/cases" }}
        />
      ) : (
        <TasksClientList initialTasks={tasks} />
      )}
    </div>
  );
}
