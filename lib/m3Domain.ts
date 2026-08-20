import type { CaseStage } from "@prisma/client";

export const CASE_PARTY_ROLES = [
  "APPLICANT",
  "DECISION_MAKER",
  "PAYER",
  "RESPONSIBLE_FOR_BURIAL",
  "ADDITIONAL_CONTACT",
] as const;

export type CasePartyRoleValue = (typeof CASE_PARTY_ROLES)[number];

export type DocumentVersionProjection = {
  versionNumber: number;
  status: "REQUIRED" | "UPLOADED" | "QUARANTINED" | "IN_REVIEW" | "VERIFIED" | "REJECTED" | "EXPIRED" | "SUPERSEDED";
  scanStatus: "PENDING" | "CLEAN" | "INFECTED" | "ERROR";
  expiresAt: Date | null;
};

export type DocumentRequirementProjection = {
  status: "NOT_SATISFIED" | "SATISFIED";
  verifiedVersionNumber: number | null;
};

export function evaluateDocumentRequirement(
  versions: readonly DocumentVersionProjection[],
  now = new Date(),
): DocumentRequirementProjection {
  const latest = [...versions].sort((left, right) => right.versionNumber - left.versionNumber)[0];
  if (
    !latest
    || latest.status !== "VERIFIED"
    || latest.scanStatus !== "CLEAN"
    || (latest.expiresAt != null && latest.expiresAt.getTime() <= now.getTime())
  ) {
    return { status: "NOT_SATISFIED", verifiedVersionNumber: null };
  }
  return { status: "SATISFIED", verifiedVersionNumber: latest.versionNumber };
}

const DOCUMENT_GUARD_KEYS = {
  "identity-record": "identity_verified",
  "death-record": "death_document_verified",
  "cremation-authorization": "cremation_authorization_verified",
  "plot-entitlement": "plot_entitlement_verified",
  "relationship-evidence": "relationship_verified",
} as const;

export type CaseDocumentTruthInput = {
  stableKey: string;
  blockingStage: CaseStage;
  versions: readonly DocumentVersionProjection[];
};

export type CaseDocumentTruth = {
  required: number;
  uploaded: number;
  verified: number;
  ready: boolean;
  readyForExecution: boolean;
  guardState: Record<string, boolean>;
};

export function deriveCaseDocumentTruth(
  requirements: readonly CaseDocumentTruthInput[],
  now = new Date(),
): CaseDocumentTruth {
  const guardState: Record<string, boolean> = Object.fromEntries(
    Object.values(DOCUMENT_GUARD_KEYS).map((key) => [key, false]),
  );
  const projected = requirements.map((requirement) => ({
    ...requirement,
    satisfied: evaluateDocumentRequirement(requirement.versions, now).status === "SATISFIED",
  }));

  for (const requirement of projected) {
    const guardKey = DOCUMENT_GUARD_KEYS[requirement.stableKey as keyof typeof DOCUMENT_GUARD_KEYS];
    if (guardKey) guardState[guardKey] = requirement.satisfied;
  }

  const executionRequirements = projected.filter(
    (requirement) => caseStageRank(requirement.blockingStage) <= caseStageRank("EXECUTION"),
  );
  const verified = projected.filter((requirement) => requirement.satisfied).length;

  return {
    required: projected.length,
    uploaded: projected.filter((requirement) => requirement.versions.length > 0).length,
    verified,
    ready: projected.length > 0 && verified === projected.length,
    readyForExecution: executionRequirements.length > 0
      && executionRequirements.every((requirement) => requirement.satisfied),
    guardState,
  };
}

function caseStageRank(stage: CaseStage): number {
  const order: CaseStage[] = ["INTAKE", "PLANNING", "QUOTING", "AGREEMENT", "CONTRACTING", "PAYMENT", "EXECUTION", "CLOSED"];
  return order.indexOf(stage);
}

export type DraftRequirementBlueprint = {
  stableKey: string;
  displayName: string;
  policyStatus: "DRAFT_POLICY";
  required: boolean;
  blockingStage: "EXECUTION" | "CLOSED";
  acceptedDocumentTypeCodes: readonly string[];
  conditionExplanation: string | null;
};

const DRAFT_SCENARIO_REQUIREMENTS: Record<"CREMATION_V1" | "FAMILY_PLOT_BURIAL_V1", readonly DraftRequirementBlueprint[]> = {
  CREMATION_V1: [
    {
      stableKey: "identity-record",
      displayName: "Документ заявителя",
      policyStatus: "DRAFT_POLICY",
      required: true,
      blockingStage: "EXECUTION",
      acceptedDocumentTypeCodes: ["APPLICANT_IDENTITY"],
      conditionExplanation: null,
    },
    {
      stableKey: "death-record",
      displayName: "Документ о смерти",
      policyStatus: "DRAFT_POLICY",
      required: true,
      blockingStage: "EXECUTION",
      acceptedDocumentTypeCodes: ["DEATH_RECORD"],
      conditionExplanation: null,
    },
    {
      stableKey: "cremation-authorization",
      displayName: "Основание для кремации",
      policyStatus: "DRAFT_POLICY",
      required: true,
      blockingStage: "EXECUTION",
      acceptedDocumentTypeCodes: ["CREMATION_AUTHORIZATION"],
      conditionExplanation: "Черновое операционное правило; требуется вердикт ритуального SME и Legal.",
    },
  ],
  FAMILY_PLOT_BURIAL_V1: [
    {
      stableKey: "identity-record",
      displayName: "Документ заявителя",
      policyStatus: "DRAFT_POLICY",
      required: true,
      blockingStage: "EXECUTION",
      acceptedDocumentTypeCodes: ["APPLICANT_IDENTITY"],
      conditionExplanation: null,
    },
    {
      stableKey: "death-record",
      displayName: "Документ о смерти",
      policyStatus: "DRAFT_POLICY",
      required: true,
      blockingStage: "EXECUTION",
      acceptedDocumentTypeCodes: ["DEATH_RECORD"],
      conditionExplanation: null,
    },
    {
      stableKey: "plot-entitlement",
      displayName: "Основание использования участка",
      policyStatus: "DRAFT_POLICY",
      required: true,
      blockingStage: "EXECUTION",
      acceptedDocumentTypeCodes: ["PLOT_ENTITLEMENT"],
      conditionExplanation: "Черновое операционное правило; требуется вердикт ритуального SME и Legal.",
    },
    {
      stableKey: "relationship-evidence",
      displayName: "Подтверждение связи с семейным захоронением",
      policyStatus: "DRAFT_POLICY",
      required: true,
      blockingStage: "EXECUTION",
      acceptedDocumentTypeCodes: ["RELATIONSHIP_EVIDENCE"],
      conditionExplanation: "Черновое условное правило; конкретные основания не утверждены.",
    },
  ],
};

export function getDraftScenarioRequirementBlueprints(
  scenario: "CREMATION_V1" | "FAMILY_PLOT_BURIAL_V1",
): readonly DraftRequirementBlueprint[] {
  return DRAFT_SCENARIO_REQUIREMENTS[scenario];
}

export type LedgerProjectionEntry = {
  id: string;
  type: "OBLIGATION" | "PAYMENT" | "REFUND" | "CORRECTION" | "REVERSAL";
  direction: "DEBIT" | "CREDIT";
  amountKopecks: number;
  effective: boolean;
  relatedEntryId?: string | null;
};

export type PaymentTruthStatus =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERPAID"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export type LedgerSummary = {
  state: "KNOWN" | "LEGACY_INCOMPLETE";
  status: PaymentTruthStatus | null;
  currency: string;
  obligationKopecks: number | null;
  paidKopecks: number | null;
  refundedKopecks: number | null;
  balanceKopecks: number | null;
};

export function deriveLedgerSummary(
  entries: readonly LedgerProjectionEntry[],
  currency: string,
): LedgerSummary {
  const effective = entries.filter((entry) => entry.effective);
  const entriesById = new Map<string, LedgerProjectionEntry>();
  for (const entry of entries) {
    if (entriesById.has(entry.id)) throw new Error("Ledger entry IDs must be unique");
    entriesById.set(entry.id, entry);
  }
  for (const entry of effective) {
    if (!Number.isSafeInteger(entry.amountKopecks) || entry.amountKopecks <= 0) {
      throw new Error("Ledger amounts must be positive safe integers in minor units");
    }
  }

  const obligations = effective.filter((entry) => entry.type === "OBLIGATION");
  if (obligations.length === 0) {
    return {
      state: "LEGACY_INCOMPLETE",
      status: null,
      currency,
      obligationKopecks: null,
      paidKopecks: null,
      refundedKopecks: null,
      balanceKopecks: null,
    };
  }
  if (obligations.some((entry) => entry.direction !== "DEBIT")) {
    throw new Error("Obligation entries must use DEBIT direction");
  }

  const obligationKopecks = obligations.reduce((sum, entry) => safeAdd(sum, entry.amountKopecks), 0);
  let netPaidKopecks = 0;
  let refundedKopecks = 0;
  for (const entry of effective) {
    if (entry.type === "OBLIGATION") continue;
    const signed = entry.direction === "CREDIT" ? entry.amountKopecks : -entry.amountKopecks;
    netPaidKopecks = safeAdd(netPaidKopecks, signed);
    if (entry.type === "REFUND") {
      if (entry.direction !== "DEBIT" || !entry.relatedEntryId) {
        throw new Error("Refund entries must debit and reference the original payment");
      }
      const payment = entriesById.get(entry.relatedEntryId);
      if (!payment?.effective || payment.type !== "PAYMENT") {
        throw new Error("Refund entries must reference an effective payment");
      }
    }
    if (entry.type === "REFUND" || adjustmentDescendsFromRefund(entry, entriesById)) {
      const refundDelta = entry.direction === "DEBIT" ? entry.amountKopecks : -entry.amountKopecks;
      refundedKopecks = safeAdd(refundedKopecks, refundDelta);
    }
  }
  if (netPaidKopecks < 0) throw new Error("Ledger cannot derive a negative paid amount");
  if (refundedKopecks < 0) throw new Error("Ledger cannot reverse more than the effective refund amount");

  const balanceKopecks = obligationKopecks - netPaidKopecks;
  let status: PaymentTruthStatus;
  if (refundedKopecks > 0) {
    status = netPaidKopecks === 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
  } else if (netPaidKopecks === 0) {
    status = "UNPAID";
  } else if (netPaidKopecks < obligationKopecks) {
    status = "PARTIALLY_PAID";
  } else if (netPaidKopecks === obligationKopecks) {
    status = "PAID";
  } else {
    status = "OVERPAID";
  }

  return {
    state: "KNOWN",
    status,
    currency,
    obligationKopecks,
    paidKopecks: netPaidKopecks,
    refundedKopecks,
    balanceKopecks,
  };
}

export function remainingRefundableKopecks(
  entries: readonly LedgerProjectionEntry[],
  paymentEntryId: string,
): number {
  const effective = entries.filter((entry) => entry.effective);
  const entriesById = new Map<string, LedgerProjectionEntry>();
  for (const entry of entries) {
    if (entriesById.has(entry.id)) throw new Error("Ledger entry IDs must be unique");
    entriesById.set(entry.id, entry);
  }

  const payment = entriesById.get(paymentEntryId);
  if (!payment?.effective || payment.type !== "PAYMENT" || payment.direction !== "CREDIT") {
    throw new Error("Refund capacity requires an effective payment");
  }
  if (!Number.isSafeInteger(payment.amountKopecks) || payment.amountKopecks <= 0) {
    throw new Error("Ledger amounts must be positive safe integers in minor units");
  }

  const refundRoots = effective.filter((entry) => {
    if (entry.type !== "REFUND" || entry.relatedEntryId !== paymentEntryId) return false;
    if (entry.direction !== "DEBIT") throw new Error("Refund entries must use DEBIT direction");
    return true;
  });
  let refundedKopecks = 0;
  for (const entry of effective) {
    const belongsToPaymentRefund = refundRoots.some((refund) => (
      entry.id === refund.id || ledgerEntryDescendsFrom(entry, refund.id, entriesById)
    ));
    if (!belongsToPaymentRefund) continue;
    refundedKopecks = safeAdd(
      refundedKopecks,
      entry.direction === "DEBIT" ? entry.amountKopecks : -entry.amountKopecks,
    );
  }
  if (refundedKopecks < 0 || refundedKopecks > payment.amountKopecks) {
    throw new Error("Refund ledger exceeds the effective payment amount");
  }
  return payment.amountKopecks - refundedKopecks;
}

function adjustmentDescendsFromRefund(
  entry: LedgerProjectionEntry,
  entriesById: ReadonlyMap<string, LedgerProjectionEntry>,
): boolean {
  if (entry.type !== "CORRECTION" && entry.type !== "REVERSAL") return false;
  if (!entry.relatedEntryId) throw new Error("Ledger adjustments must reference an original entry");

  const visited = new Set<string>([entry.id]);
  let relatedId: string | null | undefined = entry.relatedEntryId;
  while (relatedId) {
    if (visited.has(relatedId)) throw new Error("Ledger adjustment relations cannot contain a cycle");
    visited.add(relatedId);
    const related = entriesById.get(relatedId);
    if (!related) throw new Error("Ledger adjustment references an unknown entry");
    if (!related.effective) throw new Error("Ledger adjustment cannot depend on an ineffective entry");
    if (related.type === "REFUND") return true;
    if (related.type !== "CORRECTION" && related.type !== "REVERSAL") return false;
    relatedId = related.relatedEntryId;
  }
  return false;
}

function ledgerEntryDescendsFrom(
  entry: LedgerProjectionEntry,
  ancestorId: string,
  entriesById: ReadonlyMap<string, LedgerProjectionEntry>,
): boolean {
  const visited = new Set<string>([entry.id]);
  let relatedId: string | null | undefined = entry.relatedEntryId;
  while (relatedId) {
    if (relatedId === ancestorId) return true;
    if (visited.has(relatedId)) throw new Error("Ledger adjustment relations cannot contain a cycle");
    visited.add(relatedId);
    const related = entriesById.get(relatedId);
    if (!related) throw new Error("Ledger adjustment references an unknown entry");
    if (!related.effective) throw new Error("Ledger adjustment cannot depend on an ineffective entry");
    relatedId = related.relatedEntryId;
  }
  return false;
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error("Ledger arithmetic exceeded safe integer range");
  return value;
}

export function requiresFourEyesApproval(input: {
  type: LedgerProjectionEntry["type"];
  amountKopecks: number;
  thresholdKopecks: number | null;
}): boolean {
  if (input.type !== "CORRECTION" && input.type !== "REVERSAL") return false;
  return input.thresholdKopecks == null || input.amountKopecks >= input.thresholdKopecks;
}

export type FulfilmentBlocker = {
  code:
    | "POLICY_UNAPPROVED"
    | "DOCUMENT_NOT_VERIFIED"
    | "CONTRACT_NOT_SIGNED"
    | "PAYMENT_UNKNOWN"
    | "PAYMENT_BALANCE_REMAINS"
    | "FINANCIAL_ADJUSTMENT_PENDING"
    | "RECONCILIATION_MISMATCH";
  reason: string;
  owner: string;
  dueAt: Date | null;
  requirementKey?: string;
};

export function evaluateFulfilmentGuards(input: {
  policyApproved: boolean;
  requiredDocuments: readonly {
    stableKey: string;
    status: "NOT_SATISFIED" | "SATISFIED";
    owner: string;
    dueAt: Date | null;
  }[];
  contractStatus: "MISSING" | "DRAFT" | "ISSUED" | "SIGNED" | "CANCELLED" | "SUPERSEDED";
  paymentStatus: PaymentTruthStatus | "LEGACY_INCOMPLETE";
  pendingFinancialAdjustments: number;
  reconciliationDiscrepancies: number;
}): { ready: boolean; blockers: FulfilmentBlocker[] } {
  const blockers: FulfilmentBlocker[] = [];
  if (!input.policyApproved) {
    blockers.push({
      code: "POLICY_UNAPPROVED",
      reason: "Сценарная политика документов ещё не утверждена человеком.",
      owner: "ADMIN",
      dueAt: null,
    });
  }
  for (const requirement of input.requiredDocuments) {
    if (requirement.status === "SATISFIED") continue;
    blockers.push({
      code: "DOCUMENT_NOT_VERIFIED",
      reason: "Требование не закрыто проверенной версией документа.",
      owner: requirement.owner,
      dueAt: requirement.dueAt,
      requirementKey: requirement.stableKey,
    });
  }
  if (input.contractStatus !== "SIGNED") {
    blockers.push({
      code: "CONTRACT_NOT_SIGNED",
      reason: "Нет действующей подписанной версии договора.",
      owner: "AGENT",
      dueAt: null,
    });
  }
  if (input.paymentStatus === "LEGACY_INCOMPLETE") {
    blockers.push({
      code: "PAYMENT_UNKNOWN",
      reason: "Обязательство или подтверждённый ledger отсутствует.",
      owner: "FINANCE",
      dueAt: null,
    });
  } else if (!paymentAllowsFulfilment(input.paymentStatus)) {
    blockers.push({
      code: "PAYMENT_BALANCE_REMAINS",
      reason: "По обязательству остаётся непогашенный баланс.",
      owner: "FINANCE",
      dueAt: null,
    });
  }
  if (input.pendingFinancialAdjustments > 0) {
    blockers.push({
      code: "FINANCIAL_ADJUSTMENT_PENDING",
      reason: "Коррекция или сторно ожидает независимого решения.",
      owner: "FINANCE",
      dueAt: null,
    });
  }
  if (input.reconciliationDiscrepancies > 0) {
    blockers.push({
      code: "RECONCILIATION_MISMATCH",
      reason: "Reconciliation обнаружила расхождение; автоматическое исправление запрещено.",
      owner: "ADMIN",
      dueAt: null,
    });
  }
  return { ready: blockers.length === 0, blockers };
}

function paymentAllowsFulfilment(status: PaymentTruthStatus): boolean {
  return status === "PAID" || status === "OVERPAID";
}
