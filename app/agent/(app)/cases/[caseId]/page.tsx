import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Circle,
  CalendarDots,
  FileText,
  ShareNetwork,
  Plus,
  ClockCounterClockwise,
  Files,
  ClipboardText,
} from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto";
import { phone as fmtPhone, dateTime } from "@/lib/format";
import { STAGE_ORDER, STAGE_DOT, NEXT_ACTION, deriveStage, stageIndex } from "@/lib/case";
import { TasksSection } from "./TasksSection";
import { NotesSection } from "./NotesSection";
import { DocumentsSection } from "./DocumentsSection";

const SOURCE_LABELS: Record<string, string> = {
  agent: "Агент", telegram: "Telegram", form: "Форма", referral: "Рекомендация",
};

type Activity = { at: number; label: string; sub?: string };

async function getCase(caseId: number, agentId: number) {
  try {
    return await prisma.clientLead.findFirst({
      where: { id: caseId, ...(agentId ? { agentId } : {}) },
      include: {
        meetings: {
          orderBy: { id: "asc" },
          select: {
            id: true, status: true, scheduledAt: true, cobrowseCode: true,
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

  // Tasks + Notes (P5) — fetched separately; notes body decrypted server-side.
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

  // Derived checklist (read-only статусы — без отдельной таблицы)
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
  for (const o of orders) activity.push({ at: o.createdAt.getTime(), label: `Заказ — ${o.status}` });
  activity.sort((a, b) => b.at - a.at);

  return (
    <div className="td-page mx-auto max-w-[1280px] px-4 py-6 sm:px-7 sm:py-8">
      <Link href="/agent/cases" className="rise inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={15} /> К кейсам
      </Link>

      <header className="rise rise-1 mt-4 mb-6 flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="td-eyebrow">Кейс #{id}</span>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">{lead.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-2">
            <StagePill stage={stage} />
            <span>{NEXT_ACTION[stage]}</span>
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:w-[330px]">
          <Stat label="Встречи" value={String(meetings.length)} />
          <Stat label="Сметы" value={String(versions.length)} />
          <Stat label="Заказы" value={String(orders.length)} />
        </div>
      </header>

      <section className="rise rise-1 mb-5 grid gap-3 rounded-[var(--radius-card)] border border-accent/20 bg-accent-soft px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <span className="td-eyebrow text-accent">Следующее действие</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StagePill stage={stage} />
            <strong className="text-[17px] font-semibold text-ink">{NEXT_ACTION[stage]}</strong>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {firstMeeting ? (
            <Action href={`/agent/meetings/${firstMeeting.id}/quote`} icon={<FileText size={16} />} primary compact>
              Открыть смету
            </Action>
          ) : (
            <Action href={`/agent/meetings/new?leadId=${id}`} icon={<CalendarDots size={16} />} primary compact>
              Назначить встречу
            </Action>
          )}
          {cobrowse && (
            <Action href={`/co/${cobrowse}`} icon={<ShareNetwork size={16} />} external compact>
              Показать клиенту
            </Action>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[190px_1fr_310px]">
        {/* LEFT — timeline */}
        <nav aria-label="Этапы кейса" className="rise rise-1 order-1">
          <Timeline current={curIdx} />
        </nav>

        {/* CENTER — operational */}
        <main className="rise rise-2 order-3 space-y-5 lg:order-2">
          <Card title="Чек-лист текущего этапа" icon={<ClipboardText size={16} weight="duotone" />}>
            <ul className="grid gap-2 sm:grid-cols-2">
              {checklist.map((it) => (
                <li key={it.label} className="flex items-center gap-2.5 rounded-[12px] border border-line bg-surface-2/45 px-3 py-2.5 text-[13.5px]">
                  {it.done
                    ? <Check size={17} weight="bold" className="flex-shrink-0 text-success" />
                    : <Circle size={17} className="flex-shrink-0 text-ink-3" />}
                  <span className={it.done ? "text-ink-2 line-through" : "text-ink"}>{it.label}</span>
                </li>
              ))}
            </ul>
          </Card>

          {context && (
            <Card title="Контекст" icon={<FileText size={16} weight="duotone" />}>
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{context}</p>
            </Card>
          )}

          <Card title="Активность" icon={<ClockCounterClockwise size={16} weight="duotone" />}>
            <ol className="divide-y divide-line">
              {activity.map((a, i) => (
                <li key={i} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="mt-0.5 flex-shrink-0">
                    <ClockCounterClockwise size={15} className="text-ink-3" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] text-ink">{a.label}</span>
                    {a.sub && <span className="block text-[12px] text-ink-3">{a.sub}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <Card title={`Задачи · ${tasks.filter((task) => !task.completedAt).length}`} icon={<ClipboardText size={16} weight="duotone" />}>
            <TasksSection caseId={id} initial={tasks} />
          </Card>

          <Card title={`Заметки · ${notes.length}`} icon={<FileText size={16} weight="duotone" />}>
            <NotesSection caseId={id} initial={notes} />
          </Card>

          <Card title={`Документы · ${docs.length}`} icon={<Files size={16} weight="duotone" />}>
            <DocumentsSection caseId={id} initial={docs} />
          </Card>
        </main>

        {/* RIGHT — info + quick actions */}
        <aside className="rise rise-2 order-2 space-y-6 lg:order-3">
          <div className="td-shell p-4">
            <Row label="Телефон" value={fmtPhone(lead.phone)} />
            <Row label="Источник" value={SOURCE_LABELS[lead.source] ?? lead.source} />
            <Row label="Этап" value={stage} />
            <Row label="Агент" value={session?.name ?? "—"} />
            <Row label="Заведено" value={dateTime(lead.createdAt)} last />
          </div>

          <div className="td-shell space-y-2.5 p-4">
            <span className="td-eyebrow">Быстрые действия</span>
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

function Timeline({ current }: { current: number }) {
  return (
    <ol className="relative rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <li className="mb-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">Маршрут кейса</li>
      {STAGE_ORDER.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex gap-3 pb-5 last:pb-0">
            <span className="relative flex flex-col items-center">
              <span className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                active ? "bg-accent text-on-accent" : done ? "bg-accent-soft text-accent" : "border border-line bg-surface text-ink-3"
              }`}>
                {done ? <Check size={13} weight="bold" /> : i + 1}
              </span>
              {i < STAGE_ORDER.length - 1 && <span className={`mt-1 w-px flex-1 ${i < current ? "bg-accent/40" : "bg-line"}`} />}
            </span>
            <span className={`pt-0.5 text-[13.5px] ${active ? "font-semibold text-ink" : done ? "text-ink-2" : "text-ink-3"}`}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="td-shell p-4 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-line bg-surface-2/55 px-3 py-2">
      <span className="block text-[11px] text-ink-3">{label}</span>
      <span className="tnum mt-0.5 block text-[18px] font-semibold text-ink">{value}</span>
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

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 ${last ? "" : "border-b border-line"}`}>
      <span className="text-[12.5px] text-ink-3">{label}</span>
      <span className="tnum text-right text-[13.5px] font-medium text-ink">{value}</span>
    </div>
  );
}

function Action({ href, icon, children, primary, external, compact }: { href: string; icon: React.ReactNode; children: React.ReactNode; primary?: boolean; external?: boolean; compact?: boolean }) {
  const cls = primary
    ? "bg-accent text-on-accent hover:bg-accent-hover shadow-[0_1px_2px_rgba(20,30,24,0.25),0_6px_16px_-8px_rgba(20,30,24,0.40),inset_0_1px_0_rgba(255,255,255,0.16)]"
    : "border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_1px_2px_rgba(40,30,18,0.05)]";
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      className={`flex min-h-11 items-center gap-2.5 rounded-[12px] px-4 text-[13.5px] font-semibold transition-[background-color,border-color,box-shadow] duration-150 ${compact ? "w-auto" : "w-full"} ${cls}`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {children}
    </Link>
  );
}
