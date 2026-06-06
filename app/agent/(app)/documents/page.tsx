import Link from "next/link";
import { ArrowRight, Files } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dateShort } from "@/lib/format";

type DocRow = {
  id: string;
  caseId: number;
  name: string;
  clientName: string;
  type: string;
  status: string;
  date: Date;
};

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
      take: 80,
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
          date: lead.createdAt,
        },
      ];
      if (quoteDate) {
        rows.push({
          id: `${lead.id}-quote`,
          caseId: lead.id,
          name: "Смета",
          clientName: lead.name,
          type: "Смета",
          status: "Сохранена",
          date: quoteDate,
        });
      }
      if (order) {
        rows.push({
          id: `${lead.id}-contract`,
          caseId: lead.id,
          name: "Договор",
          clientName: lead.name,
          type: "Договор",
          status: order.signature ? "Подписан" : order.status,
          date: order.signature?.signedAt ?? order.createdAt,
        });
      }
      return rows;
    });
  } catch {
    return [];
  }
}

export default async function DocumentsPage() {
  const session = await getAgentSession();
  const docs = await getDocuments(session?.agentId ?? 0);

  return (
    <div className="td-page mx-auto max-w-[1100px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="rise mb-6">
        <span className="td-eyebrow">Кейсы</span>
        <h1 className="mt-2 text-[30px] font-semibold leading-tight text-ink sm:text-[36px]">Документы</h1>
      </header>

      {docs.length === 0 ? (
        <div className="rise rise-1 td-shell px-6 py-14 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent">
            <Files size={26} weight="duotone" />
          </span>
          <h2 className="text-[20px] font-semibold text-ink">Документов пока нет</h2>
          <p className="mx-auto mt-1.5 max-w-[340px] text-[13.5px] leading-relaxed text-ink-2">
            Документы появятся по мере движения кейсов: карточка, смета, договор.
          </p>
        </div>
      ) : (
        <ul className="rise rise-1 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          <li className="hidden grid-cols-[minmax(180px,1fr)_180px_120px_130px_100px_28px] gap-3 border-b border-line bg-surface-2/55 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3 md:grid">
            <span>Документ</span>
            <span>Клиент</span>
            <span>Тип</span>
            <span>Статус</span>
            <span>Дата</span>
            <span />
          </li>
          {docs.map((doc) => (
            <li key={doc.id} className="border-b border-line last:border-0">
              <Link href={`/agent/cases/${doc.caseId}`} className="group grid gap-2 px-4 py-3.5 transition-colors hover:bg-surface-2/60 md:grid-cols-[minmax(180px,1fr)_180px_120px_130px_100px_28px] md:items-center md:gap-3">
                <span className="truncate text-[14px] font-semibold text-ink">{doc.name}</span>
                <span className="truncate text-[13.5px] text-ink-2">{doc.clientName}</span>
                <span className="text-[12.5px] text-ink-3">{doc.type}</span>
                <span className="w-fit rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-2">{doc.status}</span>
                <span className="text-[12.5px] text-ink-3">{dateShort(doc.date)}</span>
                <ArrowRight size={15} className="hidden text-ink-3 transition-colors group-hover:text-accent md:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
