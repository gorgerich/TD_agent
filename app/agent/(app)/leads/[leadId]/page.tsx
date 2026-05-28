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
  SCHEDULED: "bg-info",
  IN_PROGRESS: "bg-warning",
  COMPLETED: "bg-success",
  CANCELLED: "bg-ink-3",
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
    <div className="mx-auto max-w-[900px] px-4 py-7 sm:px-7 sm:py-9">
      <Link href="/agent/leads" className="mb-6 inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={14} /> Все клиенты
      </Link>

      <header className="rise mb-7 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Клиент №{lead.id}</p>
          <h1 className="font-serif text-[26px] text-ink sm:text-[30px]">{lead.name}</h1>
        </div>
        <Link
          href={`/agent/meetings/new?leadId=${lead.id}`}
          className="inline-flex flex-shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-accent-hover"
        >
          <Plus size={15} weight="bold" /> <span className="hidden sm:inline">Назначить встречу</span><span className="sm:hidden">Встреча</span>
        </Link>
      </header>

      <div className="rise rise-1 mb-7 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-soft sm:p-6">
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
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

      <section className="rise rise-2">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">Встречи</p>
          <Link href={`/agent/meetings/new?leadId=${lead.id}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent transition-colors hover:text-accent-hover">
            <Plus size={12} weight="bold" /> Добавить
          </Link>
        </div>

        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-soft">
          {lead.meetings.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <CalendarDots size={28} className="mx-auto mb-2 text-ink-3" />
              <p className="text-[13px] text-ink-2">
                Встреч нет —{" "}
                <Link href={`/agent/meetings/new?leadId=${lead.id}`} className="text-accent hover:text-accent-hover">назначить</Link>
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {lead.meetings.map((m) => (
                <li key={m.id}>
                  <Link href={`/agent/meetings/${m.id}`} className="group flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 sm:px-5">
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-ink transition-colors group-hover:text-accent">Встреча №{m.id}</span>
                      <span className="tnum mt-0.5 block text-[12px] text-ink-3">{formatShort(m.scheduledAt)}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[m.status] ?? "bg-ink-3"}`} />
                        <span className="hidden sm:inline">{STATUS_LABELS[m.status] ?? m.status}</span>
                      </span>
                      <ArrowRight size={15} className="text-ink-3 transition-colors group-hover:text-accent" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function InfoField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p className={`text-[14px] text-ink ${mono ? "font-mono tnum" : "font-medium"}`}>{value}</p>
    </div>
  );
}
