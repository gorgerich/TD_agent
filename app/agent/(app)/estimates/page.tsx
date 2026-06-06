import Link from "next/link";
import { ArrowRight, FileText, Plus } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateShort, moneyFromKopecks } from "@/lib/format";

type EstimateRow = {
  id: number;
  meetingId: number;
  clientName: string;
  total: number;
  status: string;
  createdAt: Date | null;
};

async function getEstimates(agentId: number): Promise<EstimateRow[]> {
  if (!agentId) return [];
  try {
    const quotes = await prisma.quote.findMany({
      where: { meeting: { agentId } },
      orderBy: { id: "desc" },
      include: {
        meeting: { select: { id: true, lead: { select: { name: true } } } },
        order: { select: { status: true } },
        versions: { orderBy: { createdAt: "desc" }, take: 1, select: { total: true, createdAt: true } },
      },
      take: 80,
    });

    return quotes.map((q) => {
      const latest = q.versions[0];
      return {
        id: q.id,
        meetingId: q.meeting.id,
        clientName: q.meeting.lead.name,
        total: latest?.total ?? 0,
        status: q.order?.status ? `Заказ: ${q.order.status}` : latest ? "Сохранена" : "Черновик",
        createdAt: latest?.createdAt ?? null,
      };
    });
  } catch {
    return [];
  }
}

export default async function EstimatesPage() {
  const session = await getAgentSession();
  const estimates = await getEstimates(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto max-w-[1100px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-6 flex items-end justify-between gap-4">
        <div>
          <span className="td-eyebrow">Расчёты</span>
          <h1 className="mt-2 text-[30px] font-semibold leading-tight text-ink sm:text-[36px]">Сметы</h1>
        </div>
        <Link href="/agent/meetings/new" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-accent-hover">
          <Plus size={15} weight="bold" /> Новая встреча
        </Link>
      </header>

      {estimates.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="rise rise-1 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <li className="hidden grid-cols-[minmax(220px,1fr)_130px_150px_110px_28px] gap-3 border-b border-line bg-surface-2/55 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 md:grid">
            <span>Клиент</span>
            <span>Сумма</span>
            <span>Статус</span>
            <span>Дата</span>
            <span />
          </li>
          {estimates.map((estimate) => (
            <li key={estimate.id} className="border-b border-line last:border-0">
              <Link href={`/agent/meetings/${estimate.meetingId}/quote`} className="group grid gap-2 px-4 py-3.5 transition-colors hover:bg-surface-2/60 md:grid-cols-[minmax(220px,1fr)_130px_150px_110px_28px] md:items-center md:gap-3">
                <span className="truncate text-[14.5px] font-semibold text-ink">{estimate.clientName}</span>
                <span className="tnum text-[13.5px] font-semibold text-ink">{moneyFromKopecks(estimate.total)}</span>
                <span className="w-fit rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2">{estimate.status}</span>
                <span className="text-[12.5px] text-ink-3">{dateShort(estimate.createdAt)}</span>
                <ArrowRight size={15} className="hidden text-ink-3 transition-colors group-hover:text-accent md:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rise rise-1 td-shell px-6 py-14 text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
        <FileText size={26} weight="duotone" />
      </span>
      <h2 className="text-[20px] font-semibold text-ink">Смет пока нет</h2>
      <p className="mx-auto mt-1.5 max-w-[340px] text-[13.5px] leading-relaxed text-ink-2">
        Сметы появятся после сохранения расчёта во встрече.
      </p>
    </div>
  );
}
