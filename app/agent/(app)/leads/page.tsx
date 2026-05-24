import Link from "next/link";
import { Users, Plus, ArrowRight, CalendarBlank } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Lead = { id: number; name: string; phone: string; context: string | null; source: string; createdAt: Date; meetings: { status: string }[] };

async function getLeads(agentId: number): Promise<Lead[]> {
  try {
    return await prisma.clientLead.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      include: { meetings: { select: { status: true } } },
    });
  } catch {
    return [];
  }
}

function getStatus(meetings: { status: string }[]) {
  if (meetings.length === 0) return { label: "Новый", dot: "bg-slate-500" };
  if (meetings.some((m) => m.status === "COMPLETED")) return { label: "Завершён", dot: "bg-emerald-500" };
  return { label: "В работе", dot: "bg-amber-400" };
}

function formatDate(d: Date) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(d));
}

const SOURCE_LABELS: Record<string, string> = {
  agent: "Агент",
  telegram: "Telegram",
  form: "Форма",
  referral: "Рекомендация",
};

export default async function LeadsPage() {
  const session = await getAgentSession();
  const leads = await getLeads(session?.agentId ?? 0);

  return (
    <div className="p-7 max-w-[1100px]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-1">CRM</p>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Лиды</h1>
        </div>
        <Link
          href="/agent/leads/new"
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-semibold rounded-lg transition-colors"
        >
          <Plus size={14} weight="bold" /> Новый лид
        </Link>
      </div>

      <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
        {leads.length === 0 ? (
          <div className="py-16 text-center">
            <Users size={36} className="text-slate-700 mx-auto mb-3" />
            <p className="text-[13px] text-slate-500">
              Лидов пока нет —{" "}
              <Link href="/agent/leads/new" className="text-blue-500 hover:text-blue-400">добавьте первого</Link>
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-5 py-3">Клиент</th>
                <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Телефон</th>
                <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Источник</th>
                <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Встречи</th>
                <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Статус</th>
                <th className="text-right text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-5 py-3">Добавлен</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const st = getStatus(lead.meetings);
                return (
                  <tr key={lead.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025] transition-colors group">
                    <td className="px-5 py-3">
                      <Link href={`/agent/leads/${lead.id}`} className="text-[13.5px] font-semibold text-slate-200 hover:text-white transition-colors">
                        {lead.name}
                      </Link>
                      {lead.context && (
                        <p className="text-[11px] text-slate-600 mt-0.5 truncate max-w-[200px]">{lead.context}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-[13px] text-slate-400 tabular-nums">{lead.phone}</td>
                    <td className="px-3 py-3 text-[12px] text-slate-500">{SOURCE_LABELS[lead.source] ?? lead.source}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500">
                        <CalendarBlank size={12} className="text-slate-600" />
                        {lead.meetings.length}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-[12px] text-slate-600 tabular-nums">{formatDate(lead.createdAt)}</td>
                    <td className="pr-4">
                      <Link href={`/agent/leads/${lead.id}`}>
                        <ArrowRight size={14} className="text-slate-700 group-hover:text-slate-400 transition-colors" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
