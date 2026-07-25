import { Suspense } from "react";
import { getAgentSession } from "@/lib/auth";
import { getOperationsQueue, type OperationsQueue } from "@/lib/operationsReadModel";
import { TasksClientList } from "./TasksClientList";

type QueueResult =
  | { queue: OperationsQueue; error: null; canMutate: boolean }
  | { queue: null; error: string; canMutate: false };

async function loadQueue(): Promise<QueueResult> {
  const session = await getAgentSession();
  if (!session) return { queue: null, error: "Сессия завершена. Войдите снова, чтобы открыть рабочий день.", canMutate: false };

  try {
    return { queue: await getOperationsQueue(session), error: null, canMutate: session.role !== "ADMIN" };
  } catch (error) {
    console.error("[tasks] operations queue unavailable", error);
    return {
      queue: null,
      error: "Не удалось загрузить рабочий день. Данные не скрыты: повторите запрос после восстановления связи.",
      canMutate: false,
    };
  }
}

async function TasksContent() {
  const result = await loadQueue();

  return (
    <>
      <header className="td-page-header mb-5 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-accent">Рабочий день</p>
          <h1 className="td-display mt-1 text-[30px] leading-tight text-ink sm:text-[38px]">Сегодня</h1>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">
            Сначала просроченное, затем дела на сегодня. Каждая строка объясняет действие и ожидаемый результат.
          </p>
        </div>
        {result.queue && (
          <p className="text-[12px] text-ink-3">
            Часовой пояс: <span className="font-medium text-ink-2">{result.queue.timezone}</span>
          </p>
        )}
      </header>

      <TasksClientList initialQueue={result.queue} loadError={result.error} canMutate={result.canMutate} />
    </>
  );
}

function TasksLoading() {
  return (
    <div aria-busy="true" aria-label="Загрузка рабочего дня">
      <div className="h-5 w-28 animate-pulse rounded bg-surface-2" />
      <div className="mt-3 h-10 w-52 animate-pulse rounded bg-surface-2" />
      <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] bg-line sm:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse bg-surface" />)}
      </div>
      <div className="mt-5 h-64 animate-pulse rounded-[var(--radius-card)] bg-surface" />
      <span className="sr-only">Загружаем задачи и встречи</span>
    </div>
  );
}

export default function TasksPage() {
  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-5 sm:px-7 sm:py-8">
      <Suspense fallback={<TasksLoading />}>
        <TasksContent />
      </Suspense>
    </div>
  );
}
