import Link from "next/link";
import { CalendarDots, Users, CurrencyDollar, ArrowRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type RecentMeeting = { id: number; status: string; scheduledAt: Date | null; lead: { name: string } };

async function getStats(agentId: number): Promise<{ todayMeetings: number; activeLeads: number; accrued: number; recentMeetings: RecentMeeting[] }> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  try {
    const [todayMeetings, activeLeads, commissionSum, recentMeetings] = await Promise.all([
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
    ]);
    return {
      todayMeetings,
      activeLeads,
      accrued: (commissionSum._sum.amount ?? 0) / 100,
      recentMeetings,
    };
  } catch {
    return { todayMeetings: 0, activeLeads: 0, accrued: 0, recentMeetings: [] };
  }
}

function formatMoney(rubles: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(rubles);
}

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
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
  const { todayMeetings, activeLeads, accrued, recentMeetings } = await getStats(agentId);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-7 sm:px-7 sm:py-9">
      {/* Header */}
      <header className="rise mb-8">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">{today}</p>
        <h1 className="font-serif text-[26px] text-ink sm:text-[30px]">
          {greeting}{session?.name ? `, ${session.name.split(" ")[0]}` : ""}
        </h1>
      </header>

      {/* Stats */}
      <section className="rise rise-1 mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          icon={<CalendarDots size={18} weight="duotone" />}
          label="Встречи сегодня"
          value={String(todayMeetings)}
          sub="на сегодня"
        />
        <StatCard
          icon={<Users size={18} weight="duotone" />}
          label="Лиды в работе"
          value={String(activeLeads)}
          sub="без завершённой встречи"
        />
        <StatCard
          icon={<CurrencyDollar size={18} weight="duotone" />}
          label="К выплате"
          value={formatMoney(accrued)}
          sub="начислено, ожидает выплаты"
        />
      </section>

      {/* Quick actions */}
      <section className="rise rise-2 mb-9 flex flex-wrap gap-2.5">
        <Link
          href="/agent/leads/new"
          className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-accent-hover"
        >
          <Plus size={16} weight="bold" /> Новый лид
        </Link>
        <Link
          href="/agent/meetings/new"
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          <CalendarDots size={16} /> Назначить встречу
        </Link>
        <Link
          href="/agent/leads"
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-[13.5px] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          <Users size={16} /> Все лиды
        </Link>
      </section>

      {/* Recent meetings */}
      <section className="rise rise-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">Последние встречи</h2>
          <Link href="/agent/meetings" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent transition-colors hover:text-accent-hover">
            Все встречи <ArrowRight size={13} />
          </Link>
        </div>

        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-soft">
          {recentMeetings.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <CalendarDots size={30} className="mx-auto mb-3 text-ink-3" />
              <p className="text-[13.5px] text-ink-2">
                Встреч пока нет —{" "}
                <Link href="/agent/meetings/new" className="text-accent hover:text-accent-hover">создайте первую</Link>
              </p>
            </div>
          ) : (
            <>
              {/* Mobile: stacked rows */}
              <ul className="divide-y divide-line sm:hidden">
                {recentMeetings.map((m) => (
                  <li key={m.id}>
                    <Link href={`/agent/meetings/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors active:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium text-ink">{m.lead.name}</span>
                        <span className="tnum mt-0.5 block text-[12px] text-ink-3">{formatDate(m.scheduledAt)}</span>
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
                    <tr key={m.id} className="group border-b border-line last:border-0 transition-colors hover:bg-surface-2">
                      <td className="px-5 py-3.5">
                        <Link href={`/agent/meetings/${m.id}`} className="text-[14px] font-medium text-ink transition-colors group-hover:text-accent">
                          {m.lead.name}
                        </Link>
                      </td>
                      <td className="tnum px-4 py-3.5 text-[12.5px] text-ink-2">{formatDate(m.scheduledAt)}</td>
                      <td className="px-4 py-3.5"><StatusPill status={m.status} /></td>
                      <td className="pr-4">
                        <Link href={`/agent/meetings/${m.id}`} aria-label="Открыть встречу">
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
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-2 text-accent">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</span>
      </div>
      <div className="tnum text-[30px] font-semibold leading-none tracking-tight text-ink">{value}</div>
      {sub && <p className="mt-2 text-[11.5px] text-ink-3">{sub}</p>}
    </div>
  );
}
