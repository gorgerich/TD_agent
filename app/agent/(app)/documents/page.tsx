import Link from "next/link";
import { ArrowRight, ArrowSquareOut, CheckCircle, Files, FilePdf, FileImage, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateShort } from "@/lib/format";

const CATEGORIES = ["Свидетельство о смерти", "Паспорт", "Договор", "Доверенность", "Прочее"] as const;
type Category = (typeof CATEGORIES)[number];

type DocRow = {
  id: string;
  caseId: number;
  clientName: string;
  title: string;
  name: string;
  category: string;
  status: "Требуется" | "Загружен";
  url: string | null;
  mimeType: string | null;
  size: number | null;
  createdAt: Date;
};

const REQUIRED_DOCUMENTS: Array<{ category: Category; title: string }> = [
  { category: "Свидетельство о смерти", title: "Свидетельство о смерти" },
  { category: "Паспорт", title: "Паспорт заявителя" },
  { category: "Договор", title: "Договор" },
  { category: "Доверенность", title: "Доверенность" },
];

function fmtSize(b: number) {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} КБ`;
  return `${(b / 1024 / 1024).toFixed(1)} МБ`;
}

async function getDocuments(agentId: number): Promise<DocRow[]> {
  if (!agentId) return [];
  try {
    const leads = await prisma.clientLead.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        createdAt: true,
        documents: {
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, category: true, url: true, mimeType: true, size: true, createdAt: true },
        },
      },
    });
    return leads.flatMap((lead) => {
      const required = REQUIRED_DOCUMENTS.map((template) => {
        const uploaded = lead.documents.find((d) => d.category === template.category);
        return {
          id: uploaded ? `doc-${uploaded.id}` : `missing-${lead.id}-${template.category}`,
          caseId: lead.id,
          clientName: lead.name,
          title: template.title,
          name: uploaded?.name ?? template.title,
          category: template.category,
          status: uploaded ? "Загружен" : "Требуется",
          url: uploaded?.url ?? null,
          mimeType: uploaded?.mimeType ?? null,
          size: uploaded?.size ?? null,
          createdAt: uploaded?.createdAt ?? lead.createdAt,
        } satisfies DocRow;
      });
      const other = lead.documents
        .filter((d) => !REQUIRED_DOCUMENTS.some((template) => template.category === d.category))
        .map((d) => ({
          id: `doc-${d.id}`,
          caseId: lead.id,
          clientName: lead.name,
          title: d.category,
          name: d.name,
          category: d.category,
          status: "Загружен" as const,
          url: d.url,
          mimeType: d.mimeType,
          size: d.size,
          createdAt: d.createdAt,
        }));
      return [...required, ...other];
    });
  } catch {
    return [];
  }
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams?: Promise<{ cat?: string }>;
}) {
  const params = await searchParams;
  const activeCat = (CATEGORIES as readonly string[]).includes(params?.cat ?? "") ? (params!.cat as Category) : "all";
  const session = await getAgentSession();
  const docs = await getDocuments(session?.agentId ?? 0);
  const visible = activeCat === "all" ? docs : docs.filter((d) => d.category === activeCat);
  const requiredCount = docs.filter((d) => d.status === "Требуется").length;
  const uploadedCount = docs.filter((d) => d.status === "Загружен").length;

  return (
    <div className="td-page mx-auto max-w-[1180px] px-4 py-5 sm:px-7 sm:py-7">
      <header className="rise mb-5">
        <span className="td-eyebrow">Файлы кейсов</span>
        <h1 className="td-display mt-1.5 text-[28px] text-ink sm:text-[34px]">Документы</h1>
        <p className="mt-2 text-[13px] text-ink-2">
          <span className="font-semibold text-ink">{requiredCount}</span> требуется · <span className="font-semibold text-ink">{uploadedCount}</span> загружено
        </p>
      </header>

      {docs.length > 0 && (
        <FilterTabs active={activeCat} counts={Object.fromEntries(CATEGORIES.map((c) => [c, docs.filter((d) => d.category === c).length])) as Record<string, number>} total={docs.length} />
      )}

      {docs.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rise rise-1 mt-4 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-soft),var(--hl-top)]">
          {visible.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-ink-3">В этой категории документов нет</div>
          ) : (
            <ul>
              {visible.map((doc) => {
                const isPdf = doc.mimeType === "application/pdf";
                const isUploaded = doc.status === "Загружен";
                return (
                  <li key={doc.id} className="border-b border-line last:border-0">
                    <div className="group flex items-center gap-3.5 py-3.5 pl-4 pr-4 transition-colors hover:bg-surface-2/50">
                      <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[10px] bg-surface-2 ring-1 ring-line">
                        {isUploaded ? (
                          isPdf ? <FilePdf size={20} weight="duotone" className="text-danger" /> : <FileImage size={20} weight="duotone" className="text-info" />
                        ) : (
                          <WarningCircle size={20} weight="duotone" className="text-warning" />
                        )}
                      </span>
                      <Link href={`/agent/cases/${doc.caseId}`} className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-ink">{doc.name}</span>
                        <span className="mt-1 flex items-center gap-2 text-[12px] text-ink-2">
                          <span className="truncate">{doc.clientName}</span>
                          <span className="text-ink-3">·</span>
                          <span className="text-ink-3">{doc.category}</span>
                          <span className="text-ink-3">·</span>
                          <StatusBadge status={doc.status} />
                          {doc.size != null && (
                            <>
                              <span className="text-ink-3">·</span>
                              <span className="text-ink-3">{fmtSize(doc.size)}</span>
                            </>
                          )}
                          <span className="text-ink-3">·</span>
                          <span className="text-ink-3">{dateShort(doc.createdAt)}</span>
                        </span>
                      </Link>
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noopener" className="inline-flex min-h-9 w-fit flex-shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[12px] font-semibold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition-colors hover:border-line-strong hover:bg-surface-2">
                          Открыть <ArrowSquareOut size={13} />
                        </a>
                      ) : (
                        <Link href={`/agent/cases/${doc.caseId}`} className="inline-flex min-h-9 w-fit flex-shrink-0 items-center gap-1.5 rounded-full border border-warning/25 bg-warning-soft px-3.5 text-[12px] font-semibold text-warning transition-colors hover:bg-warning-soft/70">
                          К кейсу <ArrowRight size={13} />
                        </Link>
                      )}
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

function StatusBadge({ status }: { status: DocRow["status"] }) {
  const cls = status === "Загружен"
    ? "border-success/20 bg-success-soft text-success"
    : "border-warning/20 bg-warning-soft text-warning";
  const Icon = status === "Загружен" ? CheckCircle : WarningCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      <Icon size={11} weight={status === "Загружен" ? "fill" : "duotone"} />
      {status}
    </span>
  );
}

function FilterTabs({ active, counts, total }: { active: string; counts: Record<string, number>; total: number }) {
  const base = "/agent/documents";
  const items: Array<{ id: string; label: string; count: number }> = [
    { id: "all", label: "Все", count: total },
    ...CATEGORIES.map((c) => ({ id: c, label: c, count: counts[c] ?? 0 })),
  ];
  return (
    <nav className="rise flex gap-1.5 overflow-x-auto rounded-full border border-line bg-surface p-1" aria-label="Фильтр документов">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.id === "all" ? base : `${base}?cat=${encodeURIComponent(item.id)}`}
          className={`inline-flex min-h-9 flex-shrink-0 items-center gap-2 rounded-full px-3 text-[12px] font-semibold transition-colors ${
            active === item.id ? "bg-accent text-on-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {item.label}
          <span className={`tnum text-[11px] ${active === item.id ? "text-on-accent/75" : "text-ink-3"}`}>{item.count}</span>
        </Link>
      ))}
    </nav>
  );
}

function EmptyState() {
  return (
    <div className="rise rise-1 td-shell mt-4 px-6 py-12 text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
        <Files size={24} weight="duotone" />
      </span>
      <h2 className="text-[18px] font-semibold text-ink">Документов пока нет</h2>
      <p className="mx-auto mt-1.5 max-w-[400px] text-[13px] leading-relaxed text-ink-2">
        Загружайте свидетельства, паспорта и договоры внутри карточки кейса — все файлы соберутся здесь.
      </p>
    </div>
  );
}
