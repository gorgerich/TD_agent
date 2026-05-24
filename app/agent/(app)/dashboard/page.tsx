import Link from "next/link";
import { CalendarDots, Users, CurrencyDollar, ArrowRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getStats(agentId: number): Promise<{ todayMeetings: number; activeLeads: number; accrued: number; recentMeetings: RecentMeeting[] }> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  try {
    const [todayMeetings, activeLeads, commissionSum, recentMeetings] = await Promise.all([
      prisma.meeting.count({
        where: { agentId, scheduledAt: { gte: todayStart, lte: todayEnd } },
      }),
      prisma.clientLead.count({
        where: {
          agentId,
          meetings: { none: { status: { in: ["COMPLETED", "CANCELLED"] } } },
        },
      }),
      prisma.commission.aggregate({
        where: { agentId, status: "ACCRUED" },
        _sum: { amount: true },
      }),
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

type RecentMeeting = { id: number; status: string; scheduledAt: Date | null; lead: { name: string } };

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
  SCHEDULED: "bg-blue-500",
  IN_PROGRESS: "bg-amber-400",
  COMPLETED: "bg-emerald-500",
  CANCELLED: "bg-slate-600",
};

export default async function DashboardPage() {
  const session = await getAgentSession();
  const agentId = session?.agentId ?? 0;
  const { todayMeetings, activeLeads, accrued, recentMeetings } = await getStats(agentId);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const today = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <div className="p-7 max-w-[1200px]">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-1">{today}</p>
        <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
          {greeting}{session?.name ? `, ${session.name.split(" ")[0]}` : ""}
        </h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard
          icon={<CalendarDots size={18} weight="duotone" className="text-blue-400" />}
          label="Встречи сегодня"
          value={todayMeetings}
          sub={today.split(",").slice(-1)[0]?.trim()}
          color="blue"
        />
        <StatCard
          icon={<Users size={18} weight="duotone" className="text-violet-400" />}
          label="Лиды в работе"
          value={activeLeads}
          sub="без завершённой встречи"
          color="violet"
        />
        <StatCard
          icon={<CurrencyDollar size={18} weight="duotone" className="text-emerald-400" />}
          label="К выплате"
          value={formatMoney(accrued)}
          sub="начислено, ожидает выплаты"
          color="emerald"
          isText
        />
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 mb-8">
        <Link
          href="/agent/leads/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-semibold rounded-lg transition-colors"
        >
          <Plus size={15} weight="bold" />
          Новый лид
        </Link>
        <Link
          href="/agent/meetings/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.09] text-slate-300 text-[13px] font-semibold rounded-lg transition-colors border border-white/[0.07]"
        >
          <CalendarDots size={15} />
          Назначить встречу
        </Link>
        <Link
          href="/agent/leads"
          className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.09] text-slate-300 text-[13px] font-semibold rounded-lg transition-colors border border-white/[0.07]"
        >
          <Users size={15} />
          Все лиды
        </Link>
      </div>

      {/* Recent meetings */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[13px] font-semibold text-slate-400 tracking-wide uppercase tracking-[0.06em]">
            Последние встречи
          </h2>
          <Link href="/agent/meetings" className="flex items-center gap-1 text-[12px] text-blue-500 hover:text-blue-400 font-medium transition-colors">
            Все встречи <ArrowRight size={12} />
          </Link>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
          {recentMeetings.length === 0 ? (
            <div className="py-14 text-center">
              <CalendarDots size={32} className="text-slate-700 mx-auto mb-3" />
              <p className="text-[13px] text-slate-600">Встреч пока нет —{" "}
                <Link href="/agent/meetings/new" className="text-blue-500 hover:text-blue-400">создайте первую</Link>
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-5 py-3">Клиент</th>
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Дата</th>
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Статус</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {recentMeetings.map((m, i) => (
                  <tr
                    key={m.id}
                    className={`border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025] transition-colors ${i % 2 === 0 ? "" : ""}`}
                  >
                    <td className="px-5 py-3">
                      <Link href={`/agent/meetings/${m.id}`} className="text-[13.5px] font-medium text-slate-200 hover:text-white transition-colors">
                        {m.lead.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-slate-500 tabular-nums">{formatDate(m.scheduledAt)}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[m.status] ?? "bg-slate-600"}`} />
                        {STATUS_LABELS[m.status] ?? m.status}
                      </span>
                    </td>
                    <td className="pr-4 py-3">
                      <Link href={`/agent/meetings/${m.id}`}>
                        <ArrowRight size={14} className="text-slate-700 hover:text-slate-400 transition-colors" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon, label, value, sub, color, isText,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: "blue" | "violet" | "emerald";
  isText?: boolean;
}) {
  const glow = {
    blue: "shadow-[0_0_0_1px_rgba(59,130,246,0.12)]",
    violet: "shadow-[0_0_0_1px_rgba(139,92,246,0.12)]",
    emerald: "shadow-[0_0_0_1px_rgba(16,185,129,0.12)]",
  }[color];

  return (
    <div className={`bg-white/[0.035] border border-white/[0.07] rounded-xl p-5 ${glow}`}>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <span className="text-[11px] font-semibold tracking-[0.08em] uppercase text-slate-500">{label}</span>
      </div>
      <div className={`${isText ? "text-2xl" : "text-4xl"} font-bold tracking-tight text-slate-100 tabular-nums leading-none mb-2`}>
        {value}
      </div>
      {sub && <p className="text-[11px] text-slate-600">{sub}</p>}
    </div>
  );
}
