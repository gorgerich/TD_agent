import Link from "next/link";
import { CalendarDots, Plus } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession, type AgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { EventRow, type CalEvent } from "./EventRow";
import { getCanonicalCases } from "@/lib/caseReadModel";
import { zonedDateKey } from "@/lib/operationsReadModel";

type DayGroup = { key: string; label: string; events: CalEvent[] };

function dateFormatter(timezone: string) {
  return {
    time: new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    day: new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone,
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  };
}

async function getCalendar(session: AgentSession): Promise<DayGroup[]> {
  const projectionNow = new Date();
  const format = dateFormatter(session.timezone);
  const todayKey = zonedDateKey(projectionNow, session.timezone);
  const canonicalCases = await getCanonicalCases(session, projectionNow);
  const canonicalByLead = new Map(canonicalCases.map((item) => [item.leadId, item]));
  const ownerFilter = session.role === "AGENT" ? { ownerMembershipId: session.membershipId } : {};
  const meetings = await prisma.meeting.findMany({
    where: {
      organizationId: session.organizationId,
      ...ownerFilter,
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: 500,
    select: {
      id: true,
      operationalStatus: true,
      scheduledAt: true,
      outcome: true,
      channel: true,
      location: true,
      caseId: true,
      lead: { select: { id: true, name: true, phone: true } },
    },
  });

  const groups = new Map<string, DayGroup>();
  const ensureGroup = (key: string, label: string) => {
    if (!groups.has(key)) groups.set(key, { key, label, events: [] });
    return groups.get(key)!;
  };
  const tentative = ensureGroup("tentative", "Нужно согласовать время");

  for (const meeting of meetings) {
    const canonical = canonicalByLead.get(meeting.lead.id);
    if (!canonical) continue;
    const scheduledAt = meeting.scheduledAt;
    const key = scheduledAt ? zonedDateKey(scheduledAt, session.timezone) : "tentative";
    const group = scheduledAt
      ? ensureGroup(key, key === todayKey ? "Сегодня" : format.day.format(scheduledAt))
      : tentative;
    group.events.push({
      id: meeting.id,
      caseId: meeting.caseId,
      leadId: meeting.lead.id,
      kind: "meeting",
      name: meeting.lead.name,
      phone: meeting.lead.phone,
      time: scheduledAt ? format.time.format(scheduledAt) : "Время не назначено",
      sortKey: scheduledAt?.getTime() ?? Number.MIN_SAFE_INTEGER,
      status: meeting.operationalStatus,
      past: Boolean(scheduledAt && scheduledAt < projectionNow && !["COMPLETED", "NO_SHOW", "CANCELLED"].includes(meeting.operationalStatus)),
      stage: canonical.legacyStage,
      nextAction: canonical.nextAction.label,
      hasQuote: canonical.quoteVersionCount > 0,
      docCount: canonical.documents.uploaded,
      channel: meeting.channel,
      place: meeting.location,
      outcome: meeting.outcome,
    });
  }

  for (const canonical of canonicalCases) {
    const ceremonyAt = canonical.ceremonyAt;
    if (!ceremonyAt || ceremonyAt < projectionNow) continue;
    const key = zonedDateKey(ceremonyAt, session.timezone);
    ensureGroup(key, key === todayKey ? "Сегодня" : format.day.format(ceremonyAt)).events.push({
      id: canonical.leadId,
      caseId: canonical.caseId,
      leadId: canonical.leadId,
      kind: "ceremony",
      name: `Церемония · ${canonical.name}`,
      phone: canonical.phone,
      time: format.time.format(ceremonyAt),
      sortKey: ceremonyAt.getTime(),
      status: "CEREMONY",
      past: false,
      stage: canonical.legacyStage,
      nextAction: canonical.nextAction.label,
      hasQuote: canonical.quoteVersionCount > 0,
      docCount: canonical.documents.uploaded,
      place: null,
    });
  }

  if (tentative.events.length === 0) groups.delete("tentative");
  const days = [...groups.values()];
  for (const day of days) day.events.sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name, "ru"));
  days.sort((a, b) => {
    if (a.key === "tentative") return -1;
    if (b.key === "tentative") return 1;
    return (a.events[0]?.sortKey ?? 0) - (b.events[0]?.sortKey ?? 0);
  });
  return days;
}

export default async function CalendarPage() {
  const session = await getAgentSession();
  if (!session) return null;
  const days = await getCalendar(session);
  const events = days.flatMap((day) => day.events);
  const todayCount = days.find((day) => day.label === "Сегодня")?.events.length ?? 0;
  const tentativeCount = events.filter((event) => event.status === "TENTATIVE").length;
  const outcomeCount = events.filter((event) => event.past && event.kind === "meeting").length;

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise td-page-header mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] font-semibold text-accent">Расписание · {session.timezone}</p>
          <h1 className="td-display mt-1 text-[30px] text-ink sm:text-[38px]">Календарь</h1>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">
            Встречи, церемонии и обязательные результаты. Время показано в 24-часовом формате.
          </p>
        </div>
        {session.role !== "ADMIN" && (
          <Link href="/agent/meetings/new" data-tour="meetings-new" className={buttonClasses({ size: "sm", className: "self-start flex-shrink-0" })}>
            <Plus size={15} weight="bold" /> Новая встреча
          </Link>
        )}
      </header>

      {events.length > 0 && (
        <div className="rise mb-4 grid min-w-0 grid-cols-3 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-xs),var(--hl-top)]">
          <Stat label="Сегодня" value={String(todayCount)} />
          <Stat label="Без времени" value={String(tentativeCount)} />
          <Stat label="Нужен итог" value={String(outcomeCount)} />
        </div>
      )}

      {days.length === 0 ? (
        <EmptyState
          icon={<CalendarDots size={28} weight="fill" />}
          eyebrow="Календарь"
          title="Встреч пока нет"
          description="Создайте встречу из кейса или календаря. Если время ещё не согласовано, встреча останется в отдельной очереди без выдуманной даты."
          primaryAction={session.role === "ADMIN" ? undefined : { label: "Новая встреча", href: "/agent/meetings/new" }}
          secondaryAction={{ label: "Открыть кейсы", href: "/agent/cases" }}
        />
      ) : (
        <div className="rise rise-1 min-w-0 space-y-5">
          {days.map((day) => (
            <section key={day.key} className="td-entity-list min-w-0">
              <h2 className="border-b border-line bg-surface-2/55 px-4 py-2.5 text-[12px] font-semibold text-ink-3 first-letter:uppercase">{day.label}</h2>
              <ul>
                {day.events.map((event) => <EventRow key={`${event.kind}-${event.id}`} event={event} />)}
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
    <div className="min-w-0 border-l border-line px-4 py-3 first:border-l-0">
      <div className="tnum truncate text-[20px] font-semibold leading-none text-ink">{value}</div>
      <div className="mt-1 truncate text-[11px] font-medium text-ink-3">{label}</div>
    </div>
  );
}
