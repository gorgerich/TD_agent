import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDots, ArrowRight, Plus } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getLead(leadId: number, agentId: number) {
  try {
    return await prisma.clientLead.findFirst({
      where: { id: leadId, agentId },
      include: {
        meetings: {
          orderBy: { scheduledAt: "desc" },
          select: { id: true, status: true, scheduledAt: true, cobrowseCode: true },
        },
      },
    });
  } catch {
    return null;
  }
}

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(d));
}

function formatShort(d: Date | null | undefined) {
  if (!d) return "дата не указана";
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

const SOURCE_LABELS: Record<string, string> = {
  agent: "Агент",
  telegram: "Telegram",
  form: "Форма",
  referral: "Рекомендация",
};

export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const session = await getAgentSession();
  const lead = await getLead(Number(leadId), session?.agentId ?? 0);

  if (!lead) notFound();

  return (
    <div className="p-7 max-w-[900px]">
      <Link href="/agent/leads" className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-400 transition-colors mb-6">
        <ArrowLeft size={13} /> Все лиды
      </Link>

      <div className="flex items-start justify-between mb-7">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-1">Лид #{lead.id}</p>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">{lead.name}</h1>
        </div>
        <Link
          href={`/agent/meetings/new?leadId=${lead.id}`}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-semibold rounded-lg transition-colors"
        >
          <Plus size={14} weight="bold" /> Назначить встречу
        </Link>
      </div>

      {/* Info card */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-6 mb-6">
        <div className="grid grid-cols-2 gap-x-10 gap-y-5">
          <InfoField label="Телефон" value={lead.phone} mono />
          <InfoField label="Источник" value={SOURCE_LABELS[lead.source] ?? lead.source} />
          <InfoField label="Добавлен" value={formatDate(lead.createdAt)} />
          <InfoField label="Встреч" value={String(lead.meetings.length)} />
          {lead.context && (
            <div className="col-span-2">
              <InfoField label="Контекст" value={lead.context} />
            </div>
          )}
        </div>
      </div>

      {/* Meetings */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-slate-500">
            Встречи
          </p>
          <Link href={`/agent/meetings/new?leadId=${lead.id}`} className="text-[12px] text-blue-500 hover:text-blue-400 flex items-center gap-1 transition-colors">
            <Plus size={11} weight="bold" /> Добавить
          </Link>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
          {lead.meetings.length === 0 ? (
            <div className="py-10 text-center">
              <CalendarDots size={28} className="text-slate-700 mx-auto mb-2" />
              <p className="text-[13px] text-slate-600">
                Встреч нет —{" "}
                <Link href={`/agent/meetings/new?leadId=${lead.id}`} className="text-blue-500 hover:text-blue-400">назначить</Link>
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-5 py-3">Встреча</th>
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Дата</th>
                  <th className="text-left text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 px-3 py-3">Статус</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lead.meetings.map((m) => (
                  <tr key={m.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025] transition-colors group">
                    <td className="px-5 py-3">
                      <Link href={`/agent/meetings/${m.id}`} className="text-[13.5px] font-medium text-slate-200 hover:text-white transition-colors">
                        Встреча #{m.id}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-slate-500 tabular-nums">{formatShort(m.scheduledAt)}</td>
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
    </div>
  );
}

function InfoField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 mb-1">{label}</p>
      <p className={`text-[13.5px] text-slate-300 ${mono ? "font-mono" : "font-medium"}`}>{value}</p>
    </div>
  );
}
