import type { Case, CaseScenario, Prisma } from "@prisma/client";
import { CaseDomainError } from "@/lib/caseDomain";
import { lockDocumentRequirementPolicyScenario } from "@/lib/documentRequirementService";
import { appendOperationalAudit } from "@/lib/operationalAudit";
import { prismaJson } from "@/lib/m3Command";
import { serverCommandKey } from "@/lib/commandNamespace";

export async function prepareCaseScenarioCorrection(
  tx: Prisma.TransactionClient,
  record: Case,
  scenarioId: CaseScenario,
  actor: { organizationId: string; membershipId: string; idempotencyKey: string; correlationId: string },
  confirmation?: { confirmed: boolean; reason: string },
) {
  if (record.scenarioId === "UNSELECTED" || record.scenarioId === scenarioId) return false;
  if (scenarioId === "UNSELECTED") throw new CaseDomainError("GUARD_FAILED", "Выбранный сценарий нельзя очистить. Укажите поддерживаемый сценарий");
  if (record.stage !== "QUOTING") throw new CaseDomainError("GUARD_FAILED", "Сценарий можно исправить до публикации сметы и выпуска документов или договора");
  if (!confirmation?.confirmed || confirmation.reason.trim().length < 3) {
    throw new CaseDomainError("GUARD_FAILED", "Подтвердите исправление сценария и укажите причину", { guard: "scenario_correction_confirmation" });
  }
  const [consequences] = await tx.$queryRaw<Array<{ blocked: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM "QuoteVersion" v JOIN "Quote" q ON q.id=v."quoteId"
      WHERE q."caseId"=${record.id} AND v."state" IN ('PUBLISHED', 'SUPERSEDED'))
      OR EXISTS (SELECT 1 FROM "ContractVersion" WHERE "caseId"=${record.id})
      OR EXISTS (SELECT 1 FROM "PaymentObligation" WHERE "caseId"=${record.id})
      OR EXISTS (SELECT 1 FROM "CaseDocumentVersion" WHERE "caseId"=${record.id}) AS blocked
  `;
  if (consequences?.blocked !== false) {
    throw new CaseDomainError("GUARD_FAILED", "Сценарий связан с опубликованной сметой, документом или договором. Нужна версионированная коррекция; история не изменена");
  }
  const policyId = await lockDocumentRequirementPolicyScenario(tx, actor.organizationId, scenarioId);
  const policy = policyId ? await tx.documentRequirementPolicy.findUnique({ where: { id: policyId }, include: { rules: true } }) : null;
  const previous = await tx.caseDocumentRequirement.findMany({ where: { caseId: record.id, organizationId: actor.organizationId } });
  const selected = new Map(policy?.rules.map((rule) => [rule.stableKey,
    previous.find((requirement) => requirement.ruleId === rule.id)?.id
      ?? previous.filter((requirement) => requirement.stableKey === rule.stableKey)
        .sort((left, right) => right.policyVersion - left.policyVersion || left.id.localeCompare(right.id))[0]?.id,
  ]) ?? []);
  const correctedAt = new Date();
  for (const requirement of previous) {
    const rule = selected.get(requirement.stableKey) === requirement.id
      ? policy?.rules.find((candidate) => candidate.stableKey === requirement.stableKey) : undefined;
    await tx.caseDocumentRequirement.update({ where: { id: requirement.id }, data: rule && policy ? {
      policyId: policy.id, ruleId: rule.id, policyVersion: policy.version, kind: rule.kind,
      conditionExplanation: rule.conditionExplanation, ownerRole: rule.ownerRole,
      blockingStage: rule.blockingStage, acceptedDocumentTypeCodes: prismaJson(rule.acceptedDocumentTypeCodes),
      acceptedDocumentTypeVersionIds: prismaJson(rule.acceptedDocumentTypeVersionIds),
      reviewChecklist: prismaJson(rule.reviewChecklist), sourceRule: rule.source,
      dueAt: rule.dueOffsetHours == null ? null : new Date(correctedAt.getTime() + rule.dueOffsetHours * 3_600_000),
      isApplicable: false, applicabilityEvaluatedAt: correctedAt,
      supersededAt: null,
    } : { isApplicable: false, applicabilityEvaluatedAt: correctedAt, supersededAt: correctedAt } });
  }
  await tx.quote.updateMany({ where: { caseId: record.id, organizationId: actor.organizationId, latestPublishedVersionId: null }, data: { scenario: scenarioId, status: "DRAFT" } });
  await appendOperationalAudit(tx, actor, {
    entityType: "document_requirement", entityId: record.id, action: "document_requirements.scenario_corrected.v1",
    before: prismaJson({ scenarioId: record.scenarioId, requirements: previous }),
    after: prismaJson({ scenarioId, policyId, consequenceGuard: "NO_PUBLISHED_CONTRACT_LEDGER_OR_DOCUMENT_VERSION" }),
    reason: confirmation.reason.trim(), correlationId: actor.correlationId,
    idempotencyKey: serverCommandKey("scenario-correction-audit", actor.idempotencyKey),
    result: prismaJson({ scenarioId, policyId }),
  });
  return true;
}
