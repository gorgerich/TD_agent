import Link from "next/link";
import { ArrowRight, Briefcase, FileText } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateShort, moneyFromKopecks } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";

type EstimateFilter = "all" | "drafts" | "sent" | "agreed";

type EstimateRow = {
  id: number;
  caseId: number;
  meetingId: number;
  clientName: string;
  total: number;
  status: "Черновик" | "Отправлена" | "Согласована";
  filter: Exclude<EstimateFilter, "all">;
  createdAt: Date | null;
};

const FILTERS: Array<{ id: EstimateFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "drafts", label: "Черновики" },
  { id: "sent", label: "Отправлены" },
  { id: "agreed", label: "Согласованы" },
];

async function getEstimates(agentId: number): Promise<EstimateRow[]> {
  if (!agentId) return [];
  try {
    const quotes = await prisma.quote.findMany({
      where: { meeting: { agentId } },
      orderBy: { id: "desc" },
      include: {
        meeting: { select: { id: true, lead: { select: { id: true, name: true } } } },
        order: { select: { status: true } },
        versions: { orderBy: { createdAt: "desc" }, take: 1, select: { total: true, createdAt: true } },
      },
      take: 100,
    });

    return quotes.map((q) => {
      const latest = q.versions[0];
      const agreed = Boolean(q.order && !["PENDING", "CANCELED"].includes(q.order.status.toUpperCase()));
      const status = agreed ? "Согласована" : latest ? "Отправлена" : "Черновик";
      return {
        id: q.id,
        caseId: q.meeting.lead.id,
        meetingId: q.meeting.id,
        clientName: q.meeting.lead.name,
        total: latest?.total ?? 0,
        status,
        filter: status === "Черновик" ? "drafts" : status === "Согласована" ? "agreed" : "sent",
        createdAt: latest?.createdAt ?? null,
      };
    });
  } catch {
    return [];
  }
}

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const activeFilter = FILTERS.some((item) => item.id === params?.status)
    ? (params?.status as EstimateFilter)
    : "all";
  const session = await getAgentSession();
  const estimates = await getEstimates(session?.agentId ?? 0);
  const visible = activeFilter === "all" ? estimates : estimates.filter((row) => row.filter === activeFilter);
  const counts = {
    all: estimates.length,
    drafts: estimates.filter((row) => row.filter === "drafts").length,
    sent: estimates.filter((row) => row.filter === "sent").length,
    agreed: estimates.filter((row) => row.filter === "agreed").length,
  };
  const liveTotal = estimates.reduce((sum, row) => sum + row.total, 0);

  return (
    <div className="td-page mx-auto w-full max-w-[1180px] overflow-x-hidden px-4 py-5 sm:px-7 sm:py-7">
      <header className="rise mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="td-eyebrow">Расчёты</span>
          <h1 className="td-display mt-1.5 text-[28px] text-ink sm:text-[34px]">Сметы</h1>
        </div>
        <Link href="/agent/cases" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-hover">
          <Briefcase size={14} weight="bold" /> Выбрать кейс для сметы
        </Link>
      </header>

      {estimates.length > 0 && (
        <div className="rise mb-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Всего смет" value={String(counts.all)} />
          <Stat label="Черновики" value={String(counts.drafts)} />
          <Stat label="Согласованы" value={String(counts.agreed)} />
          <Stat label="Сумма в работе" value={moneyFromKopecks(liveTotal)} />
        </div>
      )}

      <FilterTabs base="/agent/estimates" active={activeFilter} counts={counts} />

      {estimates.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rise rise-1 mt-4 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-soft),var(--hl-top)]">
          {visible.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-ink-3">В этом фильтре смет нет</div>
          ) : (
            <ul className="min-w-0">
              {visible.map((estimate) => {
                const bar = estimate.filter === "agreed" ? "before:bg-success" : estimate.filter === "sent" ? "before:bg-info" : "before:bg-ink-3";
                return (
                  <li key={estimate.id} className="border-b border-line last:border-0">
                    <div className={`group relative grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 py-3.5 pl-5 pr-4 transition-colors hover:bg-surface-2/50 before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-r-full sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${bar}`}>
                      <Link href={`/agent/cases/${estimate.caseId}`} className="min-w-0 flex-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-[14px] font-semibold text-ink">{estimate.clientName}</span>
                          <StatusBadge status={estimate.status} />
                        </span>
                        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
                          <span className="tnum font-semibold text-gold">{moneyFromKopecks(estimate.total)}</span>
                          <span className="text-ink-3">·</span>
                          <span className="text-ink-3">{dateShort(estimate.createdAt)}</span>
                          <span className="text-ink-3">·</span>
                          <span className="text-ink-3">Кейс #{estimate.caseId}</span>
                        </span>
                      </Link>
                      <Link href={`/agent/meetings/${estimate.meetingId}/quote`} className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[12px] font-semibold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition-colors hover:border-line-strong hover:bg-surface-2" aria-label={`Открыть смету клиента ${estimate.clientName}`}>
                        Открыть <ArrowRight size={13} />
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-line bg-surface px-3 py-2.5 shadow-[var(--hl-top)]">
      <div className="truncate text-[11px] font-medium text-ink-3">{label}</div>
      <div className="tnum mt-0.5 truncate text-[15px] font-semibold text-ink">{value}</div>
    </div>
  );
}

function FilterTabs({ active, base, counts }: { active: EstimateFilter; base: string; counts: Record<EstimateFilter, number> }) {
  return (
    <nav className="rise flex min-w-0 gap-1.5 overflow-x-auto rounded-full border border-line bg-surface p-1" aria-label="Фильтр смет">
      {FILTERS.map((item) => (
        <Link
          key={item.id}
          href={item.id === "all" ? base : `${base}?status=${item.id}`}
          className={`inline-flex min-h-9 flex-shrink-0 items-center gap-2 rounded-full px-3 text-[12px] font-semibold transition-colors ${
            active === item.id ? "bg-accent text-on-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {item.label}
          <span className={`tnum text-[11px] ${active === item.id ? "text-on-accent/75" : "text-ink-3"}`}>{counts[item.id]}</span>
        </Link>
      ))}
    </nav>
  );
}

function StatusBadge({ status }: { status: EstimateRow["status"] }) {
  const cls = status === "Согласована"
    ? "border-success/20 bg-success-soft text-success"
    : status === "Отправлена"
      ? "border-accent/20 bg-accent-soft text-accent"
      : "border-line bg-surface text-ink-2";
  return <span className={`w-fit rounded-full border px-2.5 py-1 text-[12px] font-medium ${cls}`}>{status}</span>;
}

function EmptyState() {
  return (
    <div className="rise rise-1 td-shell mt-4 px-6 py-14 text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
        <FileText size={24} weight="duotone" />
      </span>
      <h2 className="td-display text-[24px] text-ink">Смет пока нет</h2>
      <p className="mx-auto mt-2 max-w-[380px] text-[14px] leading-relaxed text-ink-2">
        Смета собирается внутри кейса: откройте дело, добавьте услуги и сохраните версию — она появится здесь и у клиента.
      </p>
      <Link href="/agent/cases" className={buttonClasses({ className: "mt-6" })}>
        <Briefcase size={16} weight="bold" /> Выбрать кейс
      </Link>
    </div>
  );
}
