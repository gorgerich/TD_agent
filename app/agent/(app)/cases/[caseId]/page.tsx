import { Link } from "next-view-transitions";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CalendarDots,
  FileText,
  ShareNetwork,
  Warning,
  Phone,
} from "@phosphor-icons/react/dist/ssr";
import { getAgentSession, type AgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto";
import { phone as fmtPhone, dateTime, moneyFromKopecks } from "@/lib/format";
import { STAGE_ORDER } from "@/lib/case";
import { type StatusTone } from "@/lib/caseStatus";
import { getCanonicalCase } from "@/lib/caseReadModel";
import { CaseTabs } from "./CaseTabs";
import { buttonClasses } from "@/components/ui/Button";

const SOURCE_LABELS: Record<string, string> = {
  agent: "Агент", telegram: "Telegram", form: "Форма", referral: "Рекомендация",
};

type Activity = { at: number; label: string; sub?: string };

async function getCase(caseId: number, session: AgentSession) {
  return prisma.clientLead.findFirst({
    where: {
      id: caseId,
      case: {
        tenantId: session.organizationId,
        ...(session.role === "ADMIN"
          ? {}
          : {
              OR: [
                { ownerId: session.agentId },
                { tasks: { some: { assigneeMembershipId: session.membershipId } } },
              ],
            }),
      },
    },
    include: {
      meetings: {
        orderBy: { id: "asc" },
        select: {
          id: true, status: true, scheduledAt: true, cobrowseCode: true, coViewedAt: true, coAgreedAt: true,
          quotes: { select: { versions: { select: { createdAt: true, total: true }, orderBy: { createdAt: "desc" } } } },
          orders: { select: { status: true, createdAt: true } },
        },
      },
    },
  });
}

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { caseId } = await params;
  const requestedTab = (await searchParams).tab;
  const initialTab = requestedTab === "docs" || requestedTab === "family" || requestedTab === "history" ? requestedTab : "work";
  const id = Number(caseId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const session = await getAgentSession();
  if (!session) notFound();
  const projectionNow = new Date();
  const [lead, canonicalCase] = await Promise.all([
    getCase(id, session),
    getCanonicalCase(session, id, projectionNow),
  ]);
  if (!lead || !canonicalCase) notFound();

  // Tasks + Notes (P5) - fetched separately; notes body decrypted server-side.
  const [rawTasks, rawNotes, rawDocs, rawPayments, rawEvents] = await Promise.all([
    prisma.task.findMany({
      where: { leadId: id, organizationId: session.organizationId },
      orderBy: { createdAt: "desc" },
      include: { assignee: { select: { user: { select: { name: true } } } } },
    }),
    prisma.caseNote.findMany({ where: { leadId: id, agentId: canonicalCase.ownerId }, orderBy: { createdAt: "desc" } }),
    prisma.document.findMany({ where: { leadId: id, agentId: canonicalCase.ownerId }, orderBy: { createdAt: "desc" } }),
    prisma.casePayment.findMany({ where: { leadId: id, agentId: canonicalCase.ownerId }, orderBy: { paidAt: "desc" } }),
    prisma.caseEvent.findMany({
      where: { case: { leadId: id, tenantId: canonicalCase.tenantId } },
      orderBy: { createdAt: "desc" },
      select: { id: true, eventType: true, createdAt: true, fromStage: true, toStage: true },
    }),
  ]);
  const tasks = rawTasks.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    priority: t.priority,
    status: t.status,
    source: t.sourceEventId ? "Событие кейса" : "Агент",
    expectedOutcome: t.expectedOutcome,
    waitingReason: t.waitingReason,
    ownerName: t.assignee?.user.name ?? "Не назначено",
    version: t.version,
    dueAt: t.dueAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    canMutate: session.role !== "ADMIN" && t.assigneeMembershipId === session.membershipId,
    actionHref: meetingIdFromEscalationSource(t.sourceEventId),
  }));
  const notes = rawNotes.map((n) => ({
    id: n.id,
    body: decryptField(n.body) ?? n.body,
    createdAt: n.createdAt.toISOString(),
  }));

  const meetings = lead.meetings;
  const versions = meetings.flatMap((m) => m.quotes.flatMap((q) => q.versions));
  const orders = meetings.flatMap((m) => m.orders);

  const curIdx = Math.max(0, STAGE_ORDER.indexOf(canonicalCase.legacyStage));

  const firstMeeting = meetings[0] ?? null;
  const cobrowse = meetings.find((m) => m.cobrowseCode)?.cobrowseCode ?? null;
  const context = decryptField(lead.context);
  const intake = {
    ceremonyType: lead.ceremonyType ?? "",
    budget: lead.budget ?? "",
    religion: lead.religion ?? "",
    needs: decryptField(lead.needs) ?? "",
    deceasedName: decryptField(lead.deceasedName) ?? "",
    deceasedDate: lead.deceasedDate ? lead.deceasedDate.toISOString().slice(0, 10) : "",
    morgue: lead.morgue ?? "",
    ceremonyAt: lead.ceremonyAt ? lead.ceremonyAt.toISOString().slice(0, 16) : "",
    ceremonyPlace: lead.ceremonyPlace ?? "",
  };

  const docs = rawDocs.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    url: d.url,
    mimeType: d.mimeType,
    size: d.size,
    createdAt: d.createdAt.toISOString(),
  }));
  const payments = rawPayments.map((p) => ({
    id: p.id,
    amountKopecks: p.amountKopecks,
    kind: p.kind,
    method: p.method,
    note: p.note,
    paidAt: p.paidAt.toISOString(),
  }));

  // Derived activity feed
  const activity: Activity[] = [{ at: lead.createdAt.getTime(), label: "Кейс создан" }];
  for (const m of meetings) {
    if (m.scheduledAt) activity.push({ at: m.scheduledAt.getTime(), label: "Встреча назначена", sub: dateTime(m.scheduledAt) });
  }
  for (const v of versions) activity.push({ at: v.createdAt.getTime(), label: "Смета сохранена" });
  for (const o of orders) activity.push({ at: o.createdAt.getTime(), label: `Заказ - ${o.status}` });
  for (const m of meetings) {
    if (m.coViewedAt) activity.push({ at: m.coViewedAt.getTime(), label: "Клиент открыл смету", sub: dateTime(m.coViewedAt) });
    if (m.coAgreedAt) activity.push({ at: m.coAgreedAt.getTime(), label: "Клиент согласовал смету", sub: dateTime(m.coAgreedAt) });
  }
  for (const event of rawEvents) {
    activity.push({
      at: event.createdAt.getTime(),
      label: eventLabel(event.eventType),
      sub: event.fromStage === event.toStage ? undefined : `${event.fromStage} → ${event.toStage}`,
    });
  }
  activity.sort((a, b) => b.at - a.at);

  const nowMs = projectionNow.getTime();
  const risks = canonicalCase.risk.reasons.map((risk) => ({
    tone: risk.level === "CRITICAL" ? "danger" as const : "warning" as const,
    label: `${risk.label}${risk.deadline ? ` · до ${dateTime(risk.deadline)}` : ""}`,
  }));
  const ceremonyMs = lead.ceremonyAt?.getTime() ?? null;
  const hoursToCeremony = ceremonyMs ? Math.round((ceremonyMs - nowMs) / 3_600_000) : null;

  const routeMeta = [
    `${curIdx + 1}/${STAGE_ORDER.length} этап`,
    canonicalCase.nextAction.dueAt ? `срок ${dateTime(canonicalCase.nextAction.dueAt)}` : "без срока",
    `версия кейса ${canonicalCase.version}`,
  ];
  const openTasksCount = tasks.filter((task) => task.status === "OPEN").length;
  const lastActivityText = activity[0]?.label ?? "Активности нет";
  const canMutateCase = session.role !== "ADMIN" && canonicalCase.ownerId === session.agentId;

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <Link href="/agent/cases" className="rise inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={15} /> К кейсам
      </Link>

      <header className="rise rise-1 td-shell-elevated mt-4 mb-5 overflow-hidden">
        <div className="min-w-0">
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <span className="td-eyebrow">Кейс · #{id}</span>
            <h1 className="td-display mt-2 text-[30px] text-ink sm:text-[38px]" style={{ viewTransitionName: `case-${id}` }}>{lead.name}</h1>
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13px] text-ink-2">
              <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-ink transition-colors hover:text-accent">
                <Phone size={15} weight="fill" />
                <span className="tnum">{fmtPhone(lead.phone)}</span>
              </a>
              <span className="h-1 w-1 rounded-full bg-line-strong" aria-hidden="true" />
              <span>Источник: {SOURCE_LABELS[lead.source] ?? lead.source}</span>
              <span className="h-1 w-1 rounded-full bg-line-strong" aria-hidden="true" />
              <span>Ведёт: {session?.name ?? "-"}</span>
              <span className="h-1 w-1 rounded-full bg-line-strong" aria-hidden="true" />
              <span>Открыт: {dateTime(lead.createdAt)}</span>
            </div>
          </div>
          {(intake.deceasedName || lead.ceremonyAt) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-surface-2/60 px-5 py-3.5 text-[13px] text-ink-2 sm:px-6">
              {intake.deceasedName && <span className="font-medium text-ink">{intake.deceasedName}</span>}
              {intake.morgue && <span className="text-ink-3">· {intake.morgue}</span>}
              {lead.ceremonyAt && (
                <span className={hoursToCeremony !== null && hoursToCeremony > 0 && hoursToCeremony <= 48 ? "font-semibold text-danger" : "text-ink-2"}>
                  · Церемония: {dateTime(lead.ceremonyAt)}
                  {intake.ceremonyPlace ? `, ${intake.ceremonyPlace}` : ""}
                  {hoursToCeremony !== null && hoursToCeremony > 0 ? ` (через ${hoursToCeremony} ч)` : ""}
                </span>
              )}
            </p>
          )}
        </div>
      </header>

      <RouteActionPanel
        current={curIdx}
        statusLabel={canonicalCase.statusLabel}
        statusTone={canonicalCase.statusTone}
        nextAction={canonicalCase.nextAction.label}
        meta={routeMeta}
        firstMeetingId={firstMeeting?.id ?? null}
        caseId={id}
        cobrowse={cobrowse}
        controls={[
          { label: "Открытые задачи", value: String(openTasksCount), tone: openTasksCount > 0 ? "warning" : "neutral" },
          { label: "Документы", value: canonicalCase.documents.required ? `${canonicalCase.documents.verified}/${canonicalCase.documents.required}` : "—", tone: canonicalCase.documents.ready ? "success" : "warning" },
          { label: "Опубликованная смета", value: canonicalCase.publishedQuote ? `v${canonicalCase.publishedQuote.versionId}` : "Нет", tone: canonicalCase.publishedQuote ? "success" : "warning" },
          { label: "Остаток", value: canonicalCase.payment.balanceKopecks == null ? "Не рассчитан" : moneyFromKopecks(canonicalCase.payment.balanceKopecks), tone: canonicalCase.payment.balanceKopecks === 0 ? "success" : "neutral" },
        ]}
        lastActivity={lastActivityText}
        canMutateCase={canMutateCase}
      />

      {risks.length > 0 && (
        <section className="rise rise-1 td-shell mb-5 flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="td-eyebrow mr-1 text-danger">Риски</span>
          {risks.map((r) => (
            <span
              key={r.label}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium ${r.tone === "danger" ? "border-danger/20 bg-danger-soft text-danger" : "border-warning/20 bg-warning-soft text-warning"}`}
            >
              <Warning size={12} weight="bold" /> {r.label}
            </span>
          ))}
        </section>
      )}

      <main className="rise rise-2 min-w-0">
        <CaseTabs
          caseId={id}
          tasks={tasks}
          docs={docs}
          notes={notes}
          intake={intake}
          context={context}
          payments={payments}
          activity={activity.map((a) => ({ label: a.label, sub: a.sub }))}
          initialTab={initialTab}
          timezone={session.timezone}
          canMutateCase={canMutateCase}
        />
      </main>
    </div>
  );
}

function meetingIdFromEscalationSource(sourceEventId: string | null) {
  const match = sourceEventId?.match(/^meeting:(\d+):past-due:v1$/);
  return match ? `/agent/meetings/${match[1]}?from=case` : null;
}

function eventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    "case.created.v1": "Канонический кейс создан",
    "case.migrated.v1": "Кейс перенесён в каноническую модель",
    "case.intake_saved.v1": "Данные интейка сохранены",
    "intake.completed.v1": "Интейк завершён",
    "scenario.selected.v1": "Сценарий выбран",
    "quote.published.v1": "Смета опубликована",
    "quote.accepted.v1": "Смета согласована",
    "contract.signed.v1": "Договор подписан",
    "payment.requirement_satisfied.v1": "Требование по оплате выполнено",
    "case.closure_requested.v1": "Кейс закрыт",
  };
  return labels[eventType] ?? eventType;
}

function RouteActionPanel({
  current,
  statusLabel,
  statusTone,
  nextAction,
  meta,
  firstMeetingId,
  caseId,
  cobrowse,
  controls,
  lastActivity,
  canMutateCase,
}: {
  current: number;
  statusLabel: string;
  statusTone: StatusTone;
  nextAction: string;
  meta: string[];
  firstMeetingId: number | null;
  caseId: number;
  cobrowse: string | null;
  controls: { label: string; value: string; tone?: "neutral" | "warning" | "success" }[];
  lastActivity: string;
  canMutateCase: boolean;
}) {
  const isDone = current >= STAGE_ORDER.length - 1;
  return (
    <section className="rise rise-1 td-shell-elevated mb-5 overflow-hidden">
      <div className="grid min-w-0 gap-0 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="td-accent-panel order-1 px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="td-eyebrow text-accent">Следующее действие</span>
            <StatusChip label={statusLabel} tone={statusTone} />
          </div>
          <strong className="mt-2 block max-w-[760px] text-[20px] leading-snug text-ink sm:text-[23px]">{nextAction}</strong>
          {canMutateCase ? <div className="mt-4 flex flex-wrap gap-2">
            {firstMeetingId ? (
              <Action href={`/agent/meetings/${firstMeetingId}/quote`} icon={<FileText size={16} />} primary compact>
                Открыть смету
              </Action>
            ) : (
              <Action href={`/agent/meetings/new?leadId=${caseId}`} icon={<CalendarDots size={16} />} primary compact>
                Назначить встречу
              </Action>
            )}
            {cobrowse && (
              <Action href={`/co/${cobrowse}`} icon={<ShareNetwork size={16} />} external compact>
                Клиентский вид
              </Action>
            )}
          </div> : (
            <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-ink-2">
              Вы подключены к этому кейсу по назначенной задаче. Рабочее действие доступно в разделе «Работа».
            </p>
          )}
        </div>

        <div className="order-2 min-w-0 border-t border-line bg-surface px-4 py-4 xl:border-l xl:border-t-0">
          <div className="mb-4 flex flex-col gap-2">
            <div>
              <span className="td-eyebrow">Маршрут кейса</span>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-ink-2">{meta.join(" · ")}</span>
              </div>
            </div>
          </div>
          {!isDone && (
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {STAGE_ORDER.map((s, i) => {
              const done = i < current;
              const active = i === current;
              return (
                <li
                  key={s}
                  className={`relative rounded-[12px] border px-3 py-2.5 ${
                    active
                      ? "border-accent/30 bg-accent-soft text-accent"
                      : done
                        ? "border-line bg-surface-2/60 text-ink-2"
                        : "border-line bg-surface text-ink-3"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                      active ? "bg-accent text-on-accent" : done ? "bg-accent-soft text-accent" : "border border-line bg-surface text-ink-3"
                    }`}>
                      {done ? <Check size={12} weight="bold" /> : i + 1}
                    </span>
                    <span className={`text-[12px] leading-tight ${active ? "font-semibold" : "font-medium"}`}>{s}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          )}
        </div>
      </div>
      <div className="border-t border-line bg-surface-2/45 px-4 py-3.5 sm:px-5">
        <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
          <span className="td-eyebrow">Контроль кейса</span>
          <span className="truncate text-[12px] text-ink-3">Последнее: {lastActivity}</span>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] bg-line sm:grid-cols-4">
          {controls.map((control) => (
            <CaseMetric key={control.label} {...control} />
          ))}
        </div>
      </div>
    </section>
  );
}

const STATUS_CHIP: Record<StatusTone, { wrap: string; dot: string }> = {
  neutral: { wrap: "border-line bg-surface text-ink-2", dot: "bg-ink-3" },
  info: { wrap: "border-info/20 bg-info-soft text-info", dot: "bg-info" },
  accent: { wrap: "border-accent/20 bg-accent-soft text-accent", dot: "bg-accent" },
  warning: { wrap: "border-warning/20 bg-warning-soft text-warning", dot: "bg-warning" },
  success: { wrap: "border-success/20 bg-success-soft text-success", dot: "bg-success" },
  danger: { wrap: "border-danger/20 bg-danger-soft text-danger", dot: "bg-danger" },
};

function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
  const c = STATUS_CHIP[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${c.wrap}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {label}
    </span>
  );
}

function Action({ href, icon, children, primary, external, compact }: { href: string; icon: ReactNode; children: ReactNode; primary?: boolean; external?: boolean; compact?: boolean }) {
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      className={buttonClasses({ variant: primary ? "primary" : "secondary", size: compact ? "sm" : "md", className: compact ? "w-auto" : "w-full justify-start" })}
    >
      <span className="flex-shrink-0">{icon}</span>
      {children}
    </Link>
  );
}

function CaseMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "warning" | "success" }) {
  const toneClass = tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink";
  return (
    <div className="min-w-0 bg-surface px-3 py-3 sm:px-4">
      <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <span className={`tnum mt-1 block truncate text-[15px] font-bold tracking-[-0.015em] ${toneClass}`}>{value}</span>
    </div>
  );
}
