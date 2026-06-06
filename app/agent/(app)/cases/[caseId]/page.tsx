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
} from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto";
import { phone as fmtPhone, dateTime } from "@/lib/format";
import { STAGE_ORDER, STAGE_DOT, NEXT_ACTION, deriveStage, stageIndex } from "@/lib/case";
import { TasksSection } from "./TasksSection";
import { NotesSection } from "./NotesSection";

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
  const [rawTasks, rawNotes] = await Promise.all([
    prisma.task.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" } }).catch(() => []),
    prisma.caseNote.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" } }).catch(() => []),
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

  // Derived activity feed
  const activity: Activity[] = [{ at: lead.createdAt.getTime(), label: "Дело создано" }];
  for (const m of meetings) {
    if (m.scheduledAt) activity.push({ at: m.scheduledAt.getTime(), label: "Встреча назначена", sub: dateTime(m.scheduledAt) });
  }
  for (const v of versions) activity.push({ at: v.createdAt.getTime(), label: "Смета сохранена" });
  for (const o of orders) activity.push({ at: o.createdAt.getTime(), label: `Заказ — ${o.status}` });
  activity.sort((a, b) => b.at - a.at);

  return (
    <div className="td-page mx-auto max-w-[1240px] px-4 py-7 sm:px-7 sm:py-10">
      <Link href="/agent/cases" className="rise inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink">
        <ArrowLeft size={15} /> К делам
      </Link>

      <header className="rise rise-1 mt-4 mb-8">
        <h1 className="font-serif text-[30px] leading-tight text-ink sm:text-[38px]">{lead.name}</h1>
        <p className="mt-1.5 flex items-center gap-2 text-[13.5px] text-ink-2">
          <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[stage]}`} />
          Этап: {stage} · {NEXT_ACTION[stage]}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[180px_1fr_300px]">
        {/* LEFT — timeline */}
        <nav aria-label="Этапы дела" className="rise rise-1 order-1">
          <Timeline current={curIdx} />
        </nav>

        {/* CENTER — operational */}
        <main className="rise rise-2 order-3 space-y-7 lg:order-2">
          <Card title="Чек-лист">
            <ul className="space-y-2.5">
              {checklist.map((it) => (
                <li key={it.label} className="flex items-center gap-2.5 text-[14px]">
                  {it.done
                    ? <Check size={17} weight="bold" className="flex-shrink-0 text-success" />
                    : <Circle size={17} className="flex-shrink-0 text-ink-3" />}
                  <span className={it.done ? "text-ink-2 line-through" : "text-ink"}>{it.label}</span>
                </li>
              ))}
            </ul>
          </Card>

          {context && (
            <Card title="Контекст">
              <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{context}</p>
            </Card>
          )}

          <Card title="Активность">
            <ol className="space-y-3.5">
              {activity.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1 flex-shrink-0">
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

          <Card title="Задачи">
            <TasksSection caseId={id} initial={tasks} />
          </Card>

          <Card title="Заметки">
            <NotesSection caseId={id} initial={notes} />
          </Card>
        </main>

        {/* RIGHT — info + quick actions */}
        <aside className="rise rise-2 order-2 space-y-6 lg:order-3">
          <div className="td-shell p-5">
            <Row label="Телефон" value={fmtPhone(lead.phone)} />
            <Row label="Источник" value={SOURCE_LABELS[lead.source] ?? lead.source} />
            <Row label="Этап" value={stage} />
            <Row label="Агент" value={session?.name ?? "—"} />
            <Row label="Заведено" value={dateTime(lead.createdAt)} last />
          </div>

          <div className="space-y-2.5">
            <span className="td-eyebrow">Действия</span>
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
    <ol className="relative">
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="td-shell p-5 sm:p-6">
      <h2 className="mb-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-3">{title}</h2>
      {children}
    </section>
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

function Action({ href, icon, children, primary, external }: { href: string; icon: React.ReactNode; children: React.ReactNode; primary?: boolean; external?: boolean }) {
  const cls = primary
    ? "bg-accent text-on-accent hover:bg-accent-hover"
    : "border border-line bg-surface text-ink hover:border-line-strong";
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener" } : {})}
      className={`flex min-h-11 w-full items-center gap-2.5 rounded-[12px] px-4 text-[13.5px] font-semibold transition-colors ${cls}`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {children}
    </Link>
  );
}
