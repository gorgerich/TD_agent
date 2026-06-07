import Link from "next/link";
import { CalendarDots, Plus, ArrowRight } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Запланирована",
  IN_PROGRESS: "Идёт",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
};
const STATUS_TONE = {
  SCHEDULED: "info",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
} as const;
const STATUS_BAR: Record<string, string> = {
  SCHEDULED: "before:bg-info",
  IN_PROGRESS: "before:bg-warning",
  COMPLETED: "before:bg-success",
  CANCELLED: "before:bg-ink-3",
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
        <Link href="/agent/meetings/new" data-tour="meetings-new" className={buttonClasses({ className: "flex-shrink-0" })}>
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
          <Link href="/agent/meetings/new" className={buttonClasses({ className: "mt-5" })}>
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
                    <Link
                      href={`/agent/cases/${e.leadId}`}
                      className={`group relative flex items-center gap-3.5 py-3 pl-5 pr-4 transition-colors hover:bg-surface-2/50 before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full ${STATUS_BAR[e.status] ?? "before:bg-ink-3"} ${e.past ? "opacity-55" : ""}`}
                    >
                      <span className="tnum w-12 flex-shrink-0 text-[15px] font-semibold text-ink">{e.time}</span>
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-ink">{e.name}</span>
                      <Badge tone={STATUS_TONE[e.status as keyof typeof STATUS_TONE] ?? "neutral"} dot>{STATUS_LABELS[e.status] ?? e.status}</Badge>
                      <ArrowRight size={16} className="flex-shrink-0 text-ink-3 transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
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
