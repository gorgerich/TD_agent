import Link from "next/link";
import { CalendarDots, Users, ArrowRight, Plus, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { CurrencyRub } from "@phosphor-icons/react/dist/ssr/CurrencyRub";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { money, dateTime } from "@/lib/format";

type RecentMeeting = { id: number; status: string; scheduledAt: Date | null; lead: { name: string } };

type Stats = {
  todayMeetings: number;
  activeLeads: number;
  accrued: number;
  recentMeetings: RecentMeeting[];
  leadsTotal: number;
  meetingsTotal: number;
  quotesTotal: number;
};

async function getStats(agentId: number): Promise<Stats> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  try {
    const [todayMeetings, activeLeads, commissionSum, recentMeetings, leadsTotal, meetingsTotal, quotesTotal] = await Promise.all([
      prisma.meeting.count({ where: { agentId, scheduledAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.clientLead.count({
        where: { agentId, meetings: { none: { status: { in: ["COMPLETED", "CANCELLED"] } } } },
      }),
      prisma.commission.aggregate({ where: { agentId, status: "ACCRUED" }, _sum: { amount: true } }),
      prisma.meeting.findMany({
        where: { agentId },
        orderBy: { scheduledAt: "desc" },
        take: 8,
        include: { lead: { select: { name: true } } },
      }),
      prisma.clientLead.count({ where: { agentId } }),
      prisma.meeting.count({ where: { agentId } }),
      prisma.quote.count({ where: { meeting: { agentId } } }),
    ]);
    return {
      todayMeetings,
      activeLeads,
      accrued: (commissionSum._sum.amount ?? 0) / 100,
      recentMeetings,
      leadsTotal,
      meetingsTotal,
      quotesTotal,
    };
  } catch {
    return { todayMeetings: 0, activeLeads: 0, accrued: 0, recentMeetings: [], leadsTotal: 0, meetingsTotal: 0, quotesTotal: 0 };
  }
}

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

function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status] ?? "bg-ink-3"}`} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export default async function DashboardPage() {
  const session = await getAgentSession();
  const agentId = session?.agentId ?? 0;
  const { todayMeetings, activeLeads, accrued, recentMeetings, leadsTotal, meetingsTotal, quotesTotal } = await getStats(agentId);
  const showQuickStart = !(leadsTotal > 0 && meetingsTotal > 0 && quotesTotal > 0);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="td-page mx-auto max-w-[1240px] px-4 py-7 sm:px-7 sm:py-10">
      <header className="rise mb-7 td-shell" data-tour="greeting">
        <div className="td-core overflow-hidden">
          <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.1fr_0.9fr] lg:p-8">
            <div>
              <span className="td-eyebrow">{today}</span>
              <h1 className="mt-5 max-w-[620px] font-serif text-[34px] leading-[1.06] text-ink sm:text-[44px]">
                {greeting}{session?.name ? `, ${session.name.split(" ")[0]}` : ""}
              </h1>
              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-2">Встречи сегодня: {todayMeetings}</span>
                <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-2">Клиенты в работе: {activeLeads}</span>
                <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-2">К выплате: {money(accrued)}</span>
              </div>
            </div>
            <div className="grid content-between gap-4 rounded-[20px] bg-accent px-5 py-5 text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-on-accent/58">Быстро</p>
                <p className="mt-2 font-serif text-[24px] leading-tight">Новая работа</p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Link
                  href="/agent/leads/new"
                  className="group inline-flex min-h-11 items-center gap-2 rounded-full bg-on-accent px-4 py-2 text-[13px] font-semibold text-accent transition-transform duration-200 hover:scale-[1.01] active:scale-[0.98]"
                >
                  <Plus size={16} weight="bold" /> Новый клиент
                </Link>
                <Link
                  href="/agent/meetings/new"
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-on-accent/12 px-4 py-2 text-[13px] font-semibold text-on-accent ring-1 ring-on-accent/16 transition-colors hover:bg-on-accent/18"
                >
                  <CalendarDots size={16} /> Встреча
                </Link>
              </div>
            </div>
          </div>
        </div>
      </header>

      {showQuickStart && (
        <QuickStart
          leadsDone={leadsTotal > 0}
          meetingsDone={meetingsTotal > 0}
          quotesDone={quotesTotal > 0}
        />
      )}

      {/* Stats */}
      <section className="rise rise-1 mb-7 grid grid-cols-1 gap-4 sm:grid-cols-3" data-tour="stats">
        <StatCard
          icon={<CalendarDots size={18} weight="duotone" />}
          label="Встречи сегодня"
          value={String(todayMeetings)}
          sub="на сегодня"
        />
        <StatCard
          icon={<Users size={18} weight="duotone" />}
          label="Клиенты в работе"
          value={String(activeLeads)}
          sub="без завершённой встречи"
        />
        <StatCard
          icon={<CurrencyRub size={18} weight="duotone" />}
          label="К выплате"
          value={money(accrued)}
          sub="начислено, ожидает выплаты"
          tone="gold"
        />
      </section>

      {/* Quick actions */}
      <section className="rise rise-2 mb-9 flex flex-wrap gap-2.5" data-tour="quick-actions">
        <Link
          href="/agent/leads/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent shadow-[0_14px_30px_-20px_rgba(32,79,67,0.8)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-accent-hover"
        >
          <Plus size={16} weight="bold" /> Новый клиент
        </Link>
        <Link
          href="/agent/meetings/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface/90 px-5 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface"
        >
          <CalendarDots size={16} /> Назначить встречу
        </Link>
        <Link
          href="/agent/leads"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface/90 px-5 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface"
        >
          <Users size={16} /> Все клиенты
        </Link>
      </section>

      {/* Recent meetings */}
      <section className="rise rise-3" data-tour="recent">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="td-eyebrow">Последние встречи</h2>
          <Link href="/agent/meetings" className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent-soft hover:text-accent-hover">
            Все встречи <ArrowRight size={13} />
          </Link>
        </div>

        <div className="td-shell overflow-hidden">
          <div className="td-core overflow-hidden">
          {recentMeetings.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <CalendarDots size={34} className="mx-auto mb-3 text-accent" />
              <p className="text-[14px] text-ink-2">
                Встреч пока нет,{" "}
                <Link href="/agent/meetings/new" className="text-accent hover:text-accent-hover">создайте первую</Link>
              </p>
            </div>
          ) : (
            <>
              {/* Mobile: stacked rows */}
              <ul className="divide-y divide-line sm:hidden">
                {recentMeetings.map((m) => (
                  <li key={m.id}>
                    <Link href={`/agent/meetings/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-4 transition-colors active:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium text-ink">{m.lead.name}</span>
                        <span className="tnum mt-0.5 block text-[12px] text-ink-3">{dateTime(m.scheduledAt)}</span>
                      </span>
                      <StatusPill status={m.status} />
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Desktop: table */}
              <table className="hidden w-full sm:table">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-5 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Клиент</th>
                    <th className="px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Дата</th>
                    <th className="px-4 py-3 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">Статус</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {recentMeetings.map((m) => (
                    <tr key={m.id} className="group border-b border-line last:border-0 transition-colors hover:bg-accent-soft/55">
                      <td className="px-5 py-3.5">
                        <Link href={`/agent/meetings/${m.id}`} className="text-[14px] font-medium text-ink transition-colors group-hover:text-accent">
                          {m.lead.name}
                        </Link>
                      </td>
                      <td className="tnum px-4 py-3.5 text-[12.5px] text-ink-2">{dateTime(m.scheduledAt)}</td>
                      <td className="px-4 py-3.5"><StatusPill status={m.status} /></td>
                      <td className="pr-4">
                        <Link
                          href={`/agent/meetings/${m.id}`}
                          aria-label={`Открыть встречу: ${m.lead.name}`}
                          className="grid h-10 w-10 place-items-center rounded-[10px] transition-colors hover:bg-accent-soft"
                        >
                          <ArrowRight size={15} className="text-ink-3 transition-colors group-hover:text-accent" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          </div>
        </div>
      </section>
    </div>
  );
}

function QuickStart({ leadsDone, meetingsDone, quotesDone }: { leadsDone: boolean; meetingsDone: boolean; quotesDone: boolean }) {
  const steps = [
    { done: leadsDone, title: "Добавьте первого клиента", sub: "Имя и телефон — основа карточки", href: "/agent/leads/new", cta: "Добавить" },
    { done: meetingsDone, title: "Назначьте встречу", sub: "Выезд или звонок с клиентом", href: "/agent/meetings/new", cta: "Назначить" },
    { done: quotesDone, title: "Соберите смету", sub: "Откройте встречу и пройдите конструктор", href: "/agent/meetings", cta: "Открыть" },
  ];
  const completed = steps.filter((s) => s.done).length;
  return (
    <section className="rise rise-1 mb-7 td-shell" aria-label="Быстрый старт">
      <div className="td-core p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <span className="td-eyebrow">Быстрый старт</span>
            <h2 className="mt-2 font-serif text-[22px] leading-tight text-ink">Соберите первую смету за 3 шага</h2>
          </div>
          <span className="tnum flex-shrink-0 rounded-full bg-accent-soft px-3 py-1.5 text-[12px] font-semibold text-accent">{completed} / 3</span>
        </div>
        <ol className="grid gap-2.5 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li
              key={s.href}
              className={`flex flex-col gap-2 rounded-[16px] border p-4 transition-colors ${
                s.done ? "border-success-soft bg-success-soft/40" : "border-line bg-surface"
              }`}
            >
              <span className="flex items-center gap-2">
                {s.done ? (
                  <CheckCircle size={20} weight="fill" className="flex-shrink-0 text-success" />
                ) : (
                  <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-on-accent">{i + 1}</span>
                )}
                <span className={`text-[13.5px] font-semibold ${s.done ? "text-ink-2 line-through" : "text-ink"}`}>{s.title}</span>
              </span>
              <p className="text-[11.5px] leading-snug text-ink-3">{s.sub}</p>
              {!s.done && (
                <Link href={s.href} className="mt-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent transition-colors hover:text-accent-hover">
                  {s.cta} <ArrowRight size={12} weight="bold" />
                </Link>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StatCard({ icon, label, value, sub, tone = "accent" }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: "accent" | "gold" }) {
  const chip = tone === "gold" ? "bg-gold-soft text-gold" : "bg-accent-soft text-accent";
  return (
    <div className="td-shell u-lift">
      <div className="td-core p-5">
      <div className="mb-6 flex items-center justify-between gap-2.5">
        <span className={`grid h-11 w-11 place-items-center rounded-[14px] ${chip}`}>{icon}</span>
        <span className="text-right text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</span>
      </div>
      <div className="tnum font-serif text-[40px] font-semibold leading-none text-ink">{value}</div>
      {sub && <p className="mt-2.5 text-[11.5px] text-ink-3">{sub}</p>}
      </div>
    </div>
  );
}
