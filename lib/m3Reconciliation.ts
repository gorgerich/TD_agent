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
import {
  checkCaseRequirementMaterializationParity,
  evaluateRequirementCondition,
} from "@/lib/documentRequirementService";

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
      scenarioId: true,
      stage: true,
      publishedQuoteVersionId: true,
      lead: { select: { ceremonyAt: true } },
      parties: {
        select: {
          id: true,
          organizationId: true,
          createdAt: true,
          updatedAt: true,
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
                  assignedReviewerMembershipId: true,
                  reviewedAt: true,
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


  const documentParity = await checkCaseRequirementMaterializationParity(
    client,
    record.tenantId,
    record.id,
    record.scenarioId,
  );
  if (!documentParity.ok) {
    push(
      documentParity.reason ?? "DOCUMENT_REQUIREMENT_POLICY_PARITY_MISMATCH",
      "case",
      record.id,
      `Materialized document requirements не совпадают с policy rules (${documentParity.actual}/${documentParity.expected})`,
    );
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
  const contractualTruthVersions = record.contractVersions.filter((version) => (
    version.status === "SIGNED" || version.status === "SUPERSEDED"
  ));
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
  for (const historicalContract of contractualTruthVersions) {
    const signedAt = historicalContract.signedAt;
    if (
      historicalContract.organizationId !== record.tenantId
      || !historicalContract.signaturePolicy
      || historicalContract.signaturePolicy.organizationId !== record.tenantId
      || historicalContract.signaturePolicy.status === "DRAFT_POLICY"
      || historicalContract.signaturePolicy.version !== historicalContract.signaturePolicyVersion
      || signedAt == null
      || historicalContract.signaturePolicy.approvedAt == null
      || historicalContract.signaturePolicy.effectiveFrom == null
      || historicalContract.signaturePolicy.approvedAt > signedAt
      || historicalContract.signaturePolicy.effectiveFrom > signedAt
      || (historicalContract.signaturePolicy.retiredAt != null && historicalContract.signaturePolicy.retiredAt <= signedAt)
    ) {
      push("CONTRACT_SIGNING_POLICY_INVALID", "contract_version", historicalContract.id, "Contract history не связана с Legal-approved policy snapshot на момент подписания");
    }
    if (historicalContract.status === "SUPERSEDED" && historicalContract.supersededBy == null) {
      push("SUPERSEDED_CONTRACT_LINK_MISSING", "contract_version", historicalContract.id, "SUPERSEDED contract не указывает замещающую версию");
    }
    const quote = historicalContract.quoteVersion;
    if (
      quote.quote.organizationId !== record.tenantId
      || quote.quote.caseId !== record.id
      || quote.state !== "PUBLISHED"
      || quote.totalState !== "KNOWN"
    ) {
      push("CONTRACT_QUOTE_TRUTH_MISMATCH", "contract_version", historicalContract.id, "Contract history не связана с immutable PUBLISHED QuoteVersion того же tenant/case");
    }
    if (quote.total !== historicalContract.totalObligationKopecks || quote.currency !== historicalContract.currency) {
      push("CONTRACT_AMOUNT_MISMATCH", "contract_version", historicalContract.id, "Contract obligation расходится с immutable QuoteVersion");
    }
    if (!historicalContract.obligation) {
      push("PAYMENT_OBLIGATION_MISSING", "contract_version", historicalContract.id, "Contract history не имеет obligation");
    } else {
      const obligation = historicalContract.obligation;
      if (
        obligation.organizationId !== record.tenantId
        || obligation.amountKopecks !== historicalContract.totalObligationKopecks
        || obligation.currency !== historicalContract.currency
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
        if (historicalContract.id === contract?.id && entry.approvalRequired && !entry.approval?.decision) {
          pendingFinancialAdjustments += 1;
        }
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
        if (historicalContract.id === contract?.id) paymentStatus = summary.status ?? "LEGACY_INCOMPLETE";
      } catch (error) {
        push("LEDGER_PROJECTION_INVALID", "payment_obligation", obligation.id, error instanceof Error ? error.message : "Ledger projection failed");
      }
    }
  }

  const auditableEntities = [
    ...record.parties.map((entity) => ({
      entityType: "case_party",
      id: entity.id,
      actions: entity.updatedAt > entity.createdAt
        ? ["case_party.created.v1", "case_party.updated.v1"]
        : ["case_party.created.v1"],
    })),
    ...record.documentRequirements.flatMap((requirement) =>
      (requirement.document?.versions ?? []).map((entity) => ({
        entityType: "document_version",
        id: entity.id,
        actions: documentAuditActions(entity),
      }))),
    ...record.contractVersions.map((entity) => ({
      entityType: "contract_version",
      id: entity.id,
      actions: contractAuditActions(entity.status),
    })),
    ...record.contractVersions.flatMap((version) => version.obligation
      ? [
          { entityType: "payment_obligation", id: version.obligation.id, actions: ["payment.obligation_created.v1"] },
          ...version.obligation.ledgerEntries.flatMap((entity) => [
            {
              entityType: "payment_ledger_entry",
              id: entity.id,
              actions: [ledgerAuditAction(entity.type, entity.webhookReceipt != null)],
            },
            ...(entity.approval ? [{
              entityType: "payment_ledger_approval",
              id: entity.approval.id,
              actions: approvalAuditActions(entity.approval.decision),
            }] : []),
          ]),
        ]
      : []),
  ];
  if (auditableEntities.length > 0) {
    const audits = await client.operationalAuditEvent.findMany({
      where: {
        organizationId: context.organizationId,
        OR: auditableEntities.map((entity) => ({ entityType: entity.entityType, entityId: entity.id })),
      },
      select: { entityType: true, entityId: true, action: true },
    });
    const audited = new Set(audits.map((audit) => `${audit.entityType}:${audit.entityId}:${audit.action}`));
    for (const entity of auditableEntities) {
      for (const action of entity.actions) {
        if (!audited.has(`${entity.entityType}:${entity.id}:${action}`)) {
          push("AUDIT_MISSING", entity.entityType, entity.id, `Для M3 transition отсутствует immutable audit ${action}`);
        }
      }
    }
  }

  const guards = evaluateFulfilmentGuards({
    policyApproved: documentParity.ok
      && record.documentRequirements.length > 0
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

function documentAuditActions(version: {
  status: string;
  assignedReviewerMembershipId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}): string[] {
  const actions = ["document.version_uploaded.v1"];
  if (version.assignedReviewerMembershipId != null) {
    actions.push("document.review_started.v1");
  }
  if (version.reviewedAt != null && version.rejectionReason == null) actions.push("document.verified.v1");
  if (version.reviewedAt != null && version.rejectionReason != null) actions.push("document.rejected.v1");
  if (version.status === "SUPERSEDED") actions.push("document.version_superseded.v1");
  return actions;
}

function contractAuditActions(status: string): string[] {
  const actions = ["contract.version_created.v1"];
  if (status !== "DRAFT") actions.push("contract.issued.v1");
  if (status === "SIGNED" || status === "SUPERSEDED") actions.push("contract.signed_obligation_created.v1");
  if (status === "SUPERSEDED") actions.push("contract.superseded.v1");
  return actions;
}

function ledgerAuditAction(type: string, webhook: boolean): string {
  if (type === "OBLIGATION") return "ledger.obligation_appended.v1";
  if (type === "PAYMENT") return webhook ? "ledger.webhook_payment_appended.v1" : "ledger.payment_appended.v1";
  if (type === "REFUND") return "ledger.refund_appended.v1";
  return "ledger.adjustment_requested.v1";
}

function approvalAuditActions(decision: string | null): string[] {
  const actions = ["ledger.adjustment_approval_requested.v1"];
  if (decision === "APPROVED") actions.push("ledger.adjustment_approved.v1");
  if (decision === "REJECTED") actions.push("ledger.adjustment_rejected.v1");
  return actions;
}
