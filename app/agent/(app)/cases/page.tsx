import Link from "next/link";
import NewCaseSheet from "./NewCaseSheet";
import { Plus, ArrowRight, CalendarDots, Clock, Briefcase, Warning } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { phone as fmtPhone } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { type Stage, STAGE_DOT, STAGE_ORDER, NEXT_ACTION, deriveStage, stageIndex, relTime } from "@/lib/case";

type CaseRow = {
  id: number;
  name: string;
  phone: string;
  stage: Stage;
  progress: number;
  nextAction: string;
  lastActivityLabel: string;
  priority: "Высокий" | "Средний" | "Низкий";
  urgent: boolean;
  stale: boolean;
  nextMeetingAt: number | null;
  nextMeetingTime: string;
  nextMeetingDate: string;
};

type CasesData = {
  active: CaseRow[];
  todayMeetings: CaseRow[];
  upcoming: CaseRow[];
  inactive: CaseRow[];
};

const DAY = 86_400_000;

const fmtTime = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const fmtDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });

async function getCases(agentId: number): Promise<CasesData> {
  const empty: CasesData = { active: [], todayMeetings: [], upcoming: [], inactive: [] };
  try {
    const leads = await prisma.clientLead.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      include: {
        meetings: {
          orderBy: { scheduledAt: "desc" },
          select: {
            scheduledAt: true,
            quotes: { select: { id: true } },
            orders: { select: { status: true } },
          },
        },
      },
    });

    const now = Date.now();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndMs = todayEnd.getTime();

    const rows: CaseRow[] = leads.map((lead) => {
      const quotesLen = lead.meetings.reduce((n, m) => n + m.quotes.length, 0);
      const orders = lead.meetings.flatMap((m) => m.orders);
      const stage = deriveStage(orders, quotesLen, lead.meetings.length);

      const future = lead.meetings
        .map((m) => m.scheduledAt?.getTime())
        .filter((t): t is number => !!t && t >= now)
        .sort((a, b) => a - b);
      const nextMeetingAt = future[0] ?? null;

      const lastActivity = lead.meetings.reduce<number>(
        (max, m) => (m.scheduledAt && m.scheduledAt.getTime() > max ? m.scheduledAt.getTime() : max),
        lead.createdAt.getTime(),
      );

      const soon = nextMeetingAt ? nextMeetingAt - now < DAY : false;
      const stale = stage !== "Завершено" && now - lastActivity > 7 * DAY;

      return {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        stage,
        progress: stageIndex(stage) + 1,
        nextAction: NEXT_ACTION[stage],
        lastActivityLabel: relTime(lastActivity, now),
        priority: soon || stale ? "Высокий" : stage === "Оплата" || stage === "Договор" ? "Средний" : "Низкий",
        urgent: soon || stale,
        stale,
        nextMeetingAt,
        nextMeetingTime: nextMeetingAt ? fmtTime.format(nextMeetingAt) : "",
        nextMeetingDate: nextMeetingAt ? fmtDate.format(nextMeetingAt) : "",
      };
    });

    const sorted = [...rows].sort((a, b) => (a.urgent === b.urgent ? 0 : a.urgent ? -1 : 1));
    const active = sorted.filter((c) => c.stage !== "Завершено");

    const todayMeetings = rows
      .filter((c) => c.nextMeetingAt !== null && c.nextMeetingAt <= todayEndMs)
      .sort((a, b) => (a.nextMeetingAt! - b.nextMeetingAt!));
    const upcoming = rows
      .filter((c) => c.nextMeetingAt !== null && c.nextMeetingAt > todayEndMs)
      .sort((a, b) => (a.nextMeetingAt! - b.nextMeetingAt!))
      .slice(0, 4);
    const inactive = active.filter((c) => c.stale).slice(0, 5);

    return { active, todayMeetings, upcoming, inactive };
  } catch {
    return empty;
  }
}

type OverdueTask = { id: number; title: string; leadId: number; leadName: string };

async function getOverdueTasks(agentId: number): Promise<OverdueTask[]> {
  if (!agentId) return [];
  try {
    const tasks = await prisma.task.findMany({
      where: { agentId, completedAt: null, dueAt: { lt: new Date() } },
      orderBy: { dueAt: "asc" },
      take: 8,
      select: { id: true, title: true, leadId: true, lead: { select: { name: true } } },
    });
    return tasks.map((t) => ({ id: t.id, title: t.title, leadId: t.leadId, leadName: t.lead.name }));
  } catch {
    return [];
  }
}

export default async function CasesPage() {
  const session = await getAgentSession();
  const [{ active, todayMeetings, inactive }, overdueTasks] = await Promise.all([
    getCases(session?.agentId ?? 0),
    getOverdueTasks(session?.agentId ?? 0),
  ]);
  const attention = [...active.filter((c) => c.urgent), ...overdueTasks.map((t) => ({
    id: t.leadId,
    name: t.leadName,
    phone: "",
    stage: "Лид" as Stage,
    progress: 1,
    nextAction: t.title,
    lastActivityLabel: "просрочено",
    priority: "Высокий" as const,
    urgent: true,
    stale: false,
    nextMeetingAt: null,
    nextMeetingTime: "",
    nextMeetingDate: "",
  }))].slice(0, 6);

  return (
    <div className="td-page mx-auto max-w-[1280px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-7 flex items-end justify-between gap-4">
        <div>
          <span className="td-eyebrow">Рабочий центр</span>
          <h1 className="td-display mt-2.5 text-[34px] text-ink sm:text-[42px]">Кейсы</h1>
        </div>
        <NewCaseSheet />
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_310px]">
        <section className="rise rise-1">
          {active.length === 0 ? (
            <div className="td-shell px-6 py-14 text-center">
              <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
                <Briefcase size={26} weight="duotone" />
              </span>
              <h2 className="text-[20px] font-semibold text-ink">Активных кейсов нет</h2>
              <p className="mx-auto mt-1.5 max-w-[320px] text-[13.5px] leading-relaxed text-ink-2">
                Заведите кейс — клиент, документы, смета и оплата будут в одном рабочем контуре.
              </p>
              <Link href="/agent/leads/new" className={buttonClasses({ className: "mt-5" })}>
                <Plus size={15} weight="bold" /> Новый кейс
              </Link>
            </div>
          ) : (
            <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
              <li className="hidden grid-cols-[minmax(210px,1.05fr)_132px_150px_minmax(180px,1fr)_96px_86px_28px] gap-3 border-b border-line bg-surface-2/55 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 lg:grid">
                <span>Клиент</span>
                <span>Телефон</span>
                <span>Этап</span>
                <span>Следующее действие</span>
                <span>Активность</span>
                <span>Приоритет</span>
                <span />
              </li>
              {active.map((c) => (
                <li key={c.id} className="border-b border-line last:border-0">
                  <Link href={`/agent/cases/${c.id}`} className="group grid gap-2 px-4 py-3 transition-colors hover:bg-surface-2/60 lg:grid-cols-[minmax(210px,1.05fr)_132px_150px_minmax(180px,1fr)_96px_86px_28px] lg:items-center lg:gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={c.name} urgent={c.urgent} />
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] font-semibold text-ink">{c.name}</span>
                        <span className="mt-0.5 block text-[12px] text-ink-3 lg:hidden">{fmtPhone(c.phone)}</span>
                      </span>
                    </span>
                    <span className="tnum hidden truncate text-[13px] text-ink-2 lg:block">{fmtPhone(c.phone)}</span>
                    <StageProgress stage={c.stage} progress={c.progress} />
                    <span className="min-w-0 truncate text-[13px] text-ink-2">{c.nextAction}</span>
                    <span className="text-[12px] text-ink-3">{c.lastActivityLabel}</span>
                    <PriorityBadge priority={c.priority} />
                    <ArrowRight size={15} className="hidden text-ink-3 transition-colors group-hover:text-accent lg:block" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="rise rise-2 space-y-5">
          <RailBlock icon={<CalendarDots size={15} weight="duotone" />} title="Сегодня">
            {todayMeetings.length === 0 ? (
              <RailEmpty>Встреч на сегодня нет</RailEmpty>
            ) : (
              todayMeetings.map((c) => (
                <Link key={c.id} href={`/agent/cases/${c.id}`} className="group flex items-center justify-between gap-2 rounded-[10px] px-2 py-2 text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{c.name}</span>
                    <span className="block text-[11.5px] text-ink-3">{c.nextAction}</span>
                  </span>
                  <span className="tnum flex-shrink-0 text-ink-3">{c.nextMeetingTime}</span>
                </Link>
              ))
            )}
          </RailBlock>

          <RailBlock icon={<Warning size={15} weight="duotone" className="text-danger" />} title="Требуют внимания">
            {attention.length === 0 ? (
              <RailEmpty>Критичных кейсов нет</RailEmpty>
            ) : (
              attention.map((c, i) => (
                <Link key={`${c.id}-${i}`} href={`/agent/cases/${c.id}`} className="group block rounded-[10px] px-2 py-2 text-[13px] transition-colors hover:bg-surface-2 hover:text-ink">
                  <span className="block truncate font-medium text-ink">{c.name}</span>
                  <span className="block truncate text-[12px] text-ink-3">{c.nextAction}</span>
                </Link>
              ))
            )}
          </RailBlock>

          <RailBlock icon={<Clock size={15} weight="duotone" />} title="Без движения">
            {inactive.length === 0 ? (
              <RailEmpty>Зависших кейсов нет</RailEmpty>
            ) : (
              inactive.map((c) => (
                <Link key={c.id} href={`/agent/cases/${c.id}`} className="group flex items-center justify-between gap-2 rounded-[10px] px-2 py-2 text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
                  <span className="truncate">{c.name}</span>
                  <span className="flex-shrink-0 text-ink-3">{c.lastActivityLabel}</span>
                </Link>
              ))
            )}
          </RailBlock>
        </aside>
      </div>
    </div>
  );
}

function Avatar({ name, urgent }: { name: string; urgent?: boolean }) {
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-accent-soft text-[12.5px] font-semibold text-accent ${urgent ? "ring-2 ring-danger/30" : ""}`}
    >
      {initials}
    </span>
  );
}

function RailBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="td-shell p-4">
      <div className="mb-2 flex items-center gap-2 text-ink-3">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em]">{title}</span>
      </div>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

function RailEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-1.5 text-[13px] text-ink-3">{children}</p>;
}

function StageProgress({ stage, progress }: { stage: Stage; progress: number }) {
  const percent = Math.round((progress / STAGE_ORDER.length) * 100);
  return (
    <span className="grid min-w-0 gap-1">
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2">
        <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[stage]}`} />
        {stage}
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-label={`Прогресс ${percent}%`}>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
      </span>
    </span>
  );
}

function PriorityBadge({ priority }: { priority: CaseRow["priority"] }) {
  const tone = priority === "Высокий" ? "danger" : priority === "Средний" ? "warning" : "neutral";
  return <Badge tone={tone}>{priority}</Badge>;
}
