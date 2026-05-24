import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, ArrowSquareOut, Copy } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import MeetingActions from "./MeetingActions";

async function getMeeting(meetingId: number, agentId: number) {
  try {
    return await prisma.meeting.findFirst({
      where: { id: meetingId, agentId },
      include: {
        lead: { select: { id: true, name: true, phone: true } },
        quotes: { orderBy: { id: "desc" }, take: 1, include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } } },
      },
    });
  } catch {
    return null;
  }
}

function formatDate(d: Date | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
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

export default async function MeetingDetailPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  const session = await getAgentSession();
  const meeting = await getMeeting(Number(meetingId), session?.agentId ?? 0);

  if (!meeting) notFound();

  const cobrowseCode = meeting.cobrowseCode ?? `DEV-${meeting.id}`;
  const lastVersion = meeting.quotes[0]?.versions[0];

  return (
    <div className="p-7 max-w-[900px]">
      <Link href="/agent/meetings" className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-400 transition-colors mb-6">
        <ArrowLeft size={13} /> Все встречи
      </Link>

      {/* Top strip */}
      <div className="flex items-start justify-between gap-6 mb-7">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-1">Встреча #{meeting.id}</p>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">{meeting.lead.name}</h1>
          <p className="text-[13px] text-slate-500 mt-1">{formatDate(meeting.scheduledAt)}</p>
        </div>
        {/* Co-browse code */}
        <div className="flex-shrink-0 bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 text-right min-w-[160px]">
          <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-slate-600 mb-2">Co-browse код</p>
          <p className="text-2xl font-bold text-blue-300 tracking-[0.18em] font-mono tabular-nums">{cobrowseCode}</p>
          <p className="text-[10px] text-slate-600 mt-1.5">/co/{cobrowseCode}</p>
        </div>
      </div>

      {/* Info grid */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-6 mb-5">
        <div className="grid grid-cols-3 gap-x-10 gap-y-5">
          <InfoField label="Клиент">
            <Link href={`/agent/leads/${meeting.lead.id}`} className="text-[13.5px] font-medium text-blue-400 hover:text-blue-300 transition-colors">
              {meeting.lead.name}
            </Link>
          </InfoField>
          <InfoField label="Телефон">
            <span className="text-[13.5px] text-slate-300 font-mono">{meeting.lead.phone}</span>
          </InfoField>
          <InfoField label="Статус">
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-300">
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[meeting.status] ?? "bg-slate-600"}`} />
              {STATUS_LABELS[meeting.status] ?? meeting.status}
            </span>
          </InfoField>
          {lastVersion && (
            <InfoField label="Последняя смета">
              <span className="text-[13.5px] text-slate-300 tabular-nums font-medium">
                {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format((lastVersion.total ?? 0) / 100)}
              </span>
            </InfoField>
          )}
        </div>
      </div>

      {/* Actions row */}
      <div className="flex gap-3 mb-5">
        <Link
          href={`/agent/meeting/${meeting.id}/quote`}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-[13px] font-semibold rounded-lg transition-colors"
        >
          <FileText size={15} /> Открыть конструктор сметы
        </Link>
        <a
          href={`/co/${cobrowseCode}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.09] text-slate-300 text-[13px] font-semibold rounded-lg transition-colors border border-white/[0.07]"
        >
          <ArrowSquareOut size={15} /> Co-browse
        </a>
        <CopyCodeButton code={cobrowseCode} />
      </div>

      <MeetingActions meetingId={meeting.id} currentStatus={meeting.status} />
    </div>
  );
}

function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-600 mb-1.5">{label}</p>
      {children}
    </div>
  );
}

// Client component just for copy button
import CopyCodeButton from "./CopyCodeButton";
