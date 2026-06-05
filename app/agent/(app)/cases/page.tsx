import Link from "next/link";
import { Plus, ArrowRight, CalendarDots, Clock, Briefcase } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { type Stage, STAGE_DOT, NEXT_ACTION, deriveStage, relTime } from "@/lib/case";

type CaseRow = {
  id: number;
  name: string;
  stage: Stage;
  nextAction: string;
  lastActivityLabel: string;
  urgent: boolean;
  stale: boolean;
  nextMeetingAt: number | null;
  nextMeetingTime: string;
  nextMeetingDate: string;
};

type CasesData = {
  active: CaseRow[];
  todayMeetings: CaseRow[];
  upcoming: CaseRow[];
  inactive: CaseRow[];
};

const DAY = 86_400_000;

const fmtTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const fmtDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

async function getCases(agentId: number): Promise<CasesData> {
  const empty: CasesData = { active: [], todayMeetings: [], upcoming: [], inactive: [] };
  try {
    const leads = await prisma.clientLead.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      include: {
        meetings: {
          orderBy: { scheduledAt: "desc" },
          select: {
            scheduledAt: true,
            quotes: { select: { id: true } },
            orders: { select: { status: true } },
          },
        },
      },
    });

    const now = Date.now();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndMs = todayEnd.getTime();

    const rows: CaseRow[] = leads.map((lead) => {
      const quotesLen = lead.meetings.reduce((n, m) => n + m.quotes.length, 0);
      const orders = lead.meetings.flatMap((m) => m.orders);
      const stage = deriveStage(orders, quotesLen, lead.meetings.length);

      const future = lead.meetings
        .map((m) => m.scheduledAt?.getTime())
        .filter((t): t is number => !!t && t >= now)
        .sort((a, b) => a - b);
      const nextMeetingAt = future[0] ?? null;

      const lastActivity = lead.meetings.reduce<number>(
        (max, m) => (m.scheduledAt && m.scheduledAt.getTime() > max ? m.scheduledAt.getTime() : max),
        lead.createdAt.getTime(),
      );

      const soon = nextMeetingAt ? nextMeetingAt - now < DAY : false;
      const stale = stage !== "Завершено" && now - lastActivity > 7 * DAY;

      return {
        id: lead.id,
        name: lead.name,
        stage,
        nextAction: NEXT_ACTION[stage],
        lastActivityLabel: relTime(lastActivity, now),
        urgent: soon || stale,
        stale,
        nextMeetingAt,
        nextMeetingTime: nextMeetingAt ? fmtTime.format(nextMeetingAt) : "",
        nextMeetingDate: nextMeetingAt ? fmtDate.format(nextMeetingAt) : "",
      };
    });

    const sorted = [...rows].sort((a, b) => (a.urgent === b.urgent ? 0 : a.urgent ? -1 : 1));
    const active = sorted.filter((c) => c.stage !== "Завершено");

    const todayMeetings = rows
      .filter((c) => c.nextMeetingAt !== null && c.nextMeetingAt <= todayEndMs)
      .sort((a, b) => (a.nextMeetingAt! - b.nextMeetingAt!));
    const upcoming = rows
      .filter((c) => c.nextMeetingAt !== null && c.nextMeetingAt > todayEndMs)
      .sort((a, b) => (a.nextMeetingAt! - b.nextMeetingAt!))
      .slice(0, 4);
    const inactive = active.filter((c) => c.stale).slice(0, 5);

    return { active, todayMeetings, upcoming, inactive };
  } catch {
    return empty;
  }
}

export default async function CasesPage() {
  const session = await getAgentSession();
  const { active, todayMeetings, upcoming, inactive } = await getCases(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto max-w-[1240px] px-4 py-7 sm:px-7 sm:py-10">
      <header className="rise mb-7 flex items-end justify-between gap-4">
        <div>
          <span className="td-eyebrow">Рабочий стол</span>
          <h1 className="mt-3 font-serif text-[32px] leading-tight text-ink sm:text-[40px]">Дела</h1>
        </div>
        <Link
          href="/agent/leads/new"
          className="inline-flex min-h-11 flex-shrink-0 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent transition-colors duration-200 hover:bg-accent-hover"
        >
          <Plus size={15} weight="bold" /> <span className="hidden sm:inline">Новое дело</span><span className="sm:hidden">Дело</span>
        </Link>
      </header>

      <div className="grid gap-7 lg:grid-cols-[1fr_300px]">
        <section className="rise rise-1">
          {active.length === 0 ? (
            <div className="td-shell px-6 py-16 text-center">
              <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
                <Briefcase size={26} weight="duotone" />
              </span>
              <h2 className="font-serif text-[20px] text-ink">Активных дел нет</h2>
              <p className="mx-auto mt-1.5 max-w-[320px] text-[13.5px] leading-relaxed text-ink-2">
                Заведите дело — клиент, документы, смета и оплата в одном месте.
              </p>
              <Link href="/agent/leads/new" className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-accent-hover">
                <Plus size={15} weight="bold" /> Новое дело
              </Link>
            </div>
          ) : (
            <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
              {active.map((c) => (
                <li key={c.id} className="border-b border-line last:border-0">
                  <Link href={`/agent/cases/${c.id}`} className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-2/60 sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2.5">
                        <span className="truncate text-[15px] font-semibold text-ink">{c.name}</span>
                        <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-[12px] text-ink-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[c.stage]}`} />{c.stage}
                        </span>
                        {c.urgent && <span className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide text-danger">Срочно</span>}
                      </span>
                      <span className="mt-1 block truncate text-[13px] text-ink-2">{c.nextAction}</span>
                    </span>
                    <span className="hidden flex-shrink-0 text-right text-[12px] text-ink-3 sm:block">{c.lastActivityLabel}</span>
                    <ArrowRight size={15} className="flex-shrink-0 text-ink-3 transition-colors group-hover:text-accent" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="rise rise-2 space-y-7">
          <RailBlock icon={<CalendarDots size={15} weight="duotone" />} title="Сегодня">
            {todayMeetings.length === 0 ? (
              <RailEmpty>Встреч на сегодня нет</RailEmpty>
            ) : (
              todayMeetings.map((c) => (
                <Link key={c.id} href={`/agent/cases/${c.id}`} className="flex items-center justify-between gap-2 py-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink">
                  <span className="truncate">{c.name}</span>
                  <span className="tnum flex-shrink-0 text-ink-3">{c.nextMeetingTime}</span>
                </Link>
              ))
            )}
          </RailBlock>

          <RailBlock icon={<Clock size={15} weight="duotone" />} title="Ближайшие">
            {upcoming.length === 0 ? (
              <RailEmpty>Ничего не запланировано</RailEmpty>
            ) : (
              upcoming.map((c) => (
                <Link key={c.id} href={`/agent/cases/${c.id}`} className="flex items-center justify-between gap-2 py-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink">
                  <span className="truncate">{c.name}</span>
                  <span className="tnum flex-shrink-0 text-ink-3">{c.nextMeetingDate}</span>
                </Link>
              ))
            )}
          </RailBlock>

          {inactive.length > 0 && (
            <RailBlock icon={<Clock size={15} weight="duotone" />} title="Без движения">
              {inactive.map((c) => (
                <Link key={c.id} href={`/agent/cases/${c.id}`} className="flex items-center justify-between gap-2 py-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink">
                  <span className="truncate">{c.name}</span>
                  <span className="flex-shrink-0 text-ink-3">{c.lastActivityLabel}</span>
                </Link>
              ))}
            </RailBlock>
          )}
        </aside>
      </div>
    </div>
  );
}

function RailBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-ink-3">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em]">{title}</span>
      </div>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

function RailEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-1.5 text-[13px] text-ink-3">{children}</p>;
}
