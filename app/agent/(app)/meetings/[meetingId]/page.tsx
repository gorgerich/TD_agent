import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, ArrowSquareOut, Check } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buttonClasses } from "@/components/ui/Button";
import MeetingActions from "./MeetingActions";
import CopyCodeButton from "./CopyCodeButton";

async function getMeeting(meetingId: number, agentId: number) {
  try {
    return await prisma.meeting.findFirst({
      where: { id: meetingId, agentId },
      include: {
        lead: { select: { id: true, name: true, phone: true } },
        quotes: { orderBy: { id: "desc" }, take: 1, include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } } },
        orders: { select: { id: true } },
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
  SCHEDULED: "bg-info",
  IN_PROGRESS: "bg-warning",
  COMPLETED: "bg-success",
  CANCELLED: "bg-ink-3",
};

export default async function MeetingDetailPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const { meetingId } = await params;
  const session = await getAgentSession();
  const meeting = await getMeeting(Number(meetingId), session?.agentId ?? 0);

  if (!meeting) notFound();

  const cobrowseCode = meeting.cobrowseCode ?? `DEV-${meeting.id}`;
  const lastVersion = meeting.quotes[0]?.versions[0];
  const hasQuote = Boolean(lastVersion);
  const hasOrder = meeting.orders.length > 0;
  const completed = meeting.status === "COMPLETED";

  return (
    <div className="mx-auto max-w-[900px] px-4 py-7 sm:px-7 sm:py-9">
      <Link href="/agent/meetings" className="mb-6 inline-flex items-center gap-1.5 text-[12px] text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={14} /> Все встречи
      </Link>

      {/* Top strip */}
      <div className="rise mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="td-eyebrow mb-1.5">Встреча №{meeting.id}</p>
          <h1 className="td-display text-[26px] text-ink sm:text-[30px]">{meeting.lead.name}</h1>
          <p className="tnum mt-1 text-[13px] text-ink-2">{formatDate(meeting.scheduledAt)}</p>
        </div>
        <div className="flex-shrink-0 rounded-[var(--radius-card)] border border-accent/20 bg-accent-soft px-5 py-4 sm:min-w-[170px] sm:text-right">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent/80">Код co-browse</p>
          <p className="tnum font-mono text-[24px] font-semibold tracking-[0.16em] text-accent">{cobrowseCode}</p>
          <p className="mt-1.5 text-[10px] text-ink-3">/co/{cobrowseCode}</p>
        </div>
      </div>

      {/* Воронка действий по сделке */}
      <DealFunnel
        meetingId={meeting.id}
        hasQuote={hasQuote}
        hasOrder={hasOrder}
        completed={completed}
        cancelled={meeting.status === "CANCELLED"}
      />

      {/* Info grid */}
      <div className="rise rise-1 mb-5 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-soft sm:p-6">
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
          <InfoField label="Клиент">
            <Link href={`/agent/cases/${meeting.lead.id}`} className="text-[14px] font-medium text-accent transition-colors hover:text-accent-hover">
              {meeting.lead.name}
            </Link>
          </InfoField>
          <InfoField label="Телефон">
            <span className="tnum font-mono text-[14px] text-ink">{meeting.lead.phone}</span>
          </InfoField>
          <InfoField label="Статус">
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-ink">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[meeting.status] ?? "bg-ink-3"}`} />
              {STATUS_LABELS[meeting.status] ?? meeting.status}
            </span>
          </InfoField>
          {lastVersion && (
            <InfoField label="Последняя смета">
              <span className="tnum text-[14px] font-medium text-ink">
                {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format((lastVersion.total ?? 0) / 100)}
              </span>
            </InfoField>
          )}
        </div>
      </div>

      {/* Actions row */}
      <div className="rise rise-2 mb-5 flex flex-wrap gap-2.5">
        <Link href={`/agent/meetings/${meeting.id}/quote`} className={buttonClasses()}>
          <FileText size={16} /> Конструктор сметы
        </Link>
        <a href={`/co/${cobrowseCode}`} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary" })}>
          <ArrowSquareOut size={16} /> Co-browse
        </a>
        <CopyCodeButton code={cobrowseCode} />
      </div>

      <MeetingActions meetingId={meeting.id} currentStatus={meeting.status} />
    </div>
  );
}

function DealFunnel({
  meetingId,
  hasQuote,
  hasOrder,
  completed,
  cancelled,
}: {
  meetingId: number;
  hasQuote: boolean;
  hasOrder: boolean;
  completed: boolean;
  cancelled: boolean;
}) {
  const stages = [
    { label: "Лид", done: true, href: undefined as string | undefined },
    { label: "Встреча", done: true, href: undefined },
    { label: "Смета", done: hasQuote, href: `/agent/meetings/${meetingId}/quote` },
    { label: "Подписание", done: hasOrder, href: undefined },
    { label: "Заказ", done: completed, href: undefined },
  ];
  // Текущий этап — первый незавершённый (если сделка не отменена).
  const currentIndex = cancelled ? -1 : stages.findIndex((s) => !s.done);

  return (
    <nav aria-label="Этапы сделки" className="rise rise-1 mb-5 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-4 shadow-soft sm:px-5">
      <ol className="flex items-center gap-1 overflow-x-auto">
        {stages.map((stage, i) => {
          const active = i === currentIndex;
          const done = stage.done;
          const node = (
            <span className="flex flex-col items-center gap-1.5 px-1.5">
              <span
                className={[
                  "grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors",
                  done
                    ? "bg-accent text-on-accent"
                    : active
                      ? "border-2 border-accent bg-accent-soft text-accent"
                      : "border border-line-strong bg-surface text-ink-3",
                ].join(" ")}
              >
                {done ? <Check size={13} weight="bold" /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-[11px] font-medium ${active ? "text-ink" : done ? "text-ink-2" : "text-ink-3"}`}>
                {stage.label}
              </span>
            </span>
          );
          return (
            <li key={stage.label} className="flex flex-1 items-center">
              {stage.href ? (
                <Link href={stage.href} className="rounded-lg transition-opacity hover:opacity-80">{node}</Link>
              ) : (
                node
              )}
              {i < stages.length - 1 && (
                <span className={`mx-0.5 h-px flex-1 ${stages[i + 1].done || done ? "bg-accent/45" : "bg-line"}`} aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function InfoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</p>
      {children}
    </div>
  );
}
