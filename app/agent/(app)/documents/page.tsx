import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Files, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { getAgentSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evaluateDocumentRequirement } from "@/lib/m3Domain";
import { isCoreOperationalRole } from "@/lib/operationalAuth";
import { buttonClasses } from "@/components/ui/Button";

const FILTERS = [
  ["all", "Все"],
  ["blocking", "Требуют действия"],
  ["review", "На проверке"],
  ["verified", "Проверены"],
] as const;

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const session = await getAgentSession();
  if (!session || !isCoreOperationalRole(session.role)) notFound();
  const requested = (await searchParams).state ?? "all";
  const state = FILTERS.some(([value]) => value === requested) ? requested : "all";
  const requirements = await prisma.caseDocumentRequirement.findMany({
    where: {
      organizationId: session.organizationId,
      ...(session.role === "AGENT" ? { case: { ownerId: session.agentId } } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      stableKey: true,
      kind: true,
      blockingStage: true,
      dueAt: true,
      policyVersion: true,
      case: { select: { leadId: true, publicRef: true, lead: { select: { name: true } } } },
      document: {
        select: {
          versions: {
            orderBy: { versionNumber: "desc" },
            select: { versionNumber: true, status: true, scanStatus: true, expiresAt: true, rejectionReason: true },
          },
        },
      },
    },
  });
  const rows = requirements.map((requirement) => {
    const derived = evaluateDocumentRequirement(requirement.document?.versions ?? []);
    const latest = requirement.document?.versions[0] ?? null;
    return { ...requirement, derived, latest };
  }).filter((row) => {
    if (state === "verified") return row.derived.status === "SATISFIED";
    if (state === "review") return row.latest?.status === "UPLOADED" || row.latest?.status === "IN_REVIEW";
    if (state === "blocking") return row.derived.status !== "SATISFIED";
    return true;
  });

  const verified = requirements.filter((requirement) => evaluateDocumentRequirement(requirement.document?.versions ?? []).status === "SATISFIED").length;
  const waitingReview = requirements.filter((requirement) => ["UPLOADED", "IN_REVIEW"].includes(requirement.document?.versions[0]?.status ?? "")).length;

  return (
    <div className="td-page mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-7 sm:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="td-display text-[30px] text-ink sm:text-[38px]">Документы</h1>
          <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink-2">
            Сценарные требования. Загруженный файл остаётся блокером до проверки назначенным reviewer.
          </p>
        </div>
        <div className="text-right text-[12px] text-ink-3">
          <strong className="tnum block text-[18px] text-ink">{verified}/{requirements.length}</strong>
          проверено · {waitingReview} ожидают решения
        </div>
      </header>

      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Фильтр документов">
        {FILTERS.map(([value, label]) => (
          <Link
            key={value}
            href={value === "all" ? "/agent/documents" : `/agent/documents?state=${value}`}
            aria-current={state === value ? "page" : undefined}
            className={buttonClasses({ variant: state === value ? "primary" : "secondary", size: "sm" })}
          >
            {label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="td-shell py-14 text-center">
          <Files size={28} className="mx-auto text-ink-3" />
          <p className="mt-3 font-medium text-ink">По этому фильтру требований нет</p>
          <p className="mt-1 text-[12px] text-ink-3">Это реальное пустое состояние, а не скрытая ошибка загрузки.</p>
        </div>
      ) : (
        <div className="td-shell overflow-hidden">
          <ul className="divide-y divide-line" aria-label="Требования документов">
            {rows.map((row) => {
              const satisfied = row.derived.status === "SATISFIED";
              return (
                <li key={row.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <strong className="truncate text-[14px] text-ink">{row.stableKey}</strong>
                      <span className={`text-[12px] font-semibold ${satisfied ? "text-success" : row.latest?.status === "REJECTED" ? "text-danger" : "text-warning"}`}>
                        {satisfied ? "Проверен" : statusLabel(row.latest?.status)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[12px] text-ink-3">
                      {row.case.lead.name} · {row.case.publicRef} · policy v{row.policyVersion} · блокирует {row.blockingStage}
                    </p>
                    {row.latest?.rejectionReason && (
                      <p className="mt-2 inline-flex items-start gap-1.5 text-[12px] text-danger">
                        <WarningCircle size={14} weight="fill" className="mt-0.5 shrink-0" /> {row.latest.rejectionReason}
                      </p>
                    )}
                  </div>
                  <Link href={`/agent/cases/${row.case.leadId}?tab=docs`} className={buttonClasses({ variant: "secondary", size: "sm" })}>
                    К кейсу <ArrowRight size={14} weight="bold" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function statusLabel(status: string | undefined) {
  if (!status) return "Не загружен";
  if (status === "UPLOADED") return "Ожидает проверки";
  if (status === "IN_REVIEW") return "На проверке";
  if (status === "QUARANTINED") return "Карантин";
  if (status === "REJECTED") return "Отклонён";
  if (status === "EXPIRED") return "Срок истёк";
  return status;
}
