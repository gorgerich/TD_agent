import Link from "next/link";
import { ArrowRight, ArrowSquareOut, CheckCircle, Files, FilePdf, FileImage, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateShort } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";

type Category = "Свидетельство о смерти" | "Паспорт" | "Договор" | "Доверенность" | "Прочее";
type DocumentFilter = "all" | "required" | "uploaded" | "ready";

type DocRow = {
  id: string;
  caseId: number;
  clientName: string;
  title: string;
  name: string;
  category: string;
  status: "Требуется" | "Загружен";
  caseReady: boolean;
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
      const caseReady = REQUIRED_DOCUMENTS.every((template) => lead.documents.some((d) => d.category === template.category));
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
          caseReady,
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
          caseReady,
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
  searchParams?: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const filterIds: DocumentFilter[] = ["all", "required", "uploaded", "ready"];
  const activeFilter = filterIds.includes(params?.status as DocumentFilter) ? (params!.status as DocumentFilter) : "all";
  const session = await getAgentSession();
  const docs = await getDocuments(session?.agentId ?? 0);
  const visible = docs.filter((doc) => {
    if (activeFilter === "required") return doc.status === "Требуется";
    if (activeFilter === "uploaded") return doc.status === "Загружен";
    if (activeFilter === "ready") return doc.status === "Загружен" && doc.caseReady;
    return true;
  });
  const requiredCount = docs.filter((d) => d.status === "Требуется").length;
  const uploadedCount = docs.filter((d) => d.status === "Загружен").length;
  const readyCount = docs.filter((d) => d.status === "Загружен" && d.caseReady).length;

  // Группировка по клиенту (кейсу) - порядок сохраняется из getDocuments
  const byCase = new Map<number, { clientName: string; rows: DocRow[] }>();
  for (const d of visible) {
    if (!byCase.has(d.caseId)) byCase.set(d.caseId, { clientName: d.clientName, rows: [] });
    byCase.get(d.caseId)!.rows.push(d);
  }
  const groups = [...byCase.entries()];

  return (
    <div className="td-page mx-auto w-full max-w-[1280px] overflow-x-hidden px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise td-page-header mb-5">
        <span className="td-eyebrow">Файлы кейсов</span>
        <h1 className="td-display mt-1.5 text-[30px] text-ink sm:text-[38px]">Документы</h1>
        <p className="mt-2 text-[13px] text-ink-2">
          <span className="font-semibold text-ink">{requiredCount}</span> требуется · <span className="font-semibold text-ink">{uploadedCount}</span> загружено
        </p>
      </header>

      {docs.length > 0 && (
        <div className="rise mb-3 grid min-w-0 grid-cols-3 gap-2">
          <Stat label="Требуются" value={String(requiredCount)} tone="warning" />
          <Stat label="Загружены" value={String(uploadedCount)} tone="success" />
          <Stat label="Готово" value={String(readyCount)} />
        </div>
      )}

      {docs.length > 0 && (
        <SegmentedTabs
          ariaLabel="Фильтр документов"
          active={activeFilter}
          segments={[
            { id: "all", label: "Все", count: docs.length },
            { id: "required", label: "Требуются", count: requiredCount },
            { id: "uploaded", label: "Загружены", count: uploadedCount },
            { id: "ready", label: "Готово", count: readyCount },
          ]}
          hrefFor={(id) => (id === "all" ? "/agent/documents" : `/agent/documents?status=${id}`)}
        />
      )}

      {docs.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<Files size={28} weight="fill" />}
          eyebrow="Документы"
          title="Файлов по кейсам пока нет"
          description="Свидетельства, паспорта и договоры загружаются внутри карточки кейса. После загрузки они появятся здесь по клиентам и статусам."
          primaryAction={{ label: "Открыть кейсы", href: "/agent/cases" }}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          className="mt-4 py-10 sm:py-12"
          icon={<Files size={26} weight="fill" />}
          title="В этом фильтре документов нет"
          description="Смените статус или вернитесь ко всем документам."
          secondaryAction={{ label: "Показать все", href: "/agent/documents" }}
        />
      ) : (
        <div className="rise rise-1 mt-4 space-y-4">
          {groups.map(([caseId, g]) => {
            const initials = g.clientName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
            const upN = g.rows.filter((r) => r.status === "Загружен").length;
            const reqN = g.rows.filter((r) => r.status === "Требуется").length;
            return (
              <section key={caseId} className="td-entity-list">
                <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2/45 px-4 py-3">
                  <Link href={`/agent/cases/${caseId}`} className="group flex min-w-0 items-center gap-2.5">
                    <span
                                            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-[12px] font-semibold text-accent bg-accent-soft"
                    >{initials}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-semibold text-ink transition-colors group-hover:text-accent">{g.clientName}</span>
                      <span className="block text-[12px] text-ink-3">Кейс #{caseId}</span>
                    </span>
                  </Link>
                  <span className="flex flex-shrink-0 items-center gap-1.5">
                    {upN > 0 && <span className="tnum rounded-full border border-success/20 bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">{upN} загруж.</span>}
                    {reqN > 0 && <span className="tnum rounded-full border border-warning/20 bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">{reqN} нужно</span>}
                  </span>
                </div>
                <ul className="min-w-0">
                  {g.rows.map((doc) => {
                    const isPdf = doc.mimeType === "application/pdf";
                    const isUploaded = doc.status === "Загружен";
                    return (
                      <li key={doc.id} className="border-b border-line last:border-0">
                        <div className="td-entity-row group grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 py-3 pl-4 pr-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[10px] bg-surface-2 ring-1 ring-line">
                            {isUploaded ? (
                              isPdf ? <FilePdf size={20} weight="duotone" className="text-danger" /> : <FileImage size={20} weight="duotone" className="text-info" />
                            ) : (
                              <WarningCircle size={20} weight="duotone" className="text-warning" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <span className="block truncate text-[14px] font-semibold text-ink">{doc.name}</span>
                            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
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
                          </div>
                          {doc.url ? (
                            <a href={doc.url} target="_blank" rel="noopener" className={buttonClasses({ variant: "secondary", size: "sm", className: "col-start-2 w-fit sm:col-auto" })} aria-label={`Открыть документ ${doc.name}`}>
                              Открыть <ArrowSquareOut size={13} />
                            </a>
                          ) : (
                            <Link href={`/agent/cases/${doc.caseId}`} className="td-press col-start-2 inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full border border-warning/25 bg-warning-soft px-3.5 text-[12px] font-semibold text-warning hover:bg-warning-soft/70 sm:col-auto" aria-label={`Перейти к кейсу для документа ${doc.name}`}>
                              К кейсу <ArrowRight size={13} />
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" | "success" }) {
  const cls = tone === "warning"
    ? "td-metric-warning"
    : tone === "success"
      ? "td-metric-success"
      : "text-ink";
  return (
    <div className={`td-metric ${cls}`}>
      <div className="truncate text-[11px] font-medium opacity-75">{label}</div>
      <div className="tnum mt-0.5 truncate text-[15px] font-semibold">{value}</div>
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
