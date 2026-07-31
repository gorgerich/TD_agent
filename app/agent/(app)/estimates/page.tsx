import Link from "next/link";
import { ArrowRight, Briefcase, FileText } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import type { AgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateShort, moneyFromKopecks } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";

type EstimateFilter = "all" | "drafts" | "sent" | "agreed";

type EstimateRow = {
  id: number;
  caseId: number;
  meetingId: number;
  clientName: string;
  total: number | null;
  version: number | null;
  priceBlocked: boolean;
  status: "Черновик" | "Отправлена" | "Нужны изменения" | "Согласована";
  filter: Exclude<EstimateFilter, "all">;
  createdAt: Date | null;
};

const FILTERS: Array<{ id: EstimateFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "drafts", label: "Черновики" },
  { id: "sent", label: "Отправлены" },
  { id: "agreed", label: "Согласованы" },
];

async function getEstimates(session: AgentSession): Promise<EstimateRow[]> {
  const quotes = await prisma.quote.findMany({
      where: {
        organizationId: session.organizationId,
        ...(session.role === "AGENT" ? { ownerMembershipId: session.membershipId } : {}),
      },
      orderBy: { id: "desc" },
      include: {
        meeting: { select: { id: true, lead: { select: { id: true, name: true } } } },
        activeDraftVersion: { select: { total: true, totalState: true, updatedAt: true } },
        latestPublishedVersion: {
          select: {
            total: true,
            totalState: true,
            versionNumber: true,
            publishedAt: true,
            decisions: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true } },
          },
        },
      },
      take: 100,
    });

    return quotes.map((q) => {
      const agreed = q.status === "ACCEPTED";
      const published = q.latestPublishedVersion;
      const draft = q.activeDraftVersion;
      const changesRequested = published?.decisions[0]?.type === "CHANGES_REQUESTED";
      const status = agreed ? "Согласована" : changesRequested ? "Нужны изменения" : published ? "Отправлена" : "Черновик";
      const source = published ?? draft;
      return {
        id: q.id,
        caseId: q.meeting.lead.id,
        meetingId: q.meeting.id,
        clientName: q.meeting.lead.name,
        total: source?.totalState === "KNOWN" ? source.total : null,
        version: published?.versionNumber ?? null,
        priceBlocked: draft ? draft.totalState !== "KNOWN" : source?.totalState !== "KNOWN",
        status,
        filter: status === "Черновик" ? "drafts" : status === "Согласована" ? "agreed" : "sent",
        createdAt: published?.publishedAt ?? draft?.updatedAt ?? null,
      };
    });
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
  if (!session) return null;
  const estimates = await getEstimates(session);
  const visible = activeFilter === "all" ? estimates : estimates.filter((row) => row.filter === activeFilter);
  const counts = {
    all: estimates.length,
    drafts: estimates.filter((row) => row.filter === "drafts").length,
    sent: estimates.filter((row) => row.filter === "sent").length,
    agreed: estimates.filter((row) => row.filter === "agreed").length,
  };
  const knownTotal = estimates.reduce((sum, row) => row.total === null ? sum : sum + row.total, 0);
  const blockedPrices = estimates.filter((row) => row.priceBlocked).length;

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise td-page-header mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="td-eyebrow">Расчёты</span>
          <h1 className="td-display mt-1.5 text-[30px] text-ink sm:text-[38px]">Сметы</h1>
        </div>
        <Link href="/agent/cases" className={buttonClasses({ size: "sm", className: "self-start flex-shrink-0" })}>
          <Briefcase size={14} weight="bold" /> Выбрать кейс для сметы
        </Link>
      </header>

      {estimates.length > 0 && (
        <div className="rise mb-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Всего смет" value={String(counts.all)} />
          <Stat label="Черновики" value={String(counts.drafts)} />
          <Stat label="Требуют цены" value={String(blockedPrices)} />
          <Stat label="Известная сумма" value={moneyFromKopecks(knownTotal)} />
        </div>
      )}

      <SegmentedTabs
        ariaLabel="Фильтр смет"
        active={activeFilter}
        segments={FILTERS.map((f) => ({ id: f.id, label: f.label, count: counts[f.id] }))}
        hrefFor={(id) => (id === "all" ? "/agent/estimates" : `/agent/estimates?status=${id}`)}
      />

      {estimates.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<FileText size={28} weight="fill" />}
          eyebrow="Сметы"
          title="Смет пока нет"
          description="Смета собирается внутри кейса: откройте клиента, добавьте услуги и сохраните версию. После этого смета появится здесь."
          primaryAction={{ label: "Выбрать кейс", href: "/agent/cases" }}
        />
      ) : (
        <div className="rise rise-1 td-entity-list mt-4">
          {visible.length === 0 ? (
            <EmptyState
              className="m-3 py-10 sm:py-12"
              icon={<FileText size={26} weight="fill" />}
              title="В этом фильтре смет нет"
              description="Смените статус или вернитесь ко всем сметам."
              secondaryAction={{ label: "Показать все", href: "/agent/estimates" }}
            />
          ) : (
            <ul className="min-w-0">
              {visible.map((estimate) => {
                return (
                  <li key={estimate.id} className="border-b border-line last:border-0">
                    <div className="td-entity-row group grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <Link href={`/agent/cases/${estimate.caseId}`} className="min-w-0 flex-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-[14px] font-semibold text-ink">{estimate.clientName}</span>
                          <StatusBadge status={estimate.status} />
                        </span>
                        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
                          <span className="tnum font-semibold text-gold">
                            {estimate.total === null ? "Цена требует уточнения" : moneyFromKopecks(estimate.total)}
                          </span>
                          {estimate.version && <span className="text-ink-3">v{estimate.version}</span>}
                          {estimate.priceBlocked && (
                            <span className="font-medium text-danger">Черновик: нужна цена</span>
                          )}
                          <span className="text-ink-3">·</span>
                          <span className="text-ink-3">{dateShort(estimate.createdAt)}</span>
                          <span className="text-ink-3">·</span>
                          <span className="text-ink-3">Кейс #{estimate.caseId}</span>
                        </span>
                      </Link>
                      <Link href={`/agent/meetings/${estimate.meetingId}/quote`} className={buttonClasses({ variant: "secondary", size: "sm", className: "w-fit" })} aria-label={`Открыть смету клиента ${estimate.clientName}`}>
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
    <div className="td-metric">
      <div className="truncate text-[11px] font-medium text-ink-3">{label}</div>
      <div className="tnum mt-0.5 truncate text-[15px] font-semibold text-ink">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: EstimateRow["status"] }) {
  return <span className="text-[12px] font-semibold text-ink-2">{status}</span>;
}
