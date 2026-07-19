import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowSquareOut, Briefcase, CalendarBlank, FileText } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession, type AgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buttonClasses } from "@/components/ui/Button";
import MeetingActions from "./MeetingActions";
import CopyCodeButton from "./CopyCodeButton";

async function getMeeting(meetingId: number, session: AgentSession) {
  return prisma.meeting.findFirst({
    where: {
      id: meetingId,
      organizationId: session.organizationId,
      ...(session.role === "AGENT" ? { ownerMembershipId: session.membershipId } : {}),
    },
    include: {
      ownerMembership: { select: { user: { select: { name: true } } } },
      lead: { select: { id: true, name: true, phone: true, ceremonyAt: true } },
      quotes: { orderBy: { id: "desc" }, take: 1, include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } } },
      orders: { select: { id: true } },
    },
  });
}

const STATUS_LABELS: Record<string, string> = {
  TENTATIVE: "Время не согласовано",
  SCHEDULED: "Запланирована",
  CONFIRMED: "Подтверждена",
  COMPLETED: "Завершена",
  NO_SHOW: "Не состоялась",
  CANCELLED: "Отменена",
};

const TYPE_LABELS: Record<string, string> = {
  CONSULTATION: "Консультация",
  FOLLOW_UP: "Повторная встреча",
  DOCUMENT_REVIEW: "Проверка документов",
  CEREMONY_COORDINATION: "Координация церемонии",
  OTHER: "Другая встреча",
};

const CHANNEL_LABELS: Record<string, string> = {
  IN_PERSON: "Лично",
  PHONE: "Телефон",
  VIDEO: "Видео",
  OTHER: "Другой канал",
};

function formatDate(value: Date | null, timezone: string) {
  if (!value) return "Время ещё не согласовано";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export default async function MeetingDetailPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  const session = await getAgentSession();
  if (!session) notFound();
  const parsedMeetingId = Number(meetingId);
  if (!Number.isInteger(parsedMeetingId) || parsedMeetingId <= 0) notFound();
  const meeting = await getMeeting(parsedMeetingId, session);
  if (!meeting) notFound();

  const cobrowseCode = meeting.cobrowseCode ?? `DEV-${meeting.id}`;
  const lastVersion = meeting.quotes[0]?.versions[0];
  const statusLabel = STATUS_LABELS[meeting.operationalStatus] ?? meeting.operationalStatus;
  const terminal = ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(meeting.operationalStatus);

  return (
    <div className="td-page mx-auto max-w-[980px] px-4 py-6 sm:px-7 sm:py-9">
      <Link href="/agent/meetings" className="mb-5 inline-flex min-h-10 items-center gap-1.5 text-[12px] font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft size={14} weight="bold" /> Календарь
      </Link>

      <header className="rise td-page-header mb-5">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-accent">{TYPE_LABELS[meeting.type]} · встреча №{meeting.id}</p>
            <h1 className="td-display mt-1 truncate text-[30px] leading-tight text-ink sm:text-[38px]">{meeting.lead.name}</h1>
            <p className={`tnum mt-2 text-[13px] font-medium ${meeting.operationalStatus === "TENTATIVE" ? "text-warning" : "text-ink-2"}`}>
              {formatDate(meeting.scheduledAt, meeting.timezone)}
            </p>
            <p className="mt-1 text-[11px] text-ink-3">24-часовой формат · {meeting.timezone}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
            <span className={`font-semibold ${meeting.operationalStatus === "NO_SHOW" || meeting.operationalStatus === "CANCELLED" ? "text-danger" : terminal ? "text-success" : "text-ink"}`}>{statusLabel}</span>
            <span className="text-ink-3">Ответственный: {meeting.ownerMembership.user.name ?? "Без имени"}</span>
          </div>
        </div>
      </header>

      {meeting.operationalStatus === "TENTATIVE" && (
        <div role="status" className="rise mb-5 flex items-start gap-3 rounded-[var(--radius-card)] bg-warning-soft px-4 py-3 text-[13px] text-ink-2">
          <CalendarBlank size={18} weight="fill" className="mt-0.5 flex-none text-warning" />
          <span><strong className="text-ink">Время не выдумано.</strong> Согласуйте его с семьёй и сохраните причину изменения ниже.</span>
        </div>
      )}

      {meeting.outcome && (
        <section className="rise mb-5 rounded-[var(--radius-card)] bg-surface px-5 py-4 shadow-[var(--shadow-xs),var(--hl-top)]">
          <p className="text-[11px] font-semibold text-ink-3">Зафиксированный результат</p>
          <p className="mt-2 max-w-[72ch] text-[14px] leading-relaxed text-ink">{meeting.outcome}</p>
          {meeting.outcomeRecordedAt && <p className="mt-2 text-[11px] text-ink-3">{formatDate(meeting.outcomeRecordedAt, meeting.timezone)}</p>}
        </section>
      )}

      <section className="rise rise-1 overflow-hidden rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-xs),var(--hl-top)]">
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Канал" value={CHANNEL_LABELS[meeting.channel] ?? meeting.channel} />
          <Info label="Место" value={meeting.location || "Не указано"} />
          <Info label="Длительность" value={meeting.durationMinutes ? `${meeting.durationMinutes} мин` : "Не указана"} />
          <Info label="Версия" value={`v${meeting.version}`} />
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-4">
          <Link href={`/agent/cases/${meeting.lead.id}?tab=work`} className={buttonClasses({ size: "sm" })}>
            <Briefcase size={15} weight="fill" /> Открыть кейс
          </Link>
          <Link href={`/agent/meetings/${meeting.id}/quote`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
            <FileText size={15} weight="bold" /> Смета{lastVersion ? " · есть версия" : ""}
          </Link>
          <a href={`/co/${cobrowseCode}`} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "ghost", size: "sm" })}>
            <ArrowSquareOut size={15} weight="bold" /> Показ клиенту
          </a>
          <CopyCodeButton code={cobrowseCode} />
        </div>
      </section>

      <MeetingActions
        meetingId={meeting.id}
        currentStatus={meeting.operationalStatus}
        currentVersion={meeting.version}
        scheduledAt={meeting.scheduledAt?.toISOString() ?? null}
        durationMinutes={meeting.durationMinutes}
        timezone={meeting.timezone}
        canMutate={session.role !== "ADMIN"}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3.5">
      <p className="text-[11px] font-medium text-ink-3">{label}</p>
      <p className="mt-1 truncate text-[13px] font-semibold text-ink">{value}</p>
    </div>
  );
}
