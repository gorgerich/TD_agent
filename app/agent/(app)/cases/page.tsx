import { Link } from "next-view-transitions";
import NewCaseSheet from "./NewCaseSheet";
import { CasesList, type Bucket } from "./CasesList";
import { CalendarDots, Briefcase, Warning } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { EmptyState } from "@/components/ui/EmptyState";
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
      take: 400, // защита от неограниченной выборки (20 агентов × сотни дел)
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
  // KPI команд-центра — выводимы из текущих данных (без новых таблиц).
  // eslint-disable-next-line react-hooks/purity -- server-rendered freshness marker
  const kpiNow = Date.now();
  const kpiTodayEnd = new Date(); kpiTodayEnd.setHours(23, 59, 59, 999);
  const attentionCases = active.filter((c) => c.urgent).length;
  const ceremonyToday = active.filter((c) => c.ceremonyAt && c.ceremonyAt >= kpiNow && c.ceremonyAt <= kpiTodayEnd.getTime()).length;
  const awaitingPayment = active.filter((c) => c.bucket === "awaitPayment").length;

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-5 flex items-end justify-between gap-4">
        <div>
          <span className="td-eyebrow">Рабочий центр</span>
          <h1 className="td-display mt-1.5 text-[28px] text-ink sm:text-[32px]">Кейсы</h1>
        </div>
        <NewCaseSheet />
      </header>

      {active.length > 0 && (
        <div className="rise mb-5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-ink-2">
          <span><b className="tnum text-ink">{active.length}</b> в работе</span>
          <span className="text-ink-3" aria-hidden="true">·</span>
          <span className={attentionCases > 0 ? "font-medium text-danger" : ""}>
            <b className={`tnum ${attentionCases > 0 ? "text-danger" : "text-ink"}`}>{attentionCases}</b> требуют внимания
          </span>
          <span className="text-ink-3" aria-hidden="true">·</span>
          <span><b className="tnum text-ink">{ceremonyToday}</b> сегодня</span>
          <span className="text-ink-3" aria-hidden="true">·</span>
          <span><b className="tnum text-ink">{awaitingPayment}</b> ждут оплату</span>
        </div>
      )}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_310px]">
        <section className="rise rise-1 order-2 min-w-0 lg:order-1">
          {active.length === 0 ? (
            <EmptyState
              icon={<Briefcase size={28} weight="fill" />}
              eyebrow="Рабочий центр"
              title="Кейсов пока нет"
              description="Создайте первый кейс, чтобы вести клиента от первого контакта до встречи, сметы, документов и оплаты в одном маршруте."
              primaryAction={{ label: "Создать кейс", href: "/agent/leads/new" }}
              secondaryAction={{ label: "Открыть календарь", href: "/agent/meetings" }}
            />
          ) : (
            <CasesList
              rows={active.map((c) => ({
                id: c.id,
                name: c.name,
                phone: c.phone,
                bucket: c.bucket,
                cobrowse: c.cobrowse,
                firstMeetingId: c.firstMeetingId,
                nextAction: c.nextAction,
                statusLabel: c.statusLabel,
                ceremonyLabel: c.ceremonyLabel,
                hoursToCeremony: c.hoursToCeremony,
                urgent: c.urgent,
                soon: c.soon,
                stale: c.stale,
                ceremonySoon: c.ceremonySoon,
              }))}
            />
          )}
        </section>

        <aside className="rise rise-2 order-1 min-w-0 space-y-4 lg:order-2">
          {overdueTasks.length > 0 && (
            <div className="td-shell p-3.5">
              <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-danger">
                <Warning size={14} weight="fill" /> Просрочено: {overdueTasks.length}
              </p>
              <div className="divide-y divide-line">
                {overdueTasks.slice(0, 3).map((t, i) => (
                  <Link key={`${t.leadId}-${i}`} href={`/agent/cases/${t.leadId}`} className="td-mini-row block px-2 py-1.5">
                    <span className="block truncate text-[13px] font-medium text-ink">{t.title}</span>
                    <span className="block truncate text-[12px] text-ink-3">{t.leadName}</span>
                  </Link>
                ))}
              </div>
              {overdueTasks.length > 3 && (
                <details className="mt-0.5">
                  <summary className="cursor-pointer list-none px-2 py-1.5 text-[12px] font-medium text-ink-2 hover:text-ink">
                    Показать ещё {overdueTasks.length - 3}
                  </summary>
                  <div className="divide-y divide-line">
                    {overdueTasks.slice(3).map((t, i) => (
                      <Link key={`more-${t.leadId}-${i}`} href={`/agent/cases/${t.leadId}`} className="td-mini-row block px-2 py-1.5">
                        <span className="block truncate text-[13px] font-medium text-ink">{t.title}</span>
                        <span className="block truncate text-[12px] text-ink-3">{t.leadName}</span>
                      </Link>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {todayMeetings.length > 0 ? (
            <div className="td-shell p-3.5">
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
                <CalendarDots size={14} weight="duotone" /> Сегодня
              </p>
              <div className="divide-y divide-line">
                {todayMeetings.map((c) => (
                  <Link key={c.id} href={`/agent/cases/${c.id}`} className="td-mini-row flex items-center justify-between gap-2 px-2 py-1.5 text-[13px] text-ink-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{c.name}</span>
                      <span className="block text-[11px] text-ink-3">{c.nextAction}</span>
                    </span>
                    <span className="tnum flex-shrink-0 text-ink-3">{c.nextMeetingTime}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p className="px-1 text-[13px] text-ink-3">Сегодня: встреч нет</p>
          )}
        </aside>
      </div>
    </div>
  );
}
