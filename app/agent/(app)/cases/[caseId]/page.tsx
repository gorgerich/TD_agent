import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CalendarDots,
  FileText,
  ShareNetwork,
  Plus,
  Warning,
  Phone,
  User,
  Hash,
} from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto";
import { phone as fmtPhone, dateTime, moneyFromKopecks } from "@/lib/format";
import { STAGE_ORDER, STAGE_DOT, NEXT_ACTION, deriveStage, stageIndex } from "@/lib/case";
import { CaseTabs } from "./CaseTabs";
import { buttonClasses } from "@/components/ui/Button";

const SOURCE_LABELS: Record<string, string> = {
  agent: "Агент", telegram: "Telegram", form: "Форма", referral: "Рекомендация",
};

type Activity = { at: number; label: string; sub?: string };

async function getCase(caseId: number, agentId: number) {
  try {
    return await prisma.clientLead.findFirst({
      where: {
        id: caseId,
        ...(agentId
          ? { OR: [{ agentId }, { meetings: { some: { agentId } } }] }
          : {}),
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
  } catch {
    return null;
  }
}

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const id = Number(caseId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const session = await getAgentSession();
  const lead = await getCase(id, session?.agentId ?? 0);
  if (!lead) notFound();

  // Tasks + Notes (P5) - fetched separately; notes body decrypted server-side.
  const [rawTasks, rawNotes, rawDocs] = await Promise.all([
    prisma.task.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" } }).catch(() => []),
    prisma.caseNote.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" } }).catch(() => []),
    prisma.document.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" } }).catch(() => []),
  ]);
  const tasks = rawTasks.map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  }));
  const notes = rawNotes.map((n) => ({
    id: n.id,
    body: decryptField(n.body) ?? n.body,
    createdAt: n.createdAt.toISOString(),
  }));

  const meetings = lead.meetings;
  const versions = meetings.flatMap((m) => m.quotes.flatMap((q) => q.versions));
  const orders = meetings.flatMap((m) => m.orders);
  const stage = deriveStage(orders, versions.length, meetings.length);
  const curIdx = stageIndex(stage);

  const firstMeeting = meetings[0] ?? null;
  const cobrowse = meetings.find((m) => m.cobrowseCode)?.cobrowseCode ?? null;
  const context = decryptField(lead.context);
  const intake = {
    ceremonyType: lead.ceremonyType ?? "",
    budget: lead.budget ?? "",
    religion: lead.religion ?? "",
    needs: decryptField(lead.needs) ?? "",
  };

  // Derived checklist (read-only статусы - без отдельной таблицы)
  const checklist: { label: string; done: boolean }[] = [
    { label: "Клиент заведён", done: true },
    { label: "Назначена встреча", done: meetings.length > 0 },
    { label: "Собрана смета", done: versions.length > 0 },
    { label: "Оформлен договор", done: orders.length > 0 },
    { label: "Принята оплата", done: orders.some((o) => ["PAID", "PARTIALLY_PAID", "COMPLETED"].includes(o.status.toUpperCase())) },
  ];
  const docs = rawDocs.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    url: d.url,
    mimeType: d.mimeType,
    size: d.size,
    createdAt: d.createdAt.toISOString(),
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
  activity.sort((a, b) => b.at - a.at);

  // Risk-flags - производные сигналы «что грозит сорвать кейс» (без отдельной таблицы)
  // eslint-disable-next-line react-hooks/purity -- server-rendered freshness marker for case risk signals
  const nowMs = Date.now();
  const overdueCount = tasks.filter((t) => !t.completedAt && t.dueAt && new Date(t.dueAt).getTime() < nowMs).length;
  const paid = orders.some((o) => ["PAID", "PARTIALLY_PAID", "COMPLETED"].includes(o.status.toUpperCase()));
  const meetingSoon = meetings.some((m) => m.scheduledAt && m.scheduledAt.getTime() > nowMs && m.scheduledAt.getTime() - nowMs < 86_400_000);
  const lastAt = activity[0]?.at ?? lead.createdAt.getTime();
  const stale = stage !== "Завершено" && nowMs - lastAt > 7 * 86_400_000;
  const risks: { tone: "danger" | "warning"; label: string }[] = [];
  if (overdueCount > 0) risks.push({ tone: "danger", label: `Просрочено задач: ${overdueCount}` });
  if (meetingSoon && versions.length === 0) risks.push({ tone: "warning", label: "Встреча скоро - сметы нет" });
  if (orders.length > 0 && !paid) risks.push({ tone: "warning", label: "Оплата не завершена" });
  if ((stage === "Договор" || stage === "Оплата") && docs.length === 0) risks.push({ tone: "warning", label: "Нет документов" });
  if (stale) risks.push({ tone: "warning", label: "Без движения >7 дней" });

  const latestVersion = versions.reduce<(typeof versions)[number] | null>((latest, version) => {
    if (!latest) return version;
    return version.createdAt.getTime() > latest.createdAt.getTime() ? version : latest;
  }, null);
  const openTasksCount = tasks.filter((task) => !task.completedAt).length;
  const requiredDocCategories = ["Свидетельство о смерти", "Паспорт", "Договор"];
  const missingRequiredDocs = requiredDocCategories.filter((category) => !docs.some((doc) => doc.category === category)).length;
  const clientState = meetings.some((m) => m.coAgreedAt)
    ? "согласовал"
    : meetings.some((m) => m.coViewedAt)
      ? "открыл смету"
      : cobrowse
        ? "ссылка готова"
        : "не отправляли";
  const outcomeRows: Array<{ label: string; value: string; tone: "neutral" | "success" | "warning" }> = [
    {
      label: "Смета",
      value: latestVersion ? moneyFromKopecks(latestVersion.total) : "не собрана",
      tone: latestVersion ? "success" : "warning",
    },
    {
      label: "Клиент",
      value: clientState,
      tone: clientState === "согласовал" || clientState === "открыл смету" ? "success" : cobrowse ? "neutral" : "warning",
    },
    {
      label: "Документы",
      value: missingRequiredDocs === 0 ? "минимум собран" : `нужно ${missingRequiredDocs}`,
      tone: missingRequiredDocs === 0 ? "success" : "warning",
    },
    {
      label: "Задачи",
      value: openTasksCount > 0 ? `${openTasksCount} открыто` : "нет открытых",
      tone: openTasksCount > 0 ? "neutral" : "success",
    },
  ];
  const meetingOutcomeAction = latestVersion
    ? "Зафиксируйте документы, следующий контакт и оплату."
    : firstMeeting
      ? "Откройте встречу и соберите первую смету."
      : "Назначьте встречу и заполните вводные по семье.";
  const routeMeta = [
    `${curIdx + 1}/${STAGE_ORDER.length} этап`,
    meetings.length > 0 ? ruCount(meetings.length, ["встреча", "встречи", "встреч"]) : "встреч нет",
    versions.length > 0 ? ruCount(versions.length, ["смета", "сметы", "смет"]) : "смет нет",
    orders.length > 0 ? ruCount(orders.length, ["заказ", "заказа", "заказов"]) : "заказов нет",
  ];

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <Link href="/agent/cases" className="rise inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={15} /> К кейсам
      </Link>

      <header className="rise rise-1 mt-4 mb-5 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-5 shadow-[var(--shadow-soft),var(--hl-top)]">
        <div className="min-w-0">
          <span className="td-eyebrow">Кейс #{id}</span>
          <h1 className="td-display mt-2 text-[28px] text-ink sm:text-[34px]">{lead.name}</h1>
          <div className="mt-3 flex min-w-0 flex-wrap gap-2">
            <MetaPill icon={<Phone size={14} weight="duotone" />} label="Телефон" value={fmtPhone(lead.phone)} href={`tel:${lead.phone}`} />
            <MetaPill icon={<Hash size={14} weight="duotone" />} label="Источник" value={SOURCE_LABELS[lead.source] ?? lead.source} />
            <MetaPill icon={<User size={14} weight="duotone" />} label="Агент" value={session?.name ?? "-"} />
            <MetaPill icon={<CalendarDots size={14} weight="duotone" />} label="Заведено" value={dateTime(lead.createdAt)} />
          </div>
        </div>
      </header>

      <RouteActionPanel
        current={curIdx}
        stage={stage}
        nextAction={NEXT_ACTION[stage]}
        meta={routeMeta}
        firstMeetingId={firstMeeting?.id ?? null}
        caseId={id}
        cobrowse={cobrowse}
      />

      <section className="rise rise-1 mb-5 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 shadow-[var(--shadow-soft),var(--hl-top)]">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="td-eyebrow">Итог встречи</span>
            <h2 className="mt-1 text-[16px] font-semibold text-ink">Что уже зафиксировано</h2>
          </div>
          <p className="max-w-[420px] text-[12px] leading-relaxed text-ink-2 sm:text-right">{meetingOutcomeAction}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {outcomeRows.map((item) => (
            <OutcomeTile key={item.label} {...item} />
          ))}
        </div>
      </section>

      {risks.length > 0 && (
        <section className="rise rise-1 mb-5 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3">
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

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* CENTER - operational (tabbed to kill the card wall) */}
        <main className="rise rise-2 order-1 min-w-0">
          <CaseTabs
            caseId={id}
            checklist={checklist}
            tasks={tasks}
            docs={docs}
            notes={notes}
            intake={intake}
            context={context}
            activity={activity.map((a) => ({ label: a.label, sub: a.sub }))}
          />
        </main>

        {/* RIGHT - info + quick actions */}
        <aside className="rise rise-2 order-2 min-w-0 space-y-4">
          <div className="td-shell space-y-2.5 p-4">
            <span className="td-eyebrow">Действия по кейсу</span>
            {firstMeeting ? (
              <Action href={`/agent/meetings/${firstMeeting.id}/quote`} icon={<FileText size={16} />} primary>
                Открыть смету
              </Action>
            ) : (
              <Action href={`/agent/meetings/new?leadId=${id}`} icon={<CalendarDots size={16} />} primary>
                Назначить встречу
              </Action>
            )}
            {cobrowse && (
              <Action href={`/co/${cobrowse}`} icon={<ShareNetwork size={16} />} external>
                Показать клиенту
              </Action>
            )}
            <Action href={`/agent/meetings/new?leadId=${id}`} icon={<Plus size={16} />}>
              Новая встреча
            </Action>
          </div>
        </aside>
      </div>
    </div>
  );
}

function RouteActionPanel({
  current,
  stage,
  nextAction,
  meta,
  firstMeetingId,
  caseId,
  cobrowse,
}: {
  current: number;
  stage: (typeof STAGE_ORDER)[number];
  nextAction: string;
  meta: string[];
  firstMeetingId: number | null;
  caseId: number;
  cobrowse: string | null;
}) {
  return (
    <section className="rise rise-1 mb-5 overflow-hidden rounded-[var(--radius-card)] border border-accent/20 bg-surface shadow-[var(--shadow-soft),var(--hl-top)]">
      <div className="grid min-w-0 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="order-2 min-w-0 border-t border-line bg-surface px-4 py-4 lg:order-1 lg:border-r lg:border-t-0">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="td-eyebrow">Маршрут кейса</span>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StagePill stage={stage} />
                <span className="text-[13px] text-ink-2">{meta.join(" · ")}</span>
              </div>
            </div>
            <span className="tnum w-fit rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[12px] font-semibold text-ink-2">
              {Math.round(((current + 1) / STAGE_ORDER.length) * 100)}%
            </span>
          </div>
          <ol className="grid gap-2 md:grid-cols-6">
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
                    <span className={`truncate text-[12px] ${active ? "font-semibold" : "font-medium"}`}>{s}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="td-accent-panel order-1 px-4 py-4 lg:order-2">
          <span className="td-eyebrow text-accent">Следующее действие</span>
          <strong className="mt-2 block text-[18px] leading-snug text-ink">{nextAction}</strong>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            Закройте этот шаг, затем обновите задачи и документы по итогам разговора.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
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
          </div>
        </div>
      </div>
    </section>
  );
}

function ruCount(count: number, forms: [string, string, string]) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const form = mod10 === 1 && mod100 !== 11
    ? forms[0]
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? forms[1]
      : forms[2];
  return `${count} ${form}`;
}

function MetaPill({ icon, label, value, href }: { icon: ReactNode; label: string; value: string; href?: string }) {
  const content = (
    <>
      <span className="text-accent">{icon}</span>
      <span className="text-ink-3">{label}</span>
      <span className="tnum font-semibold text-ink">{value}</span>
    </>
  );
  const cls = "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface-2/55 px-3 text-[12px] shadow-[var(--hl-top)]";
  if (href) {
    return (
      <a href={href} className={`${cls} transition-colors hover:border-line-strong hover:bg-surface-2`}>
        {content}
      </a>
    );
  }
  return (
    <span className={cls}>{content}</span>
  );
}

function OutcomeTile({ label, value, tone }: { label: string; value: string; tone: "neutral" | "success" | "warning" }) {
  const dot = tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-accent";
  const bg = tone === "success" ? "bg-success-soft/50" : tone === "warning" ? "bg-warning-soft/55" : "bg-surface-2/55";
  return (
    <div className={`rounded-[12px] border border-line px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] ${bg}`}>
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
      <span className="tnum mt-1 block truncate text-[14px] font-semibold text-ink">{value}</span>
    </div>
  );
}

function StagePill({ stage }: { stage: (typeof STAGE_ORDER)[number] }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink-2">
      <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[stage]}`} />
      {stage}
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
