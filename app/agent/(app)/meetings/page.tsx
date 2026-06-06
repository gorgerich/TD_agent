import Link from "next/link";
import { CalendarDots, Plus, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Запланирована",
  IN_PROGRESS: "Идёт",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
};
const STATUS_DOT: Record<string, string> = {
  SCHEDULED: "bg-info",
  IN_PROGRESS: "bg-warning",
  COMPLETED: "bg-success",
  CANCELLED: "bg-ink-3",
};

type Event = { id: number; leadId: number; name: string; time: string; status: string; past: boolean };
type DayGroup = { key: string; label: string; events: Event[] };

const fmtTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });

async function getCalendar(agentId: number): Promise<DayGroup[]> {
  try {
    const meetings = await prisma.meeting.findMany({
      where: { agentId, scheduledAt: { not: null } },
      orderBy: { scheduledAt: "asc" },
      select: { id: true, status: true, scheduledAt: true, lead: { select: { id: true, name: true } } },
    });

    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const groups = new Map<string, DayGroup>();

    for (const m of meetings) {
      const d = m.scheduledAt!;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!groups.has(key)) {
        const label = d.getTime() >= todayStart.getTime() && d.getTime() < todayStart.getTime() + 86_400_000
          ? "Сегодня" : fmtDay.format(d);
        groups.set(key, { key, label, events: [] });
      }
      groups.get(key)!.events.push({
        id: m.id,
        leadId: m.lead.id,
        name: m.lead.name,
        time: fmtTime.format(d),
        status: m.status,
        past: d.getTime() < now,
      });
    }
    return [...groups.values()];
  } catch {
    return [];
  }
}

export default async function CalendarPage() {
  const session = await getAgentSession();
  const days = await getCalendar(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto max-w-[1040px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-7 flex items-end justify-between gap-4">
        <div>
          <span className="td-eyebrow">Расписание</span>
          <h1 className="mt-2 text-[30px] font-semibold leading-tight text-ink sm:text-[36px]">Календарь</h1>
        </div>
        <Link
          href="/agent/meetings/new"
          data-tour="meetings-new"
          className="inline-flex min-h-11 flex-shrink-0 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent transition-colors duration-200 hover:bg-accent-hover"
        >
          <Plus size={15} weight="bold" /> <span className="hidden sm:inline">Новое событие</span><span className="sm:hidden">Событие</span>
        </Link>
      </header>

      {days.length === 0 ? (
        <div className="rise rise-1 td-shell px-6 py-16 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
            <CalendarDots size={26} weight="duotone" />
          </span>
          <h2 className="text-[20px] font-semibold text-ink">Событий пока нет</h2>
          <p className="mx-auto mt-1.5 max-w-[320px] text-[13.5px] leading-relaxed text-ink-2">
            Запланируйте встречу или звонок — увидите их здесь по дням.
          </p>
          <Link href="/agent/meetings/new" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-accent-hover">
            <Plus size={15} weight="bold" /> Новое событие
          </Link>
        </div>
      ) : (
        <div className="rise rise-1 space-y-5">
          {days.map((day) => (
            <section key={day.key} className="td-shell overflow-hidden">
              <h2 className="border-b border-line bg-surface-2/55 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3 first-letter:uppercase">{day.label}</h2>
              <ul>
                {day.events.map((e) => (
                  <li key={e.id} className="border-b border-line last:border-0">
                    <Link href={`/agent/cases/${e.leadId}`} className={`group grid gap-2 px-4 py-3 transition-colors hover:bg-surface-2/60 sm:grid-cols-[64px_minmax(220px,1fr)_150px_90px_28px] sm:items-center sm:gap-3 ${e.past ? "opacity-60" : ""}`}>
                      <span className="tnum w-12 flex-shrink-0 text-[13px] font-semibold text-ink">{e.time}</span>
                      <span className="min-w-0 truncate text-[14.5px] font-medium text-ink">{e.name}</span>
                      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[e.status] ?? "bg-ink-3"}`} />{STATUS_LABELS[e.status] ?? e.status}
                      </span>
                      <span className="text-[12.5px] font-medium text-accent">Кейс</span>
                      <ArrowRight size={15} className="flex-shrink-0 text-ink-3 transition-colors group-hover:text-accent" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
