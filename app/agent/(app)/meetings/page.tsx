import Link from "next/link";
import { CalendarDots, Plus } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buttonClasses } from "@/components/ui/Button";
import { deriveStage, NEXT_ACTION } from "@/lib/case";
import { EventRow, type CalEvent } from "./EventRow";

type DayGroup = { key: string; label: string; events: CalEvent[] };

const fmtTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" });

async function getCalendar(agentId: number): Promise<DayGroup[]> {
  try {
    const meetings = await prisma.meeting.findMany({
      where: { agentId, scheduledAt: { not: null } },
      orderBy: { scheduledAt: "asc" },
      select: {
        id: true, status: true, scheduledAt: true,
        lead: {
          select: {
            id: true, name: true, phone: true,
            meetings: { select: { id: true, quotes: { select: { versions: { select: { id: true } } } }, orders: { select: { id: true, status: true, signature: { select: { signedAt: true } } } } } },
            _count: { select: { documents: true } },
          },
        },
      },
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
      const lead = m.lead;
      const orders = lead.meetings.flatMap((mm) => mm.orders);
      const versionsLen = lead.meetings.flatMap((mm) => mm.quotes.flatMap((q) => q.versions)).length;
      const stage = deriveStage(orders, versionsLen, lead.meetings.length);
      groups.get(key)!.events.push({
        id: m.id,
        leadId: lead.id,
        name: lead.name,
        phone: lead.phone,
        time: fmtTime.format(d),
        status: m.status,
        past: d.getTime() < now,
        stage,
        nextAction: NEXT_ACTION[stage],
        hasQuote: versionsLen > 0,
        docCount: lead._count.documents,
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
  const events = days.flatMap((day) => day.events);
  const todayCount = days.find((day) => day.label === "Сегодня")?.events.length ?? 0;
  const needQuoteCount = events.filter((event) => !event.hasQuote && !event.past).length;
  const activeCount = events.filter((event) => !event.past).length;

  return (
    <div className="td-page mx-auto w-full max-w-[1040px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="td-eyebrow">Расписание</span>
          <h1 className="td-display mt-2 text-[30px] text-ink sm:text-[36px]">Календарь</h1>
        </div>
        <Link href="/agent/meetings/new" data-tour="meetings-new" className={buttonClasses({ size: "sm", className: "self-start flex-shrink-0" })}>
          <Plus size={15} weight="bold" /> <span className="hidden sm:inline">Новое событие</span><span className="sm:hidden">Событие</span>
        </Link>
      </header>

      {events.length > 0 && (
        <div className="rise mb-4 grid min-w-0 grid-cols-3 gap-2">
          <Stat label="Сегодня" value={String(todayCount)} />
          <Stat label="Активные" value={String(activeCount)} />
          <Stat label="Без сметы" value={String(needQuoteCount)} />
        </div>
      )}

      {days.length === 0 ? (
        <div className="rise rise-1 td-shell px-6 py-16 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
            <CalendarDots size={26} weight="duotone" />
          </span>
          <h2 className="text-[20px] font-semibold text-ink">Событий пока нет</h2>
          <p className="mx-auto mt-1.5 max-w-[320px] text-[13px] leading-relaxed text-ink-2">
            Запланируйте встречу или звонок — увидите их здесь по дням.
          </p>
          <Link href="/agent/meetings/new" className={buttonClasses({ className: "mt-5" })}>
            <Plus size={15} weight="bold" /> Новое событие
          </Link>
        </div>
      ) : (
        <div className="rise rise-1 min-w-0 space-y-5">
          {days.map((day) => (
            <section key={day.key} className="td-shell min-w-0 overflow-hidden">
              <h2 className="border-b border-line bg-surface-2/55 px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-ink-3 first-letter:uppercase">{day.label}</h2>
              <ul>
                {day.events.map((e) => <EventRow key={e.id} event={e} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-line bg-surface px-3 py-2.5 shadow-[var(--hl-top)]">
      <div className="truncate text-[11px] font-medium text-ink-3">{label}</div>
      <div className="tnum mt-0.5 truncate text-[15px] font-semibold text-ink">{value}</div>
    </div>
  );
}
