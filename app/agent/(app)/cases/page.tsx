import { Link } from "next-view-transitions";
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
  ceremonyAt: number | null;
  ceremonyLabel: string;       // «10 июн, 11:00»
  hoursToCeremony: number | null;
  ceremonySoon: boolean;       // церемония в ближайшие 48 ч — высший приоритет
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

      // Церемония — настоящий дедлайн кейса (важнее встреч)
      const ceremonyAt = lead.ceremonyAt && stage !== "Завершено" ? lead.ceremonyAt.getTime() : null;
      const hoursToCeremony = ceremonyAt && ceremonyAt > now ? Math.round((ceremonyAt - now) / 3_600_000) : null;
      const ceremonySoon = hoursToCeremony !== null && hoursToCeremony <= 48;

      return {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        stage,
        progress: stageIndex(stage) + 1,
        nextAction: NEXT_ACTION[stage],
        lastActivityLabel: relTime(lastActivity, now),
        priority: ceremonySoon || soon || stale ? "Высокий" : stage === "Оплата" || stage === "Договор" ? "Средний" : "Низкий",
        urgent: ceremonySoon || soon || stale,
        soon,
        stale,
        ceremonyAt,
        ceremonyLabel: ceremonyAt ? `${fmtDate.format(ceremonyAt)}, ${fmtTime.format(ceremonyAt)}` : "",
        hoursToCeremony,
        ceremonySoon,
        nextMeetingAt,
        nextMeetingTime: nextMeetingAt ? fmtTime.format(nextMeetingAt) : "",
        nextMeetingDate: nextMeetingAt ? fmtDate.format(nextMeetingAt) : "",
      };
    });

    // Сортировка дня: ближайшая церемония → срочные → остальные
    const sorted = [...rows].sort((a, b) => {
      if (a.ceremonySoon !== b.ceremonySoon) return a.ceremonySoon ? -1 : 1;
      if (a.ceremonySoon && b.ceremonySoon) return (a.ceremonyAt ?? 0) - (b.ceremonyAt ?? 0);
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return 0;
    });
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
    ceremonyAt: null,
    ceremonyLabel: "",
    hoursToCeremony: null,
    ceremonySoon: false,
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
        <section className="rise rise-1 order-2 min-w-0 lg:order-1">
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
            <ul className="td-entity-list">
              {active.map((c) => {
                const bar = c.ceremonySoon ? "before:bg-danger" : c.soon ? "before:bg-accent" : c.stale ? "before:bg-warning" : "before:bg-transparent";
                return (
                  <li key={c.id} className="border-b border-line last:border-0">
                    <Link
                      href={`/agent/cases/${c.id}`}
                      className={`td-entity-row group relative flex items-center gap-3.5 py-3.5 pl-5 pr-4 before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full ${bar}`}
                    >
                      <Avatar name={c.name} urgent={c.urgent} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[14px] font-semibold text-ink" style={{ viewTransitionName: `case-${c.id}` }}>{c.name}</span>
                          <StageChip stage={c.stage} />
                          {c.ceremonySoon ? (
                            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-danger">Церемония через {c.hoursToCeremony} ч</span>
                          ) : c.soon ? (
                            <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-accent">Встреча скоро</span>
                          ) : c.stale ? (
                            <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">Без движения</span>
                          ) : null}
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-2">
                          <ArrowRight size={12} weight="bold" className="flex-shrink-0 text-ink-3" />
                          <span className="truncate">{c.nextAction}</span>
                          {c.ceremonyLabel && !c.ceremonySoon && (
                            <span className="hidden flex-shrink-0 text-ink-3 sm:inline">· церемония {c.ceremonyLabel}</span>
                          )}
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

        <aside className="rise rise-2 order-1 min-w-0 space-y-5 lg:order-2">
          <RailBlock icon={<CalendarDots size={15} weight="duotone" />} title="Сегодня">
            {todayMeetings.length === 0 ? (
              <RailEmpty>Встреч на сегодня нет</RailEmpty>
            ) : (
              todayMeetings.map((c) => (
                <Link key={c.id} href={`/agent/cases/${c.id}`} className="td-mini-row group flex items-center justify-between gap-2 px-2 py-2 text-[13px] text-ink-2">
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
                <Link key={`${t.leadId}-${i}`} href={`/agent/cases/${t.leadId}`} className="td-mini-row group block px-2 py-2 text-[13px]">
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
            className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-[12px] font-semibold text-accent bg-accent-soft ${urgent ? "ring-2 ring-danger/30" : ""}`}
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
