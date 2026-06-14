import { Link } from "next-view-transitions";
import NewCaseSheet from "./NewCaseSheet";
import { CaseRowActions } from "./CaseRowActions";
import { Plus, CalendarDots, Briefcase, Warning } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buttonClasses } from "@/components/ui/Button";
import { type Stage, relTime } from "@/lib/case";
import { deriveCaseStatus, statusStage, type StatusTone, type WaitingOn } from "@/lib/caseStatus";

type CaseRow = {
  id: number;
  name: string;
  phone: string;
  stage: Stage;
  statusLabel: string;
  statusTone: StatusTone;
  waiting: WaitingOn;
  bucket: Bucket;
  cobrowse: string | null;
  firstMeetingId: number | null;
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

type Bucket = "critical" | "today" | "awaitClient" | "awaitPayment" | "progress";

const BUCKETS: Array<{ id: Bucket; label: string; tone: string }> = [
  { id: "critical", label: "Срочное", tone: "text-danger" },
  { id: "today", label: "Сегодня", tone: "text-accent" },
  { id: "awaitClient", label: "Ждём клиента", tone: "text-ink-3" },
  { id: "awaitPayment", label: "Ждём оплату", tone: "text-warning" },
  { id: "progress", label: "В работе", tone: "text-ink-3" },
];

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
        documents: { select: { category: true } },
        meetings: {
          orderBy: { scheduledAt: "desc" },
          select: {
            id: true,
            scheduledAt: true,
            cobrowseCode: true,
            coViewedAt: true,
            coAgreedAt: true,
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

    const REQUIRED_DOC_CATEGORIES = ["Свидетельство о смерти", "Паспорт", "Договор"];

    const rows: CaseRow[] = leads.map((lead) => {
      const quotesLen = lead.meetings.reduce((n, m) => n + m.quotes.length, 0);
      const orders = lead.meetings.flatMap((m) => m.orders);

      const future = lead.meetings
        .map((m) => m.scheduledAt?.getTime())
        .filter((t): t is number => !!t && t >= now)
        .sort((a, b) => a - b);
      const nextMeetingAt = future[0] ?? null;

      const lastActivity = lead.meetings.reduce<number>(
        (max, m) => (m.scheduledAt && m.scheduledAt.getTime() > max ? m.scheduledAt.getTime() : max),
        lead.createdAt.getTime(),
      );

      // Операционный статус — что сейчас и что делать дальше (движок caseStatus).
      const status = deriveCaseStatus({
        meetingsLen: lead.meetings.length,
        hasUpcomingMeeting: nextMeetingAt != null,
        quotesLen,
        orders,
        hasCobrowse: lead.meetings.some((m) => m.cobrowseCode),
        clientViewed: lead.meetings.some((m) => m.coViewedAt),
        clientAgreed: lead.meetings.some((m) => m.coAgreedAt),
        docsComplete: REQUIRED_DOC_CATEGORIES.every((c) => lead.documents.some((d) => d.category === c)),
        intakeComplete: Boolean(lead.deceasedName) && Boolean(lead.ceremonyType),
        ceremonyAt: lead.ceremonyAt?.getTime() ?? null,
        nowMs: now,
      });
      const stage = statusStage(status);

      const soon = nextMeetingAt ? nextMeetingAt - now < DAY : false;
      const stale = status.key !== "done" && now - lastActivity > 7 * DAY;

      // Церемония — настоящий дедлайн кейса (важнее встреч)
      const ceremonyAt = lead.ceremonyAt && status.key !== "done" ? lead.ceremonyAt.getTime() : null;
      const hoursToCeremony = ceremonyAt && ceremonyAt > now ? Math.round((ceremonyAt - now) / 3_600_000) : null;
      const ceremonySoon = hoursToCeremony !== null && hoursToCeremony <= 48;

      // Бакет дашборда — приоритет по срочности (первое совпадение).
      const todayMeeting = nextMeetingAt != null && nextMeetingAt <= todayEndMs;
      const bucket: Bucket =
        ceremonySoon || stale ? "critical"
        : todayMeeting ? "today"
        : status.waiting === "client" ? "awaitClient"
        : status.waiting === "payment" ? "awaitPayment"
        : "progress";

      return {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        stage,
        statusLabel: status.label,
        statusTone: status.tone,
        waiting: status.waiting,
        bucket,
        cobrowse: lead.meetings.find((m) => m.cobrowseCode)?.cobrowseCode ?? null,
        firstMeetingId: lead.meetings[lead.meetings.length - 1]?.id ?? null,
        progress: status.stageIdx + 1,
        nextAction: status.next,
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
    statusLabel: "Просрочена задача",
    statusTone: "danger" as StatusTone,
    waiting: null as WaitingOn,
    bucket: "critical" as Bucket,
    cobrowse: null,
    firstMeetingId: null,
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
            <div className="space-y-6">
              {BUCKETS.map(({ id, label, tone }) => {
                const rows = active.filter((c) => c.bucket === id);
                if (rows.length === 0) return null;
                return (
                  <div key={id}>
                    <div className="mb-2 flex items-center gap-2 px-1">
                      <span className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${tone}`}>{label}</span>
                      <span className="tnum text-[11px] font-semibold text-ink-3">{rows.length}</span>
                    </div>
                    <ul className="td-entity-list">
                      {rows.map((c) => <CaseRowItem key={c.id} c={c} />)}
                    </ul>
                  </div>
                );
              })}
            </div>
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

function CaseRowItem({ c }: { c: CaseRow }) {
  const bar = c.ceremonySoon ? "before:bg-danger" : c.soon ? "before:bg-accent" : c.stale ? "before:bg-warning" : "before:bg-transparent";
  return (
    <li className="border-b border-line last:border-0">
      <div className={`td-entity-row group relative flex items-center pr-2 before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full ${bar}`}>
        <Link href={`/agent/cases/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 pl-5 pr-2">
          <Avatar name={c.name} urgent={c.urgent} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2.5">
              <span className="truncate text-[15px] font-semibold text-ink" style={{ viewTransitionName: `case-${c.id}` }}>{c.name}</span>
              {/* Бейдж - только исключение. Спокойный кейс молчит. */}
              {c.ceremonySoon ? (
                <span className="flex-shrink-0 text-[11px] font-bold text-danger">церемония через {c.hoursToCeremony} ч</span>
              ) : c.soon ? (
                <span className="flex-shrink-0 text-[11px] font-semibold text-accent">встреча скоро</span>
              ) : c.stale ? (
                <span className="flex-shrink-0 text-[11px] font-semibold text-warning">без движения</span>
              ) : null}
            </span>
            <span className="mt-1 block truncate text-[13px] text-ink-2">{c.nextAction}</span>
          </span>
          <span className="hidden flex-shrink-0 text-[12px] text-ink-3 sm:inline">
            {c.ceremonyLabel && !c.ceremonySoon ? `церемония ${c.ceremonyLabel}` : c.statusLabel}
          </span>
        </Link>
        <CaseRowActions caseId={c.id} phone={c.phone} cobrowse={c.cobrowse} firstMeetingId={c.firstMeetingId} />
      </div>
    </li>
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
