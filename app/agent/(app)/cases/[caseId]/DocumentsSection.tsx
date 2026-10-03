"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowSquareOut, FileArrowUp, LockKey, WarningCircle } from "@phosphor-icons/react";
import { buttonClasses } from "@/components/ui/Button";

export type CanonicalDocumentRequirement = {
  id: string;
  stableKey: string;
  policyStatus: "DRAFT_POLICY" | "APPROVED" | "RETIRED";
  policyVersion: number;
  scenario: string;
  kind: "REQUIRED" | "CONDITIONAL";
  conditionExplanation: string | null;
  isApplicable: boolean;
  applicabilityEvaluatedAt: string;
  dueAt: string | null;
  ownerRole: string;
  blockingStage: string;
  acceptedDocumentTypeCodes: string[];
  derivedSatisfactionStatus: "NOT_SATISFIED" | "SATISFIED";
  document: {
    id: string;
    status: string;
    documentType: { code: string; name: string; version: number };
    versions: Array<{
      id: string;
      versionNumber: number;
      status: string;
      scanStatus: string;
      expiresAt: string | null;
      rejectionReason: string | null;
      createdAt: string;
    }>;
  } | null;
};

const STATUS_LABELS: Record<string, string> = {
  REQUIRED: "Требуется",
  UPLOADED: "Загружен, ожидает проверки",
  QUARANTINED: "Карантин",
  IN_REVIEW: "На проверке",
  VERIFIED: "Проверен",
  REJECTED: "Отклонён",
  EXPIRED: "Срок истёк",
  SUPERSEDED: "Заменён новой версией",
};

const REQUIREMENT_LABELS: Record<string, string> = {
  "identity-record": "Документ, удостоверяющий личность",
  "death-record": "Документ о смерти",
  "cremation-authorization": "Основание для кремации",
  "plot-entitlement": "Право на родственный участок",
  "relationship-evidence": "Подтверждение родства",
};

const OWNER_LABELS: Record<string, string> = {
  AGENT: "Агент",
  FAMILY: "Семья",
  DOCUMENT_REVIEWER: "Проверяющий документов",
  MANAGER: "Менеджер",
};

export function DocumentsSection({
  caseId,
  timezone,
  requirements,
  legacyCount,
  canMutate = true,
}: {
  caseId: number;
  timezone: string;
  requirements: CanonicalDocumentRequirement[];
  legacyCount: number;
  canMutate?: boolean;
}) {
  const router = useRouter();
  const [confirmedRequirements, setConfirmedRequirements] = useState<CanonicalDocumentRequirement[] | null>(null);
  const [busyRequirementId, setBusyRequirementId] = useState<string | null>(null);
  const [openingVersionId, setOpeningVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visibleRequirements = confirmedRequirements ?? requirements;
  const applicableRequirements = visibleRequirements.filter((item) => item.isApplicable);
  const verified = applicableRequirements.filter((item) => item.derivedSatisfactionStatus === "SATISFIED").length;

  async function upload(requirement: CanonicalDocumentRequirement, file: File) {
    const documentTypeCode = requirement.acceptedDocumentTypeCodes[0];
    if (!documentTypeCode) {
      setError("Для требования не настроен допустимый тип документа.");
      return;
    }
    const commandId = crypto.randomUUID();
    const body = new FormData();
    body.set("file", file);
    body.set("requirementId", requirement.id);
    body.set("documentTypeCode", documentTypeCode);
    setBusyRequirementId(requirement.id);
    setError(null);
    try {
      const response = await fetch(`/api/agent/cases/${caseId}/documents`, {
        method: "POST",
        headers: {
          "Idempotency-Key": `document-upload:${commandId}`,
          "X-Correlation-Id": commandId,
        },
        body,
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Документ не загружен");
      const readBack = await fetch(`/api/agent/cases/${caseId}/documents`, { cache: "no-store" });
      const canonical = await readBack.json().catch(() => null) as { requirements?: CanonicalDocumentRequirement[]; error?: string } | null;
      if (!readBack.ok || !Array.isArray(canonical?.requirements)) {
        setError(canonical?.error || "Документ загружен, но список не обновлён. Обновите страницу.");
      } else {
        setConfirmedRequirements(canonical.requirements);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Документ не загружен");
    } finally {
      setBusyRequirementId(null);
    }
  }

  async function openVersion(versionId: string) {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      setError("Браузер заблокировал новое окно. Разрешите открытие и повторите действие.");
      return;
    }
    popup.opener = null;
    const correlationId = crypto.randomUUID();
    setOpeningVersionId(versionId);
    setError(null);
    try {
      const response = await fetch(`/api/agent/cases/${caseId}/documents/${versionId}`, {
        headers: {
          "X-Correlation-Id": correlationId,
        },
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || "Файл недоступен");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      popup.location.replace(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (cause) {
      popup.close();
      setError(cause instanceof Error ? cause.message : "Файл недоступен");
    } finally {
      setOpeningVersionId(null);
    }
  }

  return (
    <div
      aria-label="Сценарные документы"
      aria-busy={busyRequirementId != null}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3">
        <p className="text-[13px] text-ink-2">
          Проверено <strong className="tnum text-ink">{verified} из {applicableRequirements.length}</strong>
        </p>
        <p className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
          <LockKey size={14} weight="bold" /> Файлы выдаются только после серверной проверки доступа
        </p>
      </div>

      {legacyCount > 0 && (
        <p role="status" className="flex gap-2 border-l-4 border-warning bg-warning-soft px-3 py-2 text-[12px] leading-relaxed text-warning">
          <WarningCircle size={17} weight="fill" className="mt-0.5 shrink-0" />
          {legacyCount} старый файл не считается проверенным и требует явной привязки к сценарному требованию.
        </p>
      )}
      {error && <p role="alert" className="bg-danger-soft px-3 py-2 text-[12px] font-medium text-danger">{error}</p>}

      {visibleRequirements.length === 0 ? (
        <div className="py-8 text-center">
          <p className="font-medium text-ink">Перечень ещё не утверждён или сценарий не выбран</p>
          <p className="mt-1 text-[12px] text-ink-3">Документы не будут названы обязательными без утверждённого правила.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line" aria-label="Сценарные требования документов">
          {visibleRequirements.map((requirement) => {
            const latest = requirement.document?.versions[0] ?? null;
            const satisfied = requirement.derivedSatisfactionStatus === "SATISFIED";
            const effectiveStatus = latest?.status === "VERIFIED" && latest.expiresAt && new Date(latest.expiresAt) <= new Date()
              ? "EXPIRED"
              : latest?.status ?? "REQUIRED";
            const canOpen = latest && latest.scanStatus === "CLEAN" && latest.status !== "QUARANTINED";
            return (
              <li key={requirement.id} className="py-4 first:pt-0 last:pb-0">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h4 className="text-[14px] font-semibold text-ink">{REQUIREMENT_LABELS[requirement.stableKey] ?? requirement.stableKey}</h4>
                      <span className={`text-[12px] font-semibold ${satisfied ? "text-success" : effectiveStatus === "REJECTED" ? "text-danger" : "text-warning"}`}>
                        {!requirement.isApplicable ? "Не применяется" : satisfied ? "Проверен" : STATUS_LABELS[effectiveStatus] ?? effectiveStatus}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-3">Правило v{requirement.policyVersion} · блокирует этап {requirement.blockingStage}</p>
                    <dl className="mt-2 grid gap-1 text-[12px] text-ink-2 sm:grid-cols-2">
                      <div className="grid min-w-0 gap-0.5 min-[280px]:grid-cols-[auto_minmax(0,1fr)] min-[280px]:gap-2">
                        <dt className="text-ink-3">Ответственный:</dt>
                        <dd className="min-w-0 break-words">{OWNER_LABELS[requirement.ownerRole] ?? requirement.ownerRole}</dd>
                      </div>
                      <div className="grid min-w-0 gap-0.5 min-[280px]:grid-cols-[auto_minmax(0,1fr)] min-[280px]:gap-2">
                        <dt className="text-ink-3">Срок:</dt>
                        <dd className="min-w-0 break-words">{requirement.dueAt ? formatDate(requirement.dueAt, timezone) : "не назначен policy"}</dd>
                      </div>
                    </dl>
                    {latest?.rejectionReason && (
                      <p className="mt-2 text-[12px] font-medium text-danger">Причина: {latest.rejectionReason}</p>
                    )}
                    {requirement.conditionExplanation && (
                      <p className="mt-2 text-[12px] text-ink-2">Условие: {requirement.conditionExplanation}</p>
                    )}
                    {requirement.isApplicable && !satisfied && <p className="mt-2 text-[12px] font-medium text-warning">Следующее действие: {nextDocumentAction(effectiveStatus)}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {canOpen && (
                      <button
                        type="button"
                        onClick={() => openVersion(latest.id)}
                        disabled={openingVersionId === latest.id}
                        className={buttonClasses({ variant: "secondary", size: "sm" })}
                      >
                        <ArrowSquareOut size={15} weight="bold" />
                        {openingVersionId === latest.id ? "Открываю..." : `Открыть v${latest.versionNumber}`}
                      </button>
                    )}
                    {canMutate && requirement.isApplicable && requirement.policyStatus !== "DRAFT_POLICY" && (
                      <label className={buttonClasses({ size: "sm", className: "cursor-pointer" })}>
                        <FileArrowUp size={15} weight="bold" />
                        {busyRequirementId === requirement.id ? "Загрузка..." : latest ? "Заменить" : "Загрузить"}
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                          className="sr-only"
                          disabled={busyRequirementId != null}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void upload(requirement, file);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function nextDocumentAction(status: string) {
  if (status === "REJECTED") return "исправить указанную причину и загрузить новую версию";
  if (status === "EXPIRED") return "загрузить действующую версию";
  if (status === "QUARANTINED") return "дождаться безопасного результата сканирования; stage остаётся закрыт";
  if (status === "UPLOADED") return "передать чистую версию проверяющему";
  if (status === "IN_REVIEW") return "дождаться явного решения проверяющего";
  if (status === "SUPERSEDED") return "проверить последнюю применимую версию";
  return "загрузить допустимый файл для этого требования";
}

export default DocumentsSection;
