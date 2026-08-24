import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type LedgerDirection, type PaymentLedgerEntryType, type PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendOperationalAudit, findOperationalReplay } from "@/lib/operationalAudit";
import { assertCapability, type OperationalContext } from "@/lib/operationalAuth";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";
import {
  commandFingerprint,
  prismaJson,
  readReplayResult,
  requireTenantCase,
  type M3CommandMeta,
  validateM3CommandMeta,
} from "@/lib/m3Command";
import {
  assertLedgerAdjustmentForestCapacity,
  deriveLedgerSummary,
  remainingRefundableKopecks,
  requiresFourEyesApproval,
  type LedgerProjectionEntry,
  type LedgerSummary,
} from "@/lib/m3Domain";
import { advanceCaseFulfilmentInTransaction } from "@/lib/caseFulfilment";

type CommandResult<T> = T & { replayed: boolean };

type LedgerInsertAuthorization = {
  organizationId: string;
  caseId: string;
  obligationId: string;
  payerPartyId: string | null;
  type: PaymentLedgerEntryType;
  direction: LedgerDirection;
  amountKopecks: number;
  currency: string;
  source: string;
  relatedEntryId: string | null;
  externalTransactionId: string | null;
  idempotencyKey: string;
};

export async function createContractVersion(
  context: OperationalContext,
  input: {
    caseId: string;
    payerPartyId: string;
    paymentTerms: Record<string, unknown>;
    validUntil?: Date | null;
  },
  meta: M3CommandMeta,
): Promise<CommandResult<{ contractVersionId: string; versionNumber: number; status: "DRAFT" }>> {
  assertCapability(context, "contracts:manage");
  validateM3CommandMeta(meta);
  const fingerprint = commandFingerprint({ ...input, validUntil: input.validUntil?.toISOString() ?? null });
  return runOperationalTransaction(async (tx) => {
    const replay = await readAuditReplay<{ contractVersionId: string; versionNumber: number; status: "DRAFT" }>(
      tx, context.organizationId, meta.idempotencyKey, fingerprint,
    );
    if (replay) return { ...replay, replayed: true };

    const caseRecord = await requireTenantCase(tx, context, input.caseId, { requireOwnerForAgent: true });
    if (!caseRecord.publishedQuoteVersionId) {
      throw new OperationalCommandError(422, "Для договора нужна принятая опубликованная версия сметы");
    }
    const quoteVersion = await tx.quoteVersion.findFirst({
      where: {
        id: caseRecord.publishedQuoteVersionId,
        state: "PUBLISHED",
        totalState: "KNOWN",
        quote: { caseId: caseRecord.id, organizationId: context.organizationId, status: "ACCEPTED" },
      },
      select: {
        id: true,
        total: true,
        currency: true,
        snapshotChecksum: true,
        versionNumber: true,
      },
    });
    if (!quoteVersion || quoteVersion.total <= 0 || !quoteVersion.snapshotChecksum) {
      throw new OperationalCommandError(422, "Принятая смета не содержит подтверждённого immutable snapshot");
    }
    const now = new Date();
    const payer = await tx.caseParty.findFirst({
      where: {
        id: input.payerPartyId,
        caseId: caseRecord.id,
        organizationId: context.organizationId,
        roles: {
          some: {
            role: "PAYER",
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
        },
      },
      select: { id: true },
    });
    if (!payer) throw new OperationalCommandError(422, "Для договора нужен действующий плательщик");
    const parties = await tx.caseParty.findMany({
      where: { caseId: caseRecord.id, organizationId: context.organizationId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        nameEncrypted: true,
        phoneEncrypted: true,
        emailEncrypted: true,
        consentStatus: true,
        roles: {
          where: { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
          select: { role: true, validFrom: true, validUntil: true },
        },
      },
    });
    const contract = await tx.contract.upsert({
      where: { caseId: caseRecord.id },
      update: {},
      create: {
        organizationId: context.organizationId,
        caseId: caseRecord.id,
        createdByMembershipId: context.membershipId,
      },
      select: { id: true },
    });
    const existingForQuote = await tx.contractVersion.findUnique({
      where: { contractId_quoteVersionId: { contractId: contract.id, quoteVersionId: quoteVersion.id } },
      select: { id: true },
    });
    if (existingForQuote) throw new OperationalCommandError(409, "Для этой принятой версии сметы договор уже существует");
    const previous = await tx.contractVersion.findFirst({
      where: { contractId: contract.id },
      orderBy: { versionNumber: "desc" },
      select: { id: true, versionNumber: true, status: true },
    });
    const versionNumber = (previous?.versionNumber ?? 0) + 1;
    const snapshot = {
      schemaVersion: 1,
      quoteVersionId: quoteVersion.id,
      quoteVersionNumber: quoteVersion.versionNumber,
      quoteSnapshotChecksum: quoteVersion.snapshotChecksum,
      payerPartyId: payer.id,
      parties,
      currency: quoteVersion.currency,
      totalObligationKopecks: quoteVersion.total,
      paymentTerms: input.paymentTerms,
      validUntil: input.validUntil?.toISOString() ?? null,
    };
    const checksum = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    const version = await tx.contractVersion.create({
      data: {
        contractId: contract.id,
        organizationId: context.organizationId,
        caseId: caseRecord.id,
        quoteVersionId: quoteVersion.id,
        versionNumber,
        status: "DRAFT",
        partiesSnapshot: prismaJson(parties),
        payerPartyId: payer.id,
        currency: quoteVersion.currency,
        totalObligationKopecks: quoteVersion.total,
        paymentTerms: prismaJson(input.paymentTerms),
        issuedByMembershipId: context.membershipId,
        checksum,
        validUntil: input.validUntil ?? null,
        supersedesVersionId: previous?.id ?? null,
        idempotencyKey: meta.idempotencyKey,
        correlationId: meta.correlationId,
      },
      select: { id: true, versionNumber: true },
    });
    const data = { contractVersionId: version.id, versionNumber: version.versionNumber, status: "DRAFT" as const };
    await appendOperationalAudit(tx, context, {
      entityType: "contract_version",
      entityId: version.id,
      action: "contract.version_created.v1",
      before: prismaJson(previous ? { previousVersionId: previous.id, previousStatus: previous.status } : {}),
      after: prismaJson({ versionNumber, quoteVersionId: quoteVersion.id, checksum, status: "DRAFT" }),
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
      reason: meta.reason,
      result: replayEnvelope(fingerprint, data),
    });
    return { ...data, replayed: false };
  });
}

export async function issueContractVersion(
  context: OperationalContext,
  contractVersionId: string,
  meta: M3CommandMeta,
): Promise<CommandResult<{ contractVersionId: string; status: "ISSUED" }>> {
  assertCapability(context, "contracts:manage");
  validateM3CommandMeta(meta);
  const fingerprint = commandFingerprint({ contractVersionId, command: "issue" });
  return runOperationalTransaction(async (tx) => {
    const replay = await readAuditReplay<{ contractVersionId: string; status: "ISSUED" }>(
      tx, context.organizationId, meta.idempotencyKey, fingerprint,
    );
    if (replay) return { ...replay, replayed: true };
    const version = await tx.contractVersion.findFirst({
      where: { id: contractVersionId, organizationId: context.organizationId, status: "DRAFT" },
      select: { id: true, caseId: true, validUntil: true },
    });
    if (!version) throw new OperationalCommandError(404, "Черновик договора не найден");
    if (version.validUntil && version.validUntil <= new Date()) throw new OperationalCommandError(409, "Срок договора истёк");
    await requireTenantCase(tx, context, version.caseId, { requireOwnerForAgent: true });
    await authorizeContractTransition(tx, context, meta, {
      entityId: version.id,
      command: "issue",
      fromStatus: "DRAFT",
      toStatus: "ISSUED",
    });
    await tx.contractVersion.update({ where: { id: version.id }, data: { status: "ISSUED", issuedAt: new Date() } });
    const data = { contractVersionId: version.id, status: "ISSUED" as const };
    await appendOperationalAudit(tx, context, {
      entityType: "contract_version",
      entityId: version.id,
      action: "contract.issued.v1",
      before: prismaJson({ status: "DRAFT" }),
      after: prismaJson({ status: "ISSUED" }),
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
      reason: meta.reason,
      result: replayEnvelope(fingerprint, data),
    });
    return { ...data, replayed: false };
  });
}

export async function signContractVersion(
  context: OperationalContext,
  input: {
    contractVersionId: string;
    signatureEvidence: { type: string; reference: string };
    signaturePolicyVersion: string;
  },
  meta: M3CommandMeta,
): Promise<CommandResult<{ contractVersionId: string; obligationId: string; ledgerEntryId: string; status: "SIGNED" }>> {
  assertCapability(context, "contracts:manage");
  validateM3CommandMeta(meta);
  if (!input.signatureEvidence.type.trim() || input.signatureEvidence.reference.trim().length < 3) {
    throw new OperationalCommandError(422, "Нужно подтверждение подписания без секретных данных");
  }
  if (!input.signaturePolicyVersion.trim()) throw new OperationalCommandError(422, "Нужна версия политики подписания");
  const fingerprint = commandFingerprint(input);
  return runOperationalTransaction(async (tx) => {
    const replay = await readAuditReplay<{
      contractVersionId: string; obligationId: string; ledgerEntryId: string; status: "SIGNED";
    }>(tx, context.organizationId, meta.idempotencyKey, fingerprint);
    if (replay) return { ...replay, replayed: true };
    const policyNow = new Date();
    const signingPolicy = await tx.contractSigningPolicy.findFirst({
      where: {
        organizationId: context.organizationId,
        version: input.signaturePolicyVersion.trim(),
        status: "APPROVED",
        effectiveFrom: { lte: policyNow },
        OR: [{ retiredAt: null }, { retiredAt: { gt: policyNow } }],
      },
      select: { id: true, version: true, allowedEvidenceTypes: true },
    });
    if (
      !signingPolicy
      || !jsonStringList(signingPolicy.allowedEvidenceTypes).includes(input.signatureEvidence.type.trim())
    ) {
      throw new OperationalCommandError(422, "Политика и тип подтверждения подписания не утверждены Legal");
    }
    let version = await tx.contractVersion.findFirst({
      where: { id: input.contractVersionId, organizationId: context.organizationId, status: "ISSUED" },
      select: {
        id: true,
        contractId: true,
        caseId: true,
        quoteVersionId: true,
        supersedesVersionId: true,
        payerPartyId: true,
        totalObligationKopecks: true,
        currency: true,
        validUntil: true,
      },
    });
    if (!version) throw new OperationalCommandError(404, "Выданная версия договора не найдена");
    await lockContract(tx, version.contractId);
    version = await tx.contractVersion.findFirst({
      where: { id: input.contractVersionId, organizationId: context.organizationId, status: "ISSUED" },
      select: {
        id: true,
        contractId: true,
        caseId: true,
        quoteVersionId: true,
        supersedesVersionId: true,
        payerPartyId: true,
        totalObligationKopecks: true,
        currency: true,
        validUntil: true,
      },
    });
    if (!version) throw new OperationalCommandError(409, "Версия договора уже изменилась");
    if (version.validUntil && version.validUntil <= new Date()) throw new OperationalCommandError(409, "Срок договора истёк");
    const caseRecord = await requireTenantCase(tx, context, version.caseId, { requireOwnerForAgent: true });
    if (caseRecord.publishedQuoteVersionId !== version.quoteVersionId) {
      throw new OperationalCommandError(409, "Подписать можно только договор текущей принятой версии сметы");
    }
    const latestVersion = await tx.contractVersion.findFirst({
      where: { contractId: version.contractId },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    });
    if (latestVersion?.id !== version.id) {
      throw new OperationalCommandError(409, "Подписать можно только последнюю версию договора");
    }
    const activeSigned = await tx.contractVersion.findMany({
      where: { contractId: version.contractId, status: "SIGNED", id: { not: version.id } },
      select: { id: true },
    });
    if (activeSigned.length > 1) {
      throw new OperationalCommandError(409, "Обнаружено несколько действующих подписанных договоров");
    }
    if (activeSigned[0] && version.supersedesVersionId !== activeSigned[0].id) {
      throw new OperationalCommandError(409, "Замещаемая подписанная версия договора не совпадает с текущей");
    }
    const signedAt = new Date();
    if (activeSigned[0]) {
      await authorizeContractTransition(tx, context, meta, {
        entityId: activeSigned[0].id,
        command: "supersede",
        fromStatus: "SIGNED",
        toStatus: "SUPERSEDED",
      });
      await tx.contractVersion.update({
        where: { id: activeSigned[0].id },
        data: { status: "SUPERSEDED" },
      });
      await appendOperationalAudit(tx, context, {
        entityType: "contract_version",
        entityId: activeSigned[0].id,
        action: "contract.superseded.v1",
        before: prismaJson({ status: "SIGNED" }),
        after: prismaJson({ status: "SUPERSEDED", supersededByVersionId: version.id }),
        correlationId: meta.correlationId,
        causationId: version.id,
        idempotencyKey: `${meta.idempotencyKey}:supersede`,
        reason: meta.reason,
        result: prismaJson({ contractVersionId: activeSigned[0].id, supersededByVersionId: version.id }),
      });
    }
    await authorizeContractTransition(tx, context, meta, {
      entityId: version.id,
      command: "sign",
      fromStatus: "ISSUED",
      toStatus: "SIGNED",
    });
    await tx.contractVersion.update({
      where: { id: version.id },
      data: {
        status: "SIGNED",
        signedByMembershipId: context.membershipId,
        signedAt,
        signatureEvidence: prismaJson({
          type: input.signatureEvidence.type.trim(),
          reference: input.signatureEvidence.reference.trim(),
        }),
        signaturePolicyId: signingPolicy.id,
        signaturePolicyVersion: signingPolicy.version,
      },
    });
    const obligation = await tx.paymentObligation.create({
      data: {
        organizationId: context.organizationId,
        caseId: version.caseId,
        contractVersionId: version.id,
        payerPartyId: version.payerPartyId,
        amountKopecks: version.totalObligationKopecks,
        currency: version.currency,
        createdByMembershipId: context.membershipId,
        idempotencyKey: `${meta.idempotencyKey}:obligation`,
        correlationId: meta.correlationId,
      },
      select: { id: true },
    });
    await authorizeLedgerInsert(tx, context, {
      organizationId: context.organizationId,
      caseId: version.caseId,
      obligationId: obligation.id,
      payerPartyId: version.payerPartyId,
      type: "OBLIGATION",
      direction: "DEBIT",
      amountKopecks: version.totalObligationKopecks,
      currency: version.currency,
      source: "signed-contract",
      relatedEntryId: null,
      externalTransactionId: null,
      idempotencyKey: `${meta.idempotencyKey}:ledger-obligation`,
    }, meta);
    const ledger = await tx.paymentLedgerEntry.create({
      data: {
        organizationId: context.organizationId,
        caseId: version.caseId,
        obligationId: obligation.id,
        payerPartyId: version.payerPartyId,
        type: "OBLIGATION",
        direction: "DEBIT",
        amountKopecks: version.totalObligationKopecks,
        currency: version.currency,
        occurredAt: signedAt,
        source: "signed-contract",
        evidenceReference: `contract-version:${version.id}`,
        actorMembershipId: context.membershipId,
        idempotencyKey: `${meta.idempotencyKey}:ledger-obligation`,
        correlationId: meta.correlationId,
      },
      select: { id: true },
    });
    const data = {
      contractVersionId: version.id,
      obligationId: obligation.id,
      ledgerEntryId: ledger.id,
      status: "SIGNED" as const,
    };
    await appendOperationalAudit(tx, context, {
      entityType: "contract_version",
      entityId: version.id,
      action: "contract.signed_obligation_created.v1",
      before: prismaJson({ status: "ISSUED" }),
      after: prismaJson({ status: "SIGNED", obligationId: obligation.id, ledgerEntryId: ledger.id }),
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
      reason: meta.reason,
      result: replayEnvelope(fingerprint, data),
    });
    await appendOperationalAudit(tx, context, {
      entityType: "payment_obligation",
      entityId: obligation.id,
      action: "payment.obligation_created.v1",
      before: prismaJson({}),
      after: prismaJson({ amountKopecks: version.totalObligationKopecks, currency: version.currency }),
      correlationId: meta.correlationId,
      causationId: meta.idempotencyKey,
      idempotencyKey: `${meta.idempotencyKey}:obligation-audit`,
      result: prismaJson({ obligationId: obligation.id }),
    });
    await appendOperationalAudit(tx, context, {
      entityType: "payment_ledger_entry",
      entityId: ledger.id,
      action: "ledger.obligation_appended.v1",
      before: prismaJson({}),
      after: prismaJson({ type: "OBLIGATION", direction: "DEBIT", amountKopecks: version.totalObligationKopecks }),
      correlationId: meta.correlationId,
      causationId: meta.idempotencyKey,
      idempotencyKey: `${meta.idempotencyKey}:ledger-obligation-audit`,
      result: prismaJson({ ledgerEntryId: ledger.id }),
    });
    await advanceCaseFulfilmentInTransaction(tx, {
      organizationId: context.organizationId,
      caseId: version.caseId,
      actorAgentId: context.agentId,
      actorMembershipId: context.membershipId,
      idempotencyKey: meta.idempotencyKey,
      correlationId: meta.correlationId,
      causationId: ledger.id,
    });
    return { ...data, replayed: false };
  }, {
    // The contract row lock above is the concurrency boundary for signing. Using
    // Serializable here creates cross-tenant predicate conflicts on shared audit
    // indexes without strengthening the per-contract invariant.
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}

export async function recordManualPayment(
  context: OperationalContext,
  input: {
    obligationId: string;
    payerPartyId: string;
    amountKopecks: number;
    currency: string;
    occurredAt: Date;
    method: PaymentMethod;
    evidenceReference: string;
    reason: string;
  },
  meta: M3CommandMeta,
): Promise<CommandResult<{ ledgerEntryId: string; summary: LedgerSummary }>> {
  assertCapability(context, "finance:record");
  validateLedgerInput(input.amountKopecks, input.currency, input.evidenceReference, input.reason);
  validateM3CommandMeta(meta);
  const fingerprint = commandFingerprint({ ...input, occurredAt: input.occurredAt.toISOString() });
  return runOperationalTransaction(async (tx) => {
    const replay = await readAuditReplay<{ ledgerEntryId: string; summary: LedgerSummary }>(
      tx, context.organizationId, meta.idempotencyKey, fingerprint,
    );
    if (replay) return { ...replay, replayed: true };
    await lockObligationLedger(tx, context.organizationId, input.obligationId);
    const replayAfterLock = await readAuditReplay<{ ledgerEntryId: string; summary: LedgerSummary }>(
      tx, context.organizationId, meta.idempotencyKey, fingerprint,
    );
    if (replayAfterLock) return { ...replayAfterLock, replayed: true };
    const obligation = await loadObligation(tx, context.organizationId, input.obligationId);
    if (obligation.currency !== input.currency) throw new OperationalCommandError(422, "Валюта оплаты не совпадает с обязательством");
    if (obligation.payerPartyId && obligation.payerPartyId !== input.payerPartyId) {
      throw new OperationalCommandError(422, "Плательщик не совпадает с обязательством");
    }
    await authorizeLedgerInsert(tx, context, {
      organizationId: context.organizationId,
      caseId: obligation.caseId,
      obligationId: obligation.id,
      payerPartyId: input.payerPartyId,
      type: "PAYMENT",
      direction: "CREDIT",
      amountKopecks: input.amountKopecks,
      currency: input.currency,
      source: "manual-finance",
      relatedEntryId: null,
      externalTransactionId: null,
      idempotencyKey: meta.idempotencyKey,
    }, meta);
    const entry = await tx.paymentLedgerEntry.create({
      data: {
        organizationId: context.organizationId,
        caseId: obligation.caseId,
        obligationId: obligation.id,
        payerPartyId: input.payerPartyId,
        type: "PAYMENT",
        direction: "CREDIT",
        amountKopecks: input.amountKopecks,
        currency: input.currency,
        occurredAt: input.occurredAt,
        method: input.method,
        source: "manual-finance",
        evidenceReference: input.evidenceReference.trim(),
        actorMembershipId: context.membershipId,
        idempotencyKey: meta.idempotencyKey,
        correlationId: meta.correlationId,
      },
      select: { id: true },
    });
    const summary = await derivePaymentSummaryInTransaction(tx, obligation.id);
    const data = { ledgerEntryId: entry.id, summary };
    await appendLedgerAudit(tx, context, entry.id, "ledger.payment_appended.v1", input, meta, fingerprint, data);
    await advanceCaseFulfilmentInTransaction(tx, {
      organizationId: context.organizationId,
      caseId: obligation.caseId,
      actorAgentId: context.agentId,
      actorMembershipId: context.membershipId,
      idempotencyKey: meta.idempotencyKey,
      correlationId: meta.correlationId,
      causationId: entry.id,
    });
    return { ...data, replayed: false };
  }, {
    // The obligation lock serializes the ledger mutation and lets waiting retries
    // observe the committed replay envelope without cross-tenant predicate aborts.
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}

export async function recordRefund(
  context: OperationalContext,
  input: {
    paymentEntryId: string;
    amountKopecks: number;
    occurredAt: Date;
    method: PaymentMethod;
    evidenceReference: string;
    reason: string;
  },
  meta: M3CommandMeta,
): Promise<CommandResult<{ ledgerEntryId: string; summary: LedgerSummary }>> {
  assertCapability(context, "finance:record");
  validateLedgerInput(input.amountKopecks, "RUB", input.evidenceReference, input.reason);
  validateM3CommandMeta(meta);
  const fingerprint = commandFingerprint({ ...input, occurredAt: input.occurredAt.toISOString() });
  return runOperationalTransaction(async (tx) => {
    const replay = await readAuditReplay<{ ledgerEntryId: string; summary: LedgerSummary }>(
      tx, context.organizationId, meta.idempotencyKey, fingerprint,
    );
    if (replay) return { ...replay, replayed: true };
    const payment = await tx.paymentLedgerEntry.findFirst({
      where: { id: input.paymentEntryId, organizationId: context.organizationId, type: "PAYMENT" },
      select: {
        id: true,
        organizationId: true,
        caseId: true,
        obligationId: true,
        payerPartyId: true,
        type: true,
        direction: true,
        amountKopecks: true,
        currency: true,
        approvalRequired: true,
        approval: { select: { decision: true } },
      },
    });
    if (!payment) throw new OperationalCommandError(404, "Исходная оплата не найдена");
    await lockObligationLedger(tx, context.organizationId, payment.obligationId);
    const replayAfterLock = await readAuditReplay<{ ledgerEntryId: string; summary: LedgerSummary }>(
      tx, context.organizationId, meta.idempotencyKey, fingerprint,
    );
    if (replayAfterLock) return { ...replayAfterLock, replayed: true };
    await assertSourceCapacity(tx, payment.obligationId, {
      id: `candidate:${meta.idempotencyKey}`,
      type: "REFUND",
      direction: "DEBIT",
      amountKopecks: input.amountKopecks,
      relatedEntryId: payment.id,
      effective: true,
      reserved: false,
    });
    await authorizeLedgerInsert(tx, context, {
      organizationId: context.organizationId,
      caseId: payment.caseId,
      obligationId: payment.obligationId,
      payerPartyId: payment.payerPartyId,
      type: "REFUND",
      direction: "DEBIT",
      amountKopecks: input.amountKopecks,
      currency: payment.currency,
      source: "manual-finance-refund",
      relatedEntryId: payment.id,
      externalTransactionId: null,
      idempotencyKey: meta.idempotencyKey,
    }, meta);
    const entry = await tx.paymentLedgerEntry.create({
      data: {
        organizationId: context.organizationId,
        caseId: payment.caseId,
        obligationId: payment.obligationId,
        payerPartyId: payment.payerPartyId,
        type: "REFUND",
        direction: "DEBIT",
        amountKopecks: input.amountKopecks,
        currency: payment.currency,
        occurredAt: input.occurredAt,
        method: input.method,
        source: "manual-finance-refund",
        evidenceReference: input.evidenceReference.trim(),
        actorMembershipId: context.membershipId,
        idempotencyKey: meta.idempotencyKey,
        correlationId: meta.correlationId,
        relatedEntryId: payment.id,
      },
      select: { id: true },
    });
    const summary = await derivePaymentSummaryInTransaction(tx, payment.obligationId);
    const data = { ledgerEntryId: entry.id, summary };
    await appendLedgerAudit(tx, context, entry.id, "ledger.refund_appended.v1", input, meta, fingerprint, data);
    return { ...data, replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function requestLedgerAdjustment(
  context: OperationalContext,
  input: {
    type: "CORRECTION" | "REVERSAL";
    relatedEntryId: string;
    direction: LedgerDirection;
    amountKopecks: number;
    occurredAt: Date;
    evidenceReference: string;
    reason: string;
  },
  meta: M3CommandMeta,
): Promise<CommandResult<{ ledgerEntryId: string; approvalRequired: boolean; policyVersion: number }>> {
  assertCapability(context, "finance:record");
  validateLedgerInput(input.amountKopecks, "RUB", input.evidenceReference, input.reason);
  validateM3CommandMeta(meta);
  const fingerprint = commandFingerprint({ ...input, occurredAt: input.occurredAt.toISOString() });
  return runOperationalTransaction(async (tx) => {
    const replay = await readAuditReplay<{ ledgerEntryId: string; approvalRequired: boolean; policyVersion: number }>(
      tx, context.organizationId, meta.idempotencyKey, fingerprint,
    );
    if (replay) return { ...replay, replayed: true };
    const related = await tx.paymentLedgerEntry.findFirst({
      where: { id: input.relatedEntryId, organizationId: context.organizationId },
      select: {
        id: true,
        caseId: true,
        obligationId: true,
        payerPartyId: true,
        currency: true,
        direction: true,
        type: true,
        amountKopecks: true,
        approvalRequired: true,
        approval: { select: { decision: true } },
      },
    });
    if (!related) throw new OperationalCommandError(404, "Исходная запись ledger не найдена");
    await lockObligationLedger(tx, context.organizationId, related.obligationId);
    const lockedRelated = await tx.paymentLedgerEntry.findFirst({
      where: { id: input.relatedEntryId, organizationId: context.organizationId },
      select: {
        id: true,
        caseId: true,
        obligationId: true,
        payerPartyId: true,
        currency: true,
        direction: true,
        type: true,
        amountKopecks: true,
        approvalRequired: true,
        approval: { select: { decision: true } },
      },
    });
    if (!lockedRelated) throw new OperationalCommandError(404, "Исходная запись ledger не найдена");
    if (lockedRelated.type === "OBLIGATION") {
      throw new OperationalCommandError(422, "Обязательство изменяется только новой версией договора");
    }
    if (lockedRelated.approvalRequired && lockedRelated.approval?.decision !== "APPROVED") {
      throw new OperationalCommandError(409, "Нельзя корректировать не вступившую в силу запись ledger");
    }
    if (input.type === "REVERSAL" && input.direction === lockedRelated.direction) {
      throw new OperationalCommandError(422, "Сторно должно иметь противоположное направление");
    }
    const policy = await tx.financialControlPolicy.findFirst({
      where: { organizationId: context.organizationId, status: "APPROVED" },
      orderBy: { version: "desc" },
    });
    const approvalRequired = requiresFourEyesApproval({
      type: input.type,
      amountKopecks: input.amountKopecks,
      thresholdKopecks: policy?.correctionThresholdKopecks ?? null,
    });
    const policyVersion = policy?.version ?? 0;
    await assertSourceCapacity(tx, lockedRelated.obligationId, {
      id: `candidate:${meta.idempotencyKey}`,
      type: input.type,
      direction: input.direction,
      amountKopecks: input.amountKopecks,
      relatedEntryId: lockedRelated.id,
      effective: !approvalRequired,
      reserved: approvalRequired,
    });
    await authorizeLedgerInsert(tx, context, {
      organizationId: context.organizationId,
      caseId: lockedRelated.caseId,
      obligationId: lockedRelated.obligationId,
      payerPartyId: lockedRelated.payerPartyId,
      type: input.type,
      direction: input.direction,
      amountKopecks: input.amountKopecks,
      currency: lockedRelated.currency,
      source: "manual-finance-adjustment",
      relatedEntryId: lockedRelated.id,
      externalTransactionId: null,
      idempotencyKey: meta.idempotencyKey,
    }, meta);
    const entry = await tx.paymentLedgerEntry.create({
      data: {
        organizationId: context.organizationId,
        caseId: lockedRelated.caseId,
        obligationId: lockedRelated.obligationId,
        payerPartyId: lockedRelated.payerPartyId,
        type: input.type,
        direction: input.direction,
        amountKopecks: input.amountKopecks,
        currency: lockedRelated.currency,
        occurredAt: input.occurredAt,
        source: "manual-finance-adjustment",
        evidenceReference: input.evidenceReference.trim(),
        actorMembershipId: context.membershipId,
        idempotencyKey: meta.idempotencyKey,
        correlationId: meta.correlationId,
        relatedEntryId: lockedRelated.id,
        approvalRequired,
      },
      select: { id: true },
    });
    let approvalId: string | null = null;
    if (approvalRequired) {
      const approval = await tx.paymentLedgerApproval.create({
        data: {
          organizationId: context.organizationId,
          ledgerEntryId: entry.id,
          requestedByMembershipId: context.membershipId,
          policyVersion,
          requestReason: input.reason.trim(),
          idempotencyKey: `${meta.idempotencyKey}:approval-request`,
          correlationId: meta.correlationId,
        },
        select: { id: true },
      });
      approvalId = approval.id;
    } else {
      // Fail before commit if an immediately effective correction would make
      // canonical ledger arithmetic impossible (for example net paid < 0).
      await derivePaymentSummaryInTransaction(tx, lockedRelated.obligationId);
    }
    const data = { ledgerEntryId: entry.id, approvalRequired, policyVersion };
    await appendLedgerAudit(tx, context, entry.id, "ledger.adjustment_requested.v1", input, meta, fingerprint, data);
    if (approvalId) {
      await appendOperationalAudit(tx, context, {
        entityType: "payment_ledger_approval",
        entityId: approvalId,
        action: "ledger.adjustment_approval_requested.v1",
        before: prismaJson({}),
        after: prismaJson({ ledgerEntryId: entry.id, policyVersion }),
        correlationId: meta.correlationId,
        causationId: entry.id,
        idempotencyKey: `${meta.idempotencyKey}:approval-request-audit`,
        reason: input.reason,
        result: prismaJson({ approvalId, ledgerEntryId: entry.id }),
      });
    }
    return { ...data, replayed: false };
  });
}

export async function decideLedgerAdjustment(
  context: OperationalContext,
  input: { ledgerEntryId: string; decision: "APPROVED" | "REJECTED"; reason: string },
  meta: M3CommandMeta,
): Promise<CommandResult<{ ledgerEntryId: string; decision: "APPROVED" | "REJECTED"; summary: LedgerSummary }>> {
  assertCapability(context, "finance:approve");
  validateM3CommandMeta(meta);
  if (input.reason.trim().length < 3) throw new OperationalCommandError(422, "Нужна причина решения");
  const fingerprint = commandFingerprint(input);
  return runOperationalTransaction(async (tx) => {
    const replay = await readAuditReplay<{
      ledgerEntryId: string; decision: "APPROVED" | "REJECTED"; summary: LedgerSummary;
    }>(tx, context.organizationId, meta.idempotencyKey, fingerprint);
    if (replay) return { ...replay, replayed: true };
    const entry = await tx.paymentLedgerEntry.findFirst({
      where: { id: input.ledgerEntryId, organizationId: context.organizationId, approvalRequired: true },
      include: { approval: true },
    });
    if (!entry?.approval || entry.approval.decision) {
      throw new OperationalCommandError(404, "Ожидающая коррекция не найдена");
    }
    await lockObligationLedger(tx, context.organizationId, entry.obligationId);
    const lockedEntry = await tx.paymentLedgerEntry.findFirst({
      where: { id: input.ledgerEntryId, organizationId: context.organizationId, approvalRequired: true },
      include: { approval: true },
    });
    if (!lockedEntry?.approval || lockedEntry.approval.decision) {
      throw new OperationalCommandError(404, "Ожидающая коррекция не найдена");
    }
    if (lockedEntry.approval.requestedByMembershipId === context.membershipId) {
      throw new OperationalCommandError(403, "Автор коррекции не может принять решение по ней");
    }
    const policy = await tx.financialControlPolicy.findFirst({
      where: {
        organizationId: context.organizationId,
        status: { in: ["APPROVED", "RETIRED"] },
        version: lockedEntry.approval.policyVersion,
      },
    });
    if (!policy || lockedEntry.approval.policyVersion <= 0) {
      throw new OperationalCommandError(409, "Finance policy не утверждена; коррекция остаётся в ожидании");
    }
    if (input.decision === "APPROVED") {
      if (!lockedEntry.relatedEntryId) throw new OperationalCommandError(409, "Коррекция не связана с исходной записью ledger");
      await assertSourceCapacity(tx, lockedEntry.obligationId);
    }
    const decided = await tx.paymentLedgerApproval.updateMany({
      where: { id: lockedEntry.approval.id, decision: null, decidedByMembershipId: null, decidedAt: null },
      data: {
        decidedByMembershipId: context.membershipId,
        decision: input.decision,
        decidedAt: new Date(),
        decisionReason: input.reason.trim(),
      },
    });
    if (decided.count !== 1) throw new OperationalCommandError(409, "По коррекции уже принято решение");
    const summary = await derivePaymentSummaryInTransaction(tx, lockedEntry.obligationId);
    const data = { ledgerEntryId: lockedEntry.id, decision: input.decision, summary };
    await appendOperationalAudit(tx, context, {
      entityType: "payment_ledger_approval",
      entityId: lockedEntry.approval.id,
      action: input.decision === "APPROVED" ? "ledger.adjustment_approved.v1" : "ledger.adjustment_rejected.v1",
      before: prismaJson({ decision: null, policyVersion: lockedEntry.approval.policyVersion }),
      after: prismaJson({ decision: input.decision }),
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
      reason: input.reason,
      result: replayEnvelope(fingerprint, data),
    });
    await advanceCaseFulfilmentInTransaction(tx, {
      organizationId: context.organizationId,
      caseId: lockedEntry.caseId,
      actorAgentId: context.agentId,
      actorMembershipId: context.membershipId,
      idempotencyKey: meta.idempotencyKey,
      correlationId: meta.correlationId,
      causationId: lockedEntry.id,
    });
    return { ...data, replayed: false };
  });
}

export async function getPaymentSummary(context: OperationalContext, obligationId: string): Promise<LedgerSummary> {
  assertCapability(context, "finance:summary");
  const obligation = await prisma.paymentObligation.findFirst({
    where: {
      id: obligationId,
      organizationId: context.organizationId,
      ...(context.role === "AGENT" ? { case: { ownerId: context.agentId } } : {}),
    },
    select: { id: true },
  });
  if (!obligation) throw new OperationalCommandError(404, "Обязательство не найдено");
  return derivePaymentSummaryInTransaction(prisma, obligation.id);
}

export async function listCaseContractAndLedger(context: OperationalContext, caseId: string) {
  assertCapability(context, "finance:summary");
  const record = await prisma.case.findFirst({
    where: {
      id: caseId,
      tenantId: context.organizationId,
      ...(context.role === "AGENT" ? { ownerId: context.agentId } : {}),
    },
    select: {
      id: true,
      contractVersions: {
        orderBy: { versionNumber: "desc" },
        select: {
          id: true,
          versionNumber: true,
          status: true,
          totalObligationKopecks: true,
          currency: true,
          issuedAt: true,
          signedAt: true,
          validUntil: true,
          quoteVersionId: true,
          obligation: { select: { id: true } },
        },
      },
    },
  });
  if (!record) throw new OperationalCommandError(404, "Кейс не найден");
  const versions = await Promise.all(record.contractVersions.map(async (version) => ({
    ...version,
    payment: version.obligation ? await derivePaymentSummaryInTransaction(prisma, version.obligation.id) : null,
  })));
  return { caseId: record.id, versions };
}

export async function listFinanceWorkspace(context: OperationalContext) {
  assertCapability(context, "finance:read");
  const obligations = await prisma.paymentObligation.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      caseId: true,
      amountKopecks: true,
      currency: true,
      payerPartyId: true,
      createdAt: true,
      case: { select: { publicRef: true, stage: true } },
      contractVersion: { select: { id: true, versionNumber: true, status: true, signedAt: true } },
      ledgerEntries: {
        orderBy: { occurredAt: "desc" },
        select: {
          id: true,
          type: true,
          direction: true,
          amountKopecks: true,
          currency: true,
          occurredAt: true,
          method: true,
          source: true,
          evidenceReference: true,
          relatedEntryId: true,
          approvalRequired: true,
          approval: { select: { decision: true } },
        },
      },
    },
  });
  const rows = await Promise.all(obligations.map(async (obligation) => {
    const projectionEntries = obligation.ledgerEntries.map(toLedgerProjectionEntry);
    return {
      ...obligation,
      ledgerEntries: obligation.ledgerEntries.map((entry) => ({
        ...entry,
        remainingRefundableKopecks: entry.type === "PAYMENT"
          ? remainingRefundableKopecks(projectionEntries, entry.id)
          : null,
      })),
      summary: await derivePaymentSummaryInTransaction(prisma, obligation.id),
    };
  }));
  const pendingApprovals = await prisma.paymentLedgerApproval.findMany({
    where: { organizationId: context.organizationId, decision: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      ledgerEntryId: true,
      policyVersion: true,
      requestReason: true,
      createdAt: true,
      requestedByMembershipId: true,
      ledgerEntry: {
        select: { type: true, direction: true, amountKopecks: true, currency: true, caseId: true, evidenceReference: true },
      },
    },
  });
  return { obligations: rows, pendingApprovals };
}

export type PaymentWebhookCommand = {
  organizationId: string;
  caseId: string;
  obligationId: string;
  payerPartyId: string;
  externalEventId: string;
  eventVersion: string;
  externalTransactionId: string;
  amountKopecks: number;
  currency: string;
  occurredAt: string;
  method: PaymentMethod;
  evidenceReference: string;
};

export async function processPaymentWebhook(
  provider: string,
  rawBody: string,
  signature: string,
  command: PaymentWebhookCommand,
): Promise<CommandResult<{ receiptId: string; ledgerEntryId: string }>> {
  verifyWebhookSignature(provider, rawBody, signature);
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  if (!Number.isSafeInteger(command.amountKopecks) || command.amountKopecks <= 0) {
    throw new OperationalCommandError(422, "Некорректная сумма webhook");
  }
  try {
    return await runOperationalTransaction(async (tx) => {
      const existing = await tx.paymentWebhookReceipt.findUnique({
        where: {
          organizationId_provider_externalEventId: {
            organizationId: command.organizationId,
            provider,
            externalEventId: command.externalEventId,
          },
        },
      });
      if (existing) return validateWebhookReplay(existing, payloadHash);

      const obligation = await loadObligation(tx, command.organizationId, command.obligationId);
      if (
        obligation.caseId !== command.caseId
        || obligation.currency !== command.currency
        || obligation.payerPartyId !== command.payerPartyId
      ) {
        throw new OperationalCommandError(404, "Webhook obligation не найдена");
      }
      const occurredAt = new Date(command.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) throw new OperationalCommandError(422, "Некорректное время webhook");
      const duplicateTransaction = await tx.paymentLedgerEntry.findFirst({
        where: {
          organizationId: command.organizationId,
          source: `webhook:${provider}`,
          externalTransactionId: command.externalTransactionId,
        },
        select: { id: true, idempotencyKey: true },
      });
      if (duplicateTransaction) {
        throw new OperationalCommandError(409, "Webhook transaction уже зарегистрирована другим событием");
      }
      const receipt = await tx.paymentWebhookReceipt.create({
        data: {
          organizationId: command.organizationId,
          caseId: command.caseId,
          provider,
          externalEventId: command.externalEventId,
          eventVersion: command.eventVersion,
          payloadHash,
          signatureVerified: true,
        },
        select: { id: true },
      });
      const webhookIdempotencyKey = `webhook:${provider}:${command.externalEventId}`;
      await authorizeLedgerInsert(tx, { organizationId: command.organizationId }, {
        organizationId: command.organizationId,
        caseId: command.caseId,
        obligationId: command.obligationId,
        payerPartyId: command.payerPartyId,
        type: "PAYMENT",
        direction: "CREDIT",
        amountKopecks: command.amountKopecks,
        currency: command.currency,
        source: `webhook:${provider}`,
        relatedEntryId: null,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey: webhookIdempotencyKey,
      }, {
        idempotencyKey: webhookIdempotencyKey,
        correlationId: command.externalEventId,
        reason: "Verified payment provider webhook",
      }, "payment-provider");
      const entry = await tx.paymentLedgerEntry.create({
        data: {
          organizationId: command.organizationId,
          caseId: command.caseId,
          obligationId: command.obligationId,
          payerPartyId: command.payerPartyId,
          type: "PAYMENT",
          direction: "CREDIT",
          amountKopecks: command.amountKopecks,
          currency: command.currency,
          occurredAt,
          method: command.method,
          source: `webhook:${provider}`,
          externalTransactionId: command.externalTransactionId,
          evidenceReference: command.evidenceReference,
          actorType: "payment-provider",
          idempotencyKey: webhookIdempotencyKey,
          correlationId: command.externalEventId,
        },
        select: { id: true },
      });
      await tx.paymentWebhookReceipt.update({
        where: { id: receipt.id },
        data: { ledgerEntryId: entry.id },
      });
      await appendOperationalAudit(tx, { organizationId: command.organizationId }, {
        entityType: "payment_ledger_entry",
        entityId: entry.id,
        action: "ledger.webhook_payment_appended.v1",
        before: prismaJson({}),
        after: prismaJson({
          provider,
          externalEventId: command.externalEventId,
          eventVersion: command.eventVersion,
          amountKopecks: command.amountKopecks,
          currency: command.currency,
        }),
        correlationId: command.externalEventId,
        idempotencyKey: `webhook-audit:${provider}:${command.externalEventId}`,
        actorType: "payment-provider",
        result: prismaJson({ receiptId: receipt.id, ledgerEntryId: entry.id }),
      });
      const owner = await tx.case.findFirst({
        where: { id: command.caseId, tenantId: command.organizationId },
        select: {
          ownerId: true,
          owner: { select: { membership: { select: { id: true } } } },
        },
      });
      if (!owner?.owner.membership) {
        throw new OperationalCommandError(409, "У кейса нет владельца для канонического перехода");
      }
      await advanceCaseFulfilmentInTransaction(tx, {
        organizationId: command.organizationId,
        caseId: command.caseId,
        actorAgentId: owner.ownerId,
        actorMembershipId: owner.owner.membership.id,
        actorType: "payment-provider",
        idempotencyKey: `webhook:${provider}:${command.externalEventId}`,
        correlationId: command.externalEventId,
        causationId: entry.id,
      });
      return { receiptId: receipt.id, ledgerEntryId: entry.id, replayed: false };
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.paymentWebhookReceipt.findUnique({
      where: {
        organizationId_provider_externalEventId: {
          organizationId: command.organizationId,
          provider,
          externalEventId: command.externalEventId,
        },
      },
    });
    if (!existing) {
      throw new OperationalCommandError(409, "Webhook transaction уже зарегистрирована другим событием");
    }
    return validateWebhookReplay(existing, payloadHash);
  }
}

function validateWebhookReplay(
  receipt: { id: string; payloadHash: string; ledgerEntryId: string | null },
  payloadHash: string,
): CommandResult<{ receiptId: string; ledgerEntryId: string }> {
  if (receipt.payloadHash !== payloadHash || !receipt.ledgerEntryId) {
    throw new OperationalCommandError(409, "Webhook event ID уже использован другим payload");
  }
  return { receiptId: receipt.id, ledgerEntryId: receipt.ledgerEntryId, replayed: true };
}

async function derivePaymentSummaryInTransaction(
  tx: Prisma.TransactionClient | typeof prisma,
  obligationId: string,
): Promise<LedgerSummary> {
  const obligation = await tx.paymentObligation.findUnique({
    where: { id: obligationId },
    select: {
      currency: true,
      ledgerEntries: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          type: true,
          direction: true,
          amountKopecks: true,
          relatedEntryId: true,
          approvalRequired: true,
          approval: { select: { decision: true } },
        },
      },
    },
  });
  if (!obligation) throw new OperationalCommandError(404, "Обязательство не найдено");
  return deriveLedgerSummary(obligation.ledgerEntries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    direction: entry.direction,
    amountKopecks: entry.amountKopecks,
    relatedEntryId: entry.relatedEntryId,
    effective: !entry.approvalRequired || entry.approval?.decision === "APPROVED",
    reserved: entry.approvalRequired && entry.approval?.decision == null,
  })), obligation.currency);
}

async function authorizeLedgerInsert(
  tx: Prisma.TransactionClient,
  actor: { organizationId: string; membershipId?: string | null },
  command: LedgerInsertAuthorization,
  meta: M3CommandMeta,
  actorType = "member",
): Promise<void> {
  await appendOperationalAudit(tx, actor, {
    entityType: "payment_obligation",
    entityId: command.obligationId,
    action: "m3.ledger_insert_authorized.v1",
    before: prismaJson({}),
    after: prismaJson(command),
    correlationId: meta.correlationId,
    causationId: meta.idempotencyKey,
    idempotencyKey: `${meta.idempotencyKey}:db-auth:ledger`,
    reason: meta.reason,
    actorType,
    result: prismaJson({ authorized: true }),
  });
}

async function lockContract(tx: Prisma.TransactionClient, contractId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Contract" WHERE "id" = ${contractId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new OperationalCommandError(404, "Договор не найден");
}

async function authorizeContractTransition(
  tx: Prisma.TransactionClient,
  context: OperationalContext,
  meta: M3CommandMeta,
  transition: {
    entityId: string;
    command: "issue" | "sign" | "supersede";
    fromStatus: string;
    toStatus: string;
  },
): Promise<void> {
  await appendOperationalAudit(tx, context, {
    entityType: "contract_version",
    entityId: transition.entityId,
    action: "m3.lifecycle_transition_authorized.v1",
    before: prismaJson({ status: transition.fromStatus }),
    after: prismaJson({ command: transition.command, status: transition.toStatus }),
    correlationId: meta.correlationId,
    causationId: meta.idempotencyKey,
    idempotencyKey: `${meta.idempotencyKey}:db-auth:contract:${transition.entityId}:${transition.command}`,
    reason: meta.reason,
    result: prismaJson({ authorized: true }),
  });
}

async function assertSourceCapacity(
  tx: Prisma.TransactionClient,
  obligationId: string,
  candidate?: LedgerProjectionEntry,
): Promise<void> {
  const entries = await tx.paymentLedgerEntry.findMany({
    where: { obligationId },
    select: {
      id: true,
      type: true,
      direction: true,
      amountKopecks: true,
      relatedEntryId: true,
      approvalRequired: true,
      approval: { select: { decision: true } },
    },
  });
  const projectionEntries = entries.map(toLedgerProjectionEntry);
  if (candidate) projectionEntries.push(candidate);
  try {
    assertLedgerAdjustmentForestCapacity(projectionEntries);
  } catch {
    throw new OperationalCommandError(422, "Коррекция превышает остаток исходной записи ledger");
  }
}

async function lockObligationLedger(
  tx: Prisma.TransactionClient,
  organizationId: string,
  obligationId: string,
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:${obligationId}`}, 0)) IS NULL AS "locked"
  `;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "PaymentLedgerEntry"
    WHERE "organizationId" = ${organizationId} AND "obligationId" = ${obligationId}
    ORDER BY "id"
    FOR UPDATE
  `;
  if (rows.length === 0) throw new OperationalCommandError(404, "Ledger обязательства не найден");
}

function toLedgerProjectionEntry(entry: {
  id: string;
  type: PaymentLedgerEntryType;
  direction: LedgerDirection;
  amountKopecks: number;
  relatedEntryId: string | null;
  approvalRequired: boolean;
  approval: { decision: string | null } | null;
}): LedgerProjectionEntry {
  return {
    id: entry.id,
    type: entry.type,
    direction: entry.direction,
    amountKopecks: entry.amountKopecks,
    relatedEntryId: entry.relatedEntryId,
    effective: !entry.approvalRequired || entry.approval?.decision === "APPROVED",
    reserved: entry.approvalRequired && entry.approval?.decision == null,
  };
}

async function loadObligation(tx: Prisma.TransactionClient, organizationId: string, obligationId: string) {
  const obligation = await tx.paymentObligation.findFirst({
    where: { id: obligationId, organizationId },
    select: { id: true, caseId: true, currency: true, payerPartyId: true },
  });
  if (!obligation) throw new OperationalCommandError(404, "Обязательство не найдено");
  return obligation;
}

async function readAuditReplay<T>(
  tx: Prisma.TransactionClient,
  organizationId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<T | null> {
  const replay = await findOperationalReplay(tx, organizationId, idempotencyKey);
  return replay ? readReplayResult<T>(replay.result, fingerprint) : null;
}

function replayEnvelope(fingerprint: string, data: unknown): Prisma.InputJsonValue {
  return prismaJson({ commandFingerprint: fingerprint, data });
}

async function appendLedgerAudit(
  tx: Prisma.TransactionClient,
  context: OperationalContext,
  entryId: string,
  action: string,
  input: object,
  meta: M3CommandMeta,
  fingerprint: string,
  data: unknown,
) {
  const safeInput = { ...input } as Record<string, unknown>;
  delete safeInput.reason;
  return appendOperationalAudit(tx, context, {
    entityType: "payment_ledger_entry",
    entityId: entryId,
    action,
    before: prismaJson({}),
    after: prismaJson(safeInput),
    correlationId: meta.correlationId,
    idempotencyKey: meta.idempotencyKey,
    reason: "reason" in input ? String((input as { reason?: string }).reason ?? "") : meta.reason,
    result: replayEnvelope(fingerprint, data),
  });
}

function validateLedgerInput(amountKopecks: number, currency: string, evidenceReference: string, reason: string) {
  if (!Number.isSafeInteger(amountKopecks) || amountKopecks <= 0) {
    throw new OperationalCommandError(422, "Сумма должна быть положительным целым числом копеек");
  }
  if (currency !== "RUB") throw new OperationalCommandError(422, "В пилоте поддерживается только RUB");
  if (evidenceReference.trim().length < 3 || reason.trim().length < 3) {
    throw new OperationalCommandError(422, "Нужны источник подтверждения и причина");
  }
}

function verifyWebhookSignature(provider: string, rawBody: string, signature: string) {
  const secret = process.env.M3_PAYMENT_WEBHOOK_SECRET;
  if (!secret) throw new OperationalCommandError(422, "Webhook provider не настроен");
  const expected = createHmac("sha256", secret).update(`${provider}.${rawBody}`).digest("hex");
  const received = signature.replace(/^sha256=/, "");
  const left = Buffer.from(expected, "hex");
  const right = /^[a-f0-9]{64}$/i.test(received) ? Buffer.from(received, "hex") : Buffer.alloc(0);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new OperationalCommandError(403, "Webhook signature invalid");
  }
}

export function ledgerEntryIsImmutableShape(input: {
  type: PaymentLedgerEntryType;
  direction: LedgerDirection;
  amountKopecks: number;
}) {
  return input.amountKopecks > 0
    && (input.type !== "OBLIGATION" || input.direction === "DEBIT")
    && (input.type !== "PAYMENT" || input.direction === "CREDIT");
}

function jsonStringList(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
