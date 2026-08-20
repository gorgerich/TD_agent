import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCapability, type OperationalContext } from "@/lib/operationalAuth";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import {
  deriveLedgerSummary,
  evaluateDocumentRequirement,
  evaluateFulfilmentGuards,
  remainingSourceCapacityKopecks,
} from "@/lib/m3Domain";
import { evaluateRequirementCondition } from "@/lib/documentRequirementService";

export type M3Discrepancy = {
  code: string;
  entityType: string;
  entityId: string;
  detail: string;
};

export async function reconcileM3Case(
  context: OperationalContext,
  caseId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  assertCapability(context, "fulfilment:read");
  const record = await client.case.findFirst({
    where: {
      id: caseId,
      tenantId: context.organizationId,
      ...(context.role === "AGENT" ? { ownerId: context.agentId } : {}),
    },
    select: {
      id: true,
      tenantId: true,
      stage: true,
      publishedQuoteVersionId: true,
      lead: { select: { ceremonyAt: true } },
      parties: {
        select: {
          id: true,
          organizationId: true,
          roles: { select: { organizationId: true, role: true, validFrom: true, validUntil: true } },
        },
      },
      documentRequirements: {
        select: {
          id: true,
          organizationId: true,
          stableKey: true,
          kind: true,
          isApplicable: true,
          dueAt: true,
          ownerMembershipId: true,
          satisfactionStatus: true,
          satisfiedByVersionId: true,
          policy: { select: { status: true } },
          rule: { select: { ownerRole: true, conditionKey: true } },
          document: {
            select: {
              id: true,
              organizationId: true,
              versions: {
                orderBy: { versionNumber: "desc" },
                select: {
                  id: true,
                  organizationId: true,
                  versionNumber: true,
                  status: true,
                  scanStatus: true,
                  expiresAt: true,
                  rejectionReason: true,
                },
              },
            },
          },
        },
      },
      contractVersions: {
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          organizationId: true,
          status: true,
          signedAt: true,
          signaturePolicyVersion: true,
          signaturePolicy: {
            select: { organizationId: true, version: true, status: true, approvedAt: true, effectiveFrom: true, retiredAt: true },
          },
          quoteVersionId: true,
          totalObligationKopecks: true,
          currency: true,
          validUntil: true,
          supersededBy: { select: { id: true } },
          obligation: {
            select: {
              id: true,
              organizationId: true,
              amountKopecks: true,
              currency: true,
              ledgerEntries: {
                select: {
                  id: true,
                  organizationId: true,
                  type: true,
                  direction: true,
                  amountKopecks: true,
                  relatedEntryId: true,
                  approvalRequired: true,
                  approval: { select: { id: true, decision: true, requestedByMembershipId: true, decidedByMembershipId: true } },
                  webhookReceipt: { select: { id: true, signatureVerified: true, payloadHash: true } },
                },
                orderBy: { createdAt: "asc" },
              },
            },
          },
          quoteVersion: {
            select: {
              id: true,
              state: true,
              totalState: true,
              total: true,
              currency: true,
              quote: { select: { status: true, organizationId: true, caseId: true } },
            },
          },
        },
      },
    },
  });
  if (!record) throw new OperationalCommandError(404, "Кейс не найден");

  const discrepancies: M3Discrepancy[] = [];
  const push = (code: string, entityType: string, entityId: string, detail: string) => {
    discrepancies.push({ code, entityType, entityId, detail });
  };
  for (const party of record.parties) {
    if (party.organizationId !== record.tenantId || party.roles.some((role) => role.organizationId !== record.tenantId)) {
      push("PARTY_TENANT_MISMATCH", "case_party", party.id, "Party или role assignment не принадлежат tenant кейса");
    }
  }

  const now = new Date();
  const requirementFacts = {
    lead: record.lead,
    parties: record.parties.map((party) => ({
      roles: party.roles
        .filter((role) => role.validFrom <= now && (role.validUntil == null || role.validUntil > now))
        .map((role) => ({ role: role.role })),
    })),
  };
  const requiredDocuments = record.documentRequirements.flatMap((requirement) => {
      const derivedApplicability = requirement.kind === "REQUIRED"
        ? true
        : evaluateRequirementCondition(requirement.rule.conditionKey, requirementFacts);
      if (derivedApplicability == null) {
        push(
          "DOCUMENT_CONDITION_UNSUPPORTED",
          "document_requirement",
          requirement.id,
          "Conditional requirement ссылается на неподдержанное условие",
        );
      }
      const safelyApplicable = derivedApplicability === true;
      if (requirement.isApplicable !== safelyApplicable) {
        push(
          "DOCUMENT_APPLICABILITY_MISMATCH",
          "document_requirement",
          requirement.id,
          "Stored applicability расходится с независимо вычисленной truth",
        );
      }
      if (requirement.organizationId !== record.tenantId || requirement.document?.organizationId !== record.tenantId) {
        push("DOCUMENT_TENANT_MISMATCH", "document_requirement", requirement.id, "Requirement/document не принадлежат tenant кейса");
      }
      if (requirement.policy.status !== "APPROVED" && requirement.policy.status !== "RETIRED") {
        push("DOCUMENT_POLICY_UNAPPROVED", "document_requirement", requirement.id, "Сохранённое требование ссылается на неутверждённую policy");
      }
      for (const version of requirement.document?.versions ?? []) {
        if (version.organizationId !== record.tenantId) {
          push("DOCUMENT_VERSION_TENANT_MISMATCH", "document_version", version.id, "Версия не принадлежит tenant кейса");
        }
      }
      const derived = evaluateDocumentRequirement(requirement.document?.versions ?? []);
      const storedSatisfied = requirement.satisfactionStatus === "SATISFIED";
      const derivedSatisfied = derived.status === "SATISFIED";
      if (storedSatisfied !== derivedSatisfied) {
        push("DOCUMENT_SATISFACTION_MISMATCH", "document_requirement", requirement.id, "Stored и derived satisfaction расходятся");
      }
      const verified = requirement.document?.versions.find((version) => version.versionNumber === derived.verifiedVersionNumber);
      if ((requirement.satisfiedByVersionId ?? null) !== (verified?.id ?? null)) {
        push("DOCUMENT_SATISFIED_VERSION_MISMATCH", "document_requirement", requirement.id, "Ссылка на verified version расходится с derived truth");
      }
      const latest = requirement.document?.versions[0];
      if (latest?.status === "REJECTED" && !latest.rejectionReason) {
        push("DOCUMENT_REJECTION_REASON_MISSING", "document_version", latest.id, "Отклонённая версия не содержит причину");
      }
      if (!safelyApplicable) return [];
      return [{
        stableKey: requirement.stableKey,
        status: derived.status,
        owner: requirement.rule.ownerRole,
        dueAt: requirement.dueAt,
      }];
    });

  const signedContracts = record.contractVersions.filter((version) => version.status === "SIGNED");
  for (const version of signedContracts) {
    if (version.validUntil != null && version.validUntil <= now) {
      push("SIGNED_CONTRACT_EXPIRED", "contract_version", version.id, "SIGNED contract истёк и не может открывать stage");
    }
    if (version.supersededBy != null) {
      push("SIGNED_CONTRACT_SUPERSEDED", "contract_version", version.id, "SIGNED contract имеет замещающую версию");
    }
    if (version.quoteVersionId !== record.publishedQuoteVersionId) {
      push("SIGNED_CONTRACT_NOT_CURRENT_QUOTE", "contract_version", version.id, "SIGNED contract не связан с текущей принятой QuoteVersion");
    }
  }
  const activeSigned = signedContracts.filter((version) => (
    version.supersededBy == null
    && (version.validUntil == null || version.validUntil > now)
    && version.quoteVersionId === record.publishedQuoteVersionId
  ));
  if (activeSigned.length > 1) {
    push("MULTIPLE_ACTIVE_SIGNED_CONTRACTS", "case", record.id, "У кейса больше одной активной SIGNED ContractVersion");
  }
  const contract = activeSigned[0] ?? null;
  let paymentStatus: Parameters<typeof evaluateFulfilmentGuards>[0]["paymentStatus"] = "LEGACY_INCOMPLETE";
  let pendingFinancialAdjustments = 0;
  if (contract) {
    const signedAt = contract.signedAt;
    if (
      !contract.signaturePolicy
      || contract.signaturePolicy.organizationId !== record.tenantId
      || contract.signaturePolicy.status === "DRAFT_POLICY"
      || contract.signaturePolicy.version !== contract.signaturePolicyVersion
      || signedAt == null
      || contract.signaturePolicy.approvedAt == null
      || contract.signaturePolicy.effectiveFrom == null
      || contract.signaturePolicy.approvedAt > signedAt
      || contract.signaturePolicy.effectiveFrom > signedAt
      || (contract.signaturePolicy.retiredAt != null && contract.signaturePolicy.retiredAt <= signedAt)
    ) {
      push("CONTRACT_SIGNING_POLICY_INVALID", "contract_version", contract.id, "SIGNED contract не связан с Legal-approved policy snapshot на момент подписания");
    }
    const quote = contract.quoteVersion;
    if (
      quote.quote.organizationId !== record.tenantId
      || quote.quote.caseId !== record.id
      || quote.quote.status !== "ACCEPTED"
      || quote.state !== "PUBLISHED"
      || quote.totalState !== "KNOWN"
    ) {
      push("CONTRACT_QUOTE_TRUTH_MISMATCH", "contract_version", contract.id, "SIGNED contract не связан с ACCEPTED/PUBLISHED QuoteVersion того же tenant/case");
    }
    if (quote.total !== contract.totalObligationKopecks || quote.currency !== contract.currency) {
      push("CONTRACT_AMOUNT_MISMATCH", "contract_version", contract.id, "Contract obligation расходится с immutable QuoteVersion");
    }
    if (!contract.obligation) {
      push("PAYMENT_OBLIGATION_MISSING", "contract_version", contract.id, "SIGNED contract не имеет obligation");
    } else {
      const obligation = contract.obligation;
      if (
        obligation.organizationId !== record.tenantId
        || obligation.amountKopecks !== contract.totalObligationKopecks
        || obligation.currency !== contract.currency
      ) {
        push("OBLIGATION_TRUTH_MISMATCH", "payment_obligation", obligation.id, "Obligation расходится с contract или tenant");
      }
      const obligationEntries = obligation.ledgerEntries.filter((entry) => entry.type === "OBLIGATION");
      if (
        obligationEntries.length !== 1
        || obligationEntries[0]?.direction !== "DEBIT"
        || obligationEntries[0]?.amountKopecks !== obligation.amountKopecks
      ) {
        push("OBLIGATION_LEDGER_MISMATCH", "payment_obligation", obligation.id, "Ledger должен содержать ровно одну matching OBLIGATION запись");
      }
      for (const entry of obligation.ledgerEntries) {
        if (entry.organizationId !== record.tenantId) {
          push("LEDGER_TENANT_MISMATCH", "payment_ledger_entry", entry.id, "Ledger entry не принадлежит tenant кейса");
        }
        if (entry.approvalRequired && !entry.approval?.decision) pendingFinancialAdjustments += 1;
        if (
          entry.approval
          && entry.approval.decidedByMembershipId != null
          && entry.approval.decidedByMembershipId === entry.approval.requestedByMembershipId
        ) {
          push("FOUR_EYES_VIOLATION", "payment_ledger_approval", entry.approval.id, "Requester и approver совпадают");
        }
        if (entry.webhookReceipt && (!entry.webhookReceipt.signatureVerified || !entry.webhookReceipt.payloadHash)) {
          push("WEBHOOK_EVIDENCE_INVALID", "payment_webhook_receipt", entry.webhookReceipt.id, "Webhook evidence не подтверждает подпись/payload");
        }
      }
      try {
        const projectionEntries = obligation.ledgerEntries.map((entry) => ({
          id: entry.id,
          type: entry.type,
          direction: entry.direction,
          amountKopecks: entry.amountKopecks,
          relatedEntryId: entry.relatedEntryId,
          effective: !entry.approvalRequired || entry.approval?.decision === "APPROVED",
          reserved: entry.approvalRequired && entry.approval?.decision == null,
        }));
        for (const source of projectionEntries.filter((entry) => entry.effective && entry.type !== "OBLIGATION")) {
          remainingSourceCapacityKopecks(projectionEntries, source.id);
        }
        const summary = deriveLedgerSummary(projectionEntries, obligation.currency);
        paymentStatus = summary.status ?? "LEGACY_INCOMPLETE";
      } catch (error) {
        push("LEDGER_PROJECTION_INVALID", "payment_obligation", obligation.id, error instanceof Error ? error.message : "Ledger projection failed");
      }
    }
  }

  const auditableEntities = [
    ...record.parties.map((entity) => ({ entityType: "case_party", id: entity.id })),
    ...record.documentRequirements.flatMap((requirement) =>
      (requirement.document?.versions ?? []).map((entity) => ({ entityType: "document_version", id: entity.id }))),
    ...record.contractVersions.map((entity) => ({ entityType: "contract_version", id: entity.id })),
    ...record.contractVersions.flatMap((version) => version.obligation
      ? [
          { entityType: "payment_obligation", id: version.obligation.id },
          ...version.obligation.ledgerEntries.map((entity) => ({ entityType: "payment_ledger_entry", id: entity.id })),
        ]
      : []),
  ];
  if (auditableEntities.length > 0) {
    const audits = await client.operationalAuditEvent.findMany({
      where: {
        organizationId: context.organizationId,
        OR: auditableEntities.map((entity) => ({ entityType: entity.entityType, entityId: entity.id })),
      },
      select: { entityType: true, entityId: true },
    });
    const audited = new Set(audits.map((audit) => `${audit.entityType}:${audit.entityId}`));
    for (const entity of auditableEntities) {
      if (!audited.has(`${entity.entityType}:${entity.id}`)) {
        push("AUDIT_MISSING", entity.entityType, entity.id, "Для M3 entity отсутствует immutable operational audit");
      }
    }
  }

  const guards = evaluateFulfilmentGuards({
    policyApproved: record.documentRequirements.length > 0
      && record.documentRequirements.every((requirement) => requirement.policy.status !== "DRAFT_POLICY"),
    requiredDocuments,
    contractStatus: contract?.status ?? "MISSING",
    paymentStatus,
    pendingFinancialAdjustments,
    reconciliationDiscrepancies: discrepancies.length,
  });
  return {
    caseId: record.id,
    checkedAt: new Date().toISOString(),
    discrepancyCount: discrepancies.length,
    discrepancies,
    paymentStatus,
    pendingFinancialAdjustments,
    fulfilment: guards,
  };
}
