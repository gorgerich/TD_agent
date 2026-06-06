import Link from "next/link";
import { ArrowRight, FileText, Plus } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateShort, moneyFromKopecks } from "@/lib/format";

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

  return (
    <div className="td-page mx-auto max-w-[1180px] px-4 py-5 sm:px-7 sm:py-7">
      <header className="rise mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="td-eyebrow">Расчёты</span>
          <h1 className="mt-1.5 text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">Сметы</h1>
        </div>
        <Link href="/agent/cases" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent transition-colors hover:bg-accent-hover">
          <Plus size={14} weight="bold" /> Новая смета
        </Link>
      </header>

      <FilterTabs base="/agent/estimates" active={activeFilter} counts={{
        all: estimates.length,
        drafts: estimates.filter((row) => row.filter === "drafts").length,
        sent: estimates.filter((row) => row.filter === "sent").length,
        agreed: estimates.filter((row) => row.filter === "agreed").length,
      }} />

      {estimates.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rise rise-1 mt-4 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(190px,1fr)_122px_118px_96px_90px_96px] gap-3 border-b border-line bg-surface-2/55 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 md:grid">
            <span>Клиент</span>
            <span>Сумма</span>
            <span>Статус</span>
            <span>Дата</span>
            <span>Кейс</span>
            <span>Действие</span>
          </div>
          {visible.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-ink-3">В этом фильтре смет нет</div>
          ) : (
            <ul>
              {visible.map((estimate) => (
                <li key={estimate.id} className="border-b border-line last:border-0">
                  <div className="grid gap-2 px-4 py-3 transition-colors hover:bg-surface-2/60 md:grid-cols-[minmax(190px,1fr)_122px_118px_96px_90px_96px] md:items-center md:gap-3">
                    <Link href={`/agent/cases/${estimate.caseId}`} className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-ink">{estimate.clientName}</span>
                      <span className="mt-0.5 block text-[12px] text-ink-3 md:hidden">Кейс #{estimate.caseId}</span>
                    </Link>
                    <span className="tnum text-[13.5px] font-semibold text-ink">{moneyFromKopecks(estimate.total)}</span>
                    <StatusBadge status={estimate.status} />
                    <span className="text-[12.5px] text-ink-3">{dateShort(estimate.createdAt)}</span>
                    <Link href={`/agent/cases/${estimate.caseId}`} className="hidden text-[12.5px] font-medium text-accent hover:text-accent-hover md:inline">Кейс #{estimate.caseId}</Link>
                    <Link href={`/agent/meetings/${estimate.meetingId}/quote`} className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink transition-colors hover:border-line-strong">
                      Открыть <ArrowRight size={13} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FilterTabs({ active, base, counts }: { active: EstimateFilter; base: string; counts: Record<EstimateFilter, number> }) {
  return (
    <nav className="rise flex gap-1.5 overflow-x-auto rounded-full border border-line bg-surface p-1" aria-label="Фильтр смет">
      {FILTERS.map((item) => (
        <Link
          key={item.id}
          href={item.id === "all" ? base : `${base}?status=${item.id}`}
          className={`inline-flex min-h-9 flex-shrink-0 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold transition-colors ${
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
    <div className="rise rise-1 td-shell mt-4 px-6 py-12 text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
        <FileText size={24} weight="duotone" />
      </span>
      <h2 className="text-[19px] font-semibold text-ink">Смет пока нет</h2>
      <p className="mx-auto mt-1.5 max-w-[360px] text-[13.5px] leading-relaxed text-ink-2">
        Смета создаётся из кейса или встречи. Откройте кейс, соберите услуги и сохраните версию.
      </p>
    </div>
  );
}
