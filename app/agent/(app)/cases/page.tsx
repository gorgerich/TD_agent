import Link from "next/link";
import NewCaseSheet from "./NewCaseSheet";
import { Plus, ArrowRight, CalendarDots, Briefcase, Warning } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
  soon: boolean;
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
        soon,
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
  const [{ active, todayMeetings }, overdueTasks] = await Promise.all([
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
    soon: false,
    stale: false,
    nextMeetingAt: null,
    nextMeetingTime: "",
    nextMeetingDate: "",
  }))].slice(0, 6);

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-7 flex items-end justify-between gap-4">
        <div>
          <span className="td-eyebrow">Рабочий центр</span>
          <h1 className="td-display mt-2.5 text-[34px] text-ink sm:text-[42px]">Кейсы</h1>
          <p className="mt-2 text-[13px] text-ink-2">
            <span className="font-semibold text-ink">{active.length}</span> в работе
            {attention.length > 0 && <> · <span className="font-semibold text-danger">{attention.length}</span> требуют внимания</>}
          </p>
        </div>
        <NewCaseSheet />
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
        <section className="rise rise-1 min-w-0">
          {active.length === 0 ? (
            <div className="td-shell px-6 py-12 text-center">
              <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full icon-3d text-accent">
                <Briefcase size={26} weight="duotone" />
              </span>
              <h2 className="td-display text-[24px] text-ink">Здесь будут ваши кейсы</h2>
              <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-relaxed text-ink-2">
                Каждый кейс ведёт клиента от первого контакта до оплаты - встречи, смета, документы и сроки в одном месте.
              </p>
              <div className="mx-auto mt-7 grid max-w-[560px] gap-2.5 text-left sm:grid-cols-3">
                {[
                  ["1", "Заведите клиента", "Имя, телефон и вводные по семье."],
                  ["2", "Встреча и смета", "Соберите смету и покажите клиенту."],
                  ["3", "Документы и оплата", "Загрузите файлы, ведите задачи и сроки."],
                ].map(([n, title, sub]) => (
                  <div key={n} className="rounded-[12px] border border-line bg-surface-2/45 p-3.5">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-[12px] font-bold text-on-accent">{n}</span>
                    <p className="mt-2 text-[13px] font-semibold text-ink">{title}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{sub}</p>
                  </div>
                ))}
              </div>
              <Link href="/agent/leads/new" className={buttonClasses({ size: "lg", className: "mt-7" })}>
                <Plus size={16} weight="bold" /> Создать первый кейс
              </Link>
            </div>
          ) : (
            <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-soft),var(--hl-top)]">
              {active.map((c) => {
                const bar = c.soon ? "before:bg-accent" : c.stale ? "before:bg-warning" : "before:bg-transparent";
                return (
                  <li key={c.id} className="border-b border-line last:border-0">
                    <Link
                      href={`/agent/cases/${c.id}`}
                      className={`group relative flex items-center gap-3.5 py-3.5 pl-5 pr-4 transition-[background-color,box-shadow] duration-150 hover:z-10 hover:bg-surface-2/60 hover:shadow-[0_8px_24px_-16px_rgba(40,30,18,0.3)] before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full ${bar}`}
                    >
                      <Avatar name={c.name} urgent={c.urgent} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-semibold text-ink">{c.name}</span>
                          <StageChip stage={c.stage} />
                          {c.soon ? (
                            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-accent">Встреча скоро</span>
                          ) : c.stale ? (
                            <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">Без движения</span>
                          ) : null}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-2">
                          <ArrowRight size={12} weight="bold" className="flex-shrink-0 text-ink-3" />
                          <span className="truncate">{c.nextAction}</span>
                        </span>
                      </span>
                      <span className="hidden flex-shrink-0 flex-col items-end gap-2 pr-1 sm:flex">
                        <Stepper progress={c.progress} />
                        <span className="text-[11px] text-ink-3">{c.lastActivityLabel}</span>
                      </span>
                      <ArrowRight size={16} className="flex-shrink-0 text-ink-3 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-accent" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="rise rise-2 min-w-0 space-y-5">
          <RailBlock icon={<CalendarDots size={15} weight="duotone" />} title="Сегодня">
            {todayMeetings.length === 0 ? (
              <RailEmpty>Встреч на сегодня нет</RailEmpty>
            ) : (
              todayMeetings.map((c) => (
                <Link key={c.id} href={`/agent/cases/${c.id}`} className="group flex items-center justify-between gap-2 rounded-[10px] px-2 py-2 text-[13px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{c.name}</span>
                    <span className="block text-[11px] text-ink-3">{c.nextAction}</span>
                  </span>
                  <span className="tnum flex-shrink-0 text-ink-3">{c.nextMeetingTime}</span>
                </Link>
              ))
            )}
          </RailBlock>

          <RailBlock icon={<Warning size={15} weight="duotone" className="text-danger" />} title="Просроченные задачи">
            {overdueTasks.length === 0 ? (
              <RailEmpty>Просроченных задач нет</RailEmpty>
            ) : (
              overdueTasks.map((t, i) => (
                <Link key={`${t.leadId}-${i}`} href={`/agent/cases/${t.leadId}`} className="group block rounded-[10px] px-2 py-2 text-[13px] transition-colors hover:bg-surface-2">
                  <span className="block truncate font-medium text-ink">{t.title}</span>
                  <span className="block truncate text-[12px] text-ink-3">{t.leadName}</span>
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
      style={{ background: "radial-gradient(125% 125% at 30% 22%, color-mix(in srgb, var(--color-accent-soft) 62%, #fff), var(--color-accent-soft))" }}
      className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-[12px] font-semibold text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_1px_2px_rgba(40,30,18,0.14)] ring-1 ring-accent/12 transition-transform duration-200 ease-out group-hover:scale-[1.07] ${urgent ? "ring-2 ring-danger/30" : ""}`}
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

function StageChip({ stage }: { stage: Stage }) {
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-1.5 text-[12px] font-medium text-ink-2">
      <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[stage]}`} />
      {stage}
    </span>
  );
}

// Мини-степпер этапов (6 сегментов) - заполнено до текущего, активный ярче.
function Stepper({ progress }: { progress: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Этап ${progress} из ${STAGE_ORDER.length}`}>
      {STAGE_ORDER.map((stage, i) => (
        <span key={stage} className={`h-1 w-4 rounded-full ${i < progress ? "bg-accent" : "bg-surface-2"}`} />
      ))}
    </span>
  );
}
