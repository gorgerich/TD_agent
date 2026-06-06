import Link from "next/link";
import { ArrowRight, Files } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateShort } from "@/lib/format";

type DocumentFilter = "all" | "required" | "uploaded" | "ready";

type DocRow = {
  id: string;
  caseId: number;
  name: string;
  clientName: string;
  type: string;
  status: "Требуется" | "Загружен" | "Готово";
  filter: Exclude<DocumentFilter, "all">;
  date: Date;
};

const FILTERS: Array<{ id: DocumentFilter; label: string }> = [
  { id: "all", label: "Все" },
  { id: "required", label: "Требуются" },
  { id: "uploaded", label: "Загружены" },
  { id: "ready", label: "Готово" },
];

async function getDocuments(agentId: number): Promise<DocRow[]> {
  if (!agentId) return [];
  try {
    const leads = await prisma.clientLead.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      include: {
        meetings: {
          select: {
            quotes: { select: { versions: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } },
            orders: { select: { id: true, status: true, createdAt: true, signature: { select: { signedAt: true } } } },
          },
        },
      },
      take: 100,
    });

    return leads.flatMap((lead) => {
      const quoteDate = lead.meetings.flatMap((m) => m.quotes.flatMap((q) => q.versions))[0]?.createdAt;
      const order = lead.meetings.flatMap((m) => m.orders)[0];
      const rows: DocRow[] = [
        {
          id: `${lead.id}-case`,
          caseId: lead.id,
          name: "Карточка кейса",
          clientName: lead.name,
          type: "Кейс",
          status: "Готово",
          filter: "ready",
          date: lead.createdAt,
        },
        {
          id: `${lead.id}-quote`,
          caseId: lead.id,
          name: "Смета",
          clientName: lead.name,
          type: "Смета",
          status: quoteDate ? "Загружен" : "Требуется",
          filter: quoteDate ? "uploaded" : "required",
          date: quoteDate ?? lead.createdAt,
        },
        {
          id: `${lead.id}-contract`,
          caseId: lead.id,
          name: "Договор",
          clientName: lead.name,
          type: "Договор",
          status: order?.signature ? "Готово" : order ? "Загружен" : "Требуется",
          filter: order?.signature ? "ready" : order ? "uploaded" : "required",
          date: order?.signature?.signedAt ?? order?.createdAt ?? lead.createdAt,
        },
      ];

      if (order) {
        rows.push({
          id: `${lead.id}-payment`,
          caseId: lead.id,
          name: "Подтверждение оплаты",
          clientName: lead.name,
          type: "Оплата",
          status: ["PAID", "PARTIALLY_PAID", "COMPLETED"].includes(order.status.toUpperCase()) ? "Готово" : "Требуется",
          filter: ["PAID", "PARTIALLY_PAID", "COMPLETED"].includes(order.status.toUpperCase()) ? "ready" : "required",
          date: order.createdAt,
        });
      }

      return rows;
    });
  } catch {
    return [];
  }
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const activeFilter = FILTERS.some((item) => item.id === params?.status)
    ? (params?.status as DocumentFilter)
    : "all";
  const session = await getAgentSession();
  const docs = await getDocuments(session?.agentId ?? 0);
  const visible = activeFilter === "all" ? docs : docs.filter((doc) => doc.filter === activeFilter);

  return (
    <div className="td-page mx-auto max-w-[1180px] px-4 py-5 sm:px-7 sm:py-7">
      <header className="rise mb-5">
        <span className="td-eyebrow">Кейсы</span>
        <h1 className="mt-1.5 text-[28px] font-semibold leading-tight text-ink sm:text-[34px]">Документы</h1>
      </header>

      <FilterTabs base="/agent/documents" active={activeFilter} counts={{
        all: docs.length,
        required: docs.filter((doc) => doc.filter === "required").length,
        uploaded: docs.filter((doc) => doc.filter === "uploaded").length,
        ready: docs.filter((doc) => doc.filter === "ready").length,
      }} />

      {docs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rise rise-1 mt-4 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <div className="hidden grid-cols-[minmax(170px,1fr)_170px_110px_116px_90px_90px_96px] gap-3 border-b border-line bg-surface-2/55 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 lg:grid">
            <span>Документ</span>
            <span>Клиент</span>
            <span>Тип</span>
            <span>Статус</span>
            <span>Дата</span>
            <span>Кейс</span>
            <span>Действие</span>
          </div>
          {visible.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13.5px] text-ink-3">В этом фильтре документов нет</div>
          ) : (
            <ul>
              {visible.map((doc) => (
                <li key={doc.id} className="border-b border-line last:border-0">
                  <div className="grid gap-2 px-4 py-3 transition-colors hover:bg-surface-2/60 lg:grid-cols-[minmax(170px,1fr)_170px_110px_116px_90px_90px_96px] lg:items-center lg:gap-3">
                    <span className="truncate text-[14px] font-semibold text-ink">{doc.name}</span>
                    <span className="truncate text-[13.5px] text-ink-2">{doc.clientName}</span>
                    <span className="text-[12.5px] text-ink-3">{doc.type}</span>
                    <StatusBadge status={doc.status} />
                    <span className="text-[12.5px] text-ink-3">{dateShort(doc.date)}</span>
                    <Link href={`/agent/cases/${doc.caseId}`} className="text-[12.5px] font-medium text-accent hover:text-accent-hover">Кейс #{doc.caseId}</Link>
                    <Link href={`/agent/cases/${doc.caseId}`} className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] font-semibold text-ink transition-colors hover:border-line-strong">
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

function FilterTabs({ active, base, counts }: { active: DocumentFilter; base: string; counts: Record<DocumentFilter, number> }) {
  return (
    <nav className="rise flex gap-1.5 overflow-x-auto rounded-full border border-line bg-surface p-1" aria-label="Фильтр документов">
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

function StatusBadge({ status }: { status: DocRow["status"] }) {
  const cls = status === "Готово"
    ? "border-success/20 bg-success-soft text-success"
    : status === "Загружен"
      ? "border-accent/20 bg-accent-soft text-accent"
      : "border-warning/20 bg-warning-soft text-warning";
  return <span className={`w-fit rounded-full border px-2.5 py-1 text-[12px] font-medium ${cls}`}>{status}</span>;
}

function EmptyState() {
  return (
    <div className="rise rise-1 td-shell mt-4 px-6 py-12 text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
        <Files size={24} weight="duotone" />
      </span>
      <h2 className="text-[19px] font-semibold text-ink">Документов пока нет</h2>
      <p className="mx-auto mt-1.5 max-w-[380px] text-[13.5px] leading-relaxed text-ink-2">
        Здесь будут карточки кейсов, сметы, договоры и подтверждения оплаты. Требуемые документы видны отдельным фильтром.
      </p>
    </div>
  );
}
