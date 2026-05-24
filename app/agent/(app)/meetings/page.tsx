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
  SCHEDULED: "bg-blue-500",
  IN_PROGRESS: "bg-amber-400",
  COMPLETED: "bg-emerald-500",
  CANCELLED: "bg-slate-600",
};

type MeetingRow = { id: number; status: string; scheduledAt: Date | null; lead: { name: string; phone: string } };

async function getMeetings(agentId: number, status?: string): Promise<MeetingRow[]> {
  try {
    return await prisma.meeting.findMany({
      where: { agentId, ...(status ? { status: status as "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" } : {}) },
      orderBy: { scheduledAt: "desc" },
      include: { lead: { select: { name: true, phone: true } } },
    });
  } catch {
    return [];
  }
}

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

const FILTERS = [
  { value: "", label: "Все" },
  { value: "SCHEDULED", label: "Запланированы" },
  { value: "IN_PROGRESS", label: "Идут" },
  { value: "COMPLETED", label: "Завершены" },
  { value: "CANCELLED", label: "Отменены" },
];

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const session = await getAgentSession();
  const meetings = await getMeetings(session?.agentId ?? 0, status);

  return (
    <div className="p-7 max-w-[1100px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-1">CRM</p>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Встречи</h1>
        </div>
        <Link
          href="/agent/meetings/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-semibold rounded-lg transition-colors"
        >
          <Plus size={14} weight="bold" /> Новая встреча
        </Link>
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 mb-5">
        {FILTERS.map((f) => {
          const active = (status ?? "") === f.value;
          return (
            <Link
              key={f.value}
              href={f.value ? `/agent/meetings?status=${f.value}` : "/agent/meetings"}
              className={[
                "px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all",
                active
                  ? "bg-blue-600/[0.2] text-blue-300 border border-blue-600/30"
                  : "bg-white/[0.04] text-slate-500 border border-white/[0.06] hover:text-slate-300 hover:bg-white/[0.06]",
              ].join(" ")}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
        {meetings.length === 0 ? (
          <div className="py-16 text-center">
            <CalendarDots size={36} className="text-slate-700 mx-auto mb-3" />
            <p className="text-[13px] text-slate-500">
              Встреч нет —{" "}
              <Link href="/agent/meetings/new" className="text-blue-500 hover:text-blue-400">назначить</Link>
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-5 py-3">Клиент</th>
                <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Телефон</th>
                <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Дата</th>
                <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Статус</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {meetings.map((m) => (
                <tr key={m.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025] transition-colors group">
                  <td className="px-5 py-3">
                    <Link href={`/agent/meetings/${m.id}`} className="text-[13.5px] font-semibold text-slate-200 hover:text-white transition-colors">
                      {m.lead.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-[13px] text-slate-400 tabular-nums">{m.lead.phone}</td>
                  <td className="px-3 py-3 text-[12px] text-slate-500 tabular-nums">{formatDate(m.scheduledAt)}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[m.status] ?? "bg-slate-600"}`} />
                      {STATUS_LABELS[m.status] ?? m.status}
                    </span>
                  </td>
                  <td className="pr-4">
                    <Link href={`/agent/meetings/${m.id}`}>
                      <ArrowRight size={14} className="text-slate-700 group-hover:text-slate-400 transition-colors" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
