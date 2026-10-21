import { createHash, randomUUID } from "node:crypto";
import type { DocumentAccessAction, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptField } from "@/lib/crypto";
import { getDocumentScanner, scanDocumentFailClosed, type DocumentScanner } from "@/lib/documentScanner";
import { evaluateDocumentRequirement } from "@/lib/m3Domain";
import { serverCommandKey } from "@/lib/commandNamespace";
import { getDocumentStorage, type DocumentStorage, type PrivateDocumentRead } from "@/lib/documentStorage";
import { appendOperationalAudit, findOperationalReplay } from "@/lib/operationalAudit";
import { assertCapability, type OperationalContext } from "@/lib/operationalAuth";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import { runM3ProductionTransaction, verifyM3ProductionDocumentPreflight } from "@/lib/m3ProductionActivation";
import {
  commandFingerprint,
  prismaJson,
  readReplayResult,
  requireTenantCase,
  type M3CommandMeta,
  validateM3CommandMeta,
} from "@/lib/m3Command";
import { advanceCaseFulfilment } from "@/lib/caseFulfilment";
import { refreshCaseRequirementApplicabilityInTransaction } from "@/lib/documentRequirementService";

const MAX_ABSOLUTE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
]);

export type UploadedDocumentResult = {
  documentId: string;
  versionId: string;
  versionNumber: number;
  status: "UPLOADED" | "QUARANTINED";
  scanStatus: "CLEAN" | "INFECTED" | "ERROR";
  replayed: boolean;
};

export async function uploadCaseDocument(
  context: OperationalContext,
  input: { caseId: string; requirementId: string; documentTypeCode: string; file: File; source?: string },
  meta: M3CommandMeta,
  dependencies: { storage?: DocumentStorage; scanner?: DocumentScanner; retryOfVersionId?: string } = {},
): Promise<UploadedDocumentResult> {
  assertCapability(context, "documents:upload");
  validateM3CommandMeta(meta);
  validateFile(input.file);
  const scanner = dependencies.scanner ?? getDocumentScanner();
  assertDocumentScannerOperational(scanner);
  await verifyM3ProductionDocumentPreflight(context.organizationId);

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  validateDocumentBody(bytes, input.file.type);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const fingerprint = dependencies.retryOfVersionId
    ? commandFingerprint({ command: "retry-document-scan", caseId: input.caseId, versionId: dependencies.retryOfVersionId })
    : commandFingerprint({
    caseId: input.caseId,
    requirementId: input.requirementId,
    documentTypeCode: input.documentTypeCode,
    checksum,
    size: input.file.size,
    mimeType: input.file.type,
  });
  const replay = await findReplay(context.organizationId, meta.idempotencyKey, fingerprint);
  if (replay) return { ...replay, replayed: true };

  const prerequisite = await loadUploadPrerequisite(context, input);
  const storage = dependencies.storage ?? getDocumentStorage();
  if (!storage.isConfigured()) {
    throw new OperationalCommandError(422, "Приватное хранилище документов не настроено", "PRIVATE_STORAGE_UNAVAILABLE");
  }
  const storageKey = buildOpaqueStorageKey(context.organizationId, input.caseId, input.file.type);
  const stored = await storage.putPrivate(storageKey, input.file);
  const scan = await scanDocumentFailClosed(scanner, { storageKey: stored.storageKey, bytes, checksum, mimeType: input.file.type });
  const status = scan.status === "CLEAN" ? "UPLOADED" : "QUARANTINED";

  try {
    const committed = await runM3ProductionTransaction(context.organizationId, async (tx) => {
      const concurrentReplay = await findOperationalReplay(tx, context.organizationId, meta.idempotencyKey);
      if (concurrentReplay) {
        const data = readReplayResult<Omit<UploadedDocumentResult, "replayed">>(concurrentReplay.result, fingerprint);
        if (!data) throw new OperationalCommandError(409, "Повтор загрузки не содержит сохранённого результата");
        return { ...data, replayed: true };
      }

      // Match scenario correction's lock order: case first, then policy/requirements.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Case" WHERE id = ${input.caseId} AND "tenantId" = ${context.organizationId} FOR UPDATE
      `;
      if (!locked.length) throw new OperationalCommandError(404, "Кейс не найден");
      await requireTenantCase(tx, context, input.caseId, { requireOwnerForAgent: true });
      const retryVersion = dependencies.retryOfVersionId
        ? await requireRetryableVersion(tx, context, input.caseId, dependencies.retryOfVersionId) : null;
      await refreshCaseRequirementApplicabilityInTransaction(tx, context, input.caseId, meta);
      const requirement = await tx.caseDocumentRequirement.findFirst({
        where: {
          id: input.requirementId,
          caseId: input.caseId,
          organizationId: context.organizationId,
          supersededAt: null,
        },
        select: { id: true, isApplicable: true, acceptedDocumentTypeCodes: true, acceptedDocumentTypeVersionIds: true },
      });
      if (!requirement) throw new OperationalCommandError(404, "Требование документа не найдено");
      if (!requirement.isApplicable) {
        throw new OperationalCommandError(409, "Требование документа больше не применимо к текущим данным кейса");
      }
      if (!stringList(requirement.acceptedDocumentTypeCodes).includes(input.documentTypeCode)
        || !stringList(requirement.acceptedDocumentTypeVersionIds).includes(prerequisite.documentTypeId)) {
        throw new OperationalCommandError(409, "Политика требования изменилась во время загрузки", "DOCUMENT_UPLOAD_POLICY_CHANGED");
      }
      const currentType = await tx.documentTypeDefinition.findFirst({
        where: { id: prerequisite.documentTypeId, version: prerequisite.documentTypeVersion,
          organizationId: context.organizationId, code: input.documentTypeCode, status: { in: ["APPROVED", "RETIRED"] } },
        select: { allowedMimeTypes: true, maxBytes: true },
      });
      if (!currentType || !stringList(currentType.allowedMimeTypes).includes(input.file.type) || input.file.size > currentType.maxBytes) {
        throw new OperationalCommandError(409, "Политика типа документа изменилась во время загрузки", "DOCUMENT_UPLOAD_POLICY_CHANGED");
      }

      const document = await tx.caseDocument.upsert({
        where: { requirementId: prerequisite.requirementId },
        update: { documentTypeId: prerequisite.documentTypeId },
        create: {
          organizationId: context.organizationId,
          caseId: input.caseId,
          requirementId: prerequisite.requirementId,
          documentTypeId: prerequisite.documentTypeId,
          status,
        },
        select: { id: true },
      });
      const previous = await tx.caseDocumentVersion.findFirst({
        where: { documentId: document.id },
        orderBy: { versionNumber: "desc" },
        select: { id: true, versionNumber: true, status: true },
      });
      const version = await tx.caseDocumentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: (previous?.versionNumber ?? 0) + 1,
          organizationId: context.organizationId,
          caseId: input.caseId,
          requirementId: prerequisite.requirementId,
          fileChecksum: checksum,
          storageKey: stored.storageKey,
          storageEtag: stored.etag,
          originalFilenameEncrypted: encryptField(sanitizeFilename(input.file.name)),
          mimeType: input.file.type,
          size: input.file.size,
          uploaderMembershipId: retryVersion?.uploaderMembershipId ?? context.membershipId,
          source: input.source?.trim() || "agent-upload",
          status,
          scanStatus: scan.status,
          scanProvider: scan.provider,
          scanResultCode: scan.resultCode,
          supersedesVersionId: previous?.id ?? null,
        },
        select: { id: true, versionNumber: true },
      });
      await refreshDocumentTruth(tx, document.id, prerequisite.requirementId);
      const data = {
        documentId: document.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        status,
        scanStatus: scan.status,
      } satisfies Omit<UploadedDocumentResult, "replayed">;
      await appendOperationalAudit(tx, context, {
        entityType: "document_version",
        entityId: version.id,
        action: "document.version_uploaded.v1",
        before: prismaJson(previous ? { previousVersionId: previous.id, previousStatus: previous.status } : {}),
        after: prismaJson({
          versionNumber: version.versionNumber,
          documentTypeCode: input.documentTypeCode,
          size: input.file.size,
          mimeType: input.file.type,
          checksum,
          status,
          scanStatus: scan.status,
          retryOfVersionId: dependencies.retryOfVersionId ?? null,
        }),
        correlationId: meta.correlationId,
        causationId: meta.idempotencyKey,
        idempotencyKey: meta.idempotencyKey,
        reason: meta.reason,
        result: prismaJson({ commandFingerprint: fingerprint, data }),
      });
      return { ...data, replayed: false };
    });
    if (committed.replayed) {
      await discardUncommittedOrFail(storage, stored.storageKey);
    }
    return committed;
  } catch (error) {
    let cleanupError: OperationalCommandError | null = null;
    try {
      await discardUncommittedOrFail(storage, stored.storageKey);
    } catch (cause) {
      cleanupError = cause as OperationalCommandError;
    }
    const raced = await findReplay(context.organizationId, meta.idempotencyKey, fingerprint);
    if (cleanupError) throw cleanupError;
    if (raced) return { ...raced, replayed: true };
    throw error;
  }
}

export async function beginDocumentReview(
  context: OperationalContext,
  versionId: string,
  meta: M3CommandMeta,
) {
  assertCapability(context, "documents:review");
  validateM3CommandMeta(meta);
  const fingerprint = commandFingerprint({ command: "begin-document-review", versionId });
  return runM3ProductionTransaction(context.organizationId, async (tx) => {
    const version = await tx.caseDocumentVersion.findFirst({
      where: { id: versionId, organizationId: context.organizationId },
      select: { id: true, status: true, scanStatus: true, documentId: true, assignedReviewerMembershipId: true, uploader: { select: { userId: true } } },
    });
    if (!version) throw new OperationalCommandError(404, "Версия документа не найдена");
    assertIndependentDocumentReviewer(context.userId, version.uploader.userId);
    const replay = await findOperationalReplay(tx, context.organizationId, meta.idempotencyKey);
    if (replay) {
      if (version.assignedReviewerMembershipId !== context.membershipId) throw new OperationalCommandError(404, "Назначенная проверка не найдена");
      const data = readReplayResult<{ versionId: string }>(replay.result, fingerprint);
      if (!data) throw new OperationalCommandError(409, "Idempotency result проверки повреждён");
      return { ...data, replayed: true };
    }
    if (version.scanStatus !== "CLEAN" || version.status !== "UPLOADED") {
      throw new OperationalCommandError(409, "В проверку можно взять только чистую загруженную версию");
    }
    await authorizeDocumentTransition(tx, context, meta, {
      entityId: version.id,
      command: "begin-review",
      fromStatus: "UPLOADED",
      toStatus: "IN_REVIEW",
    });
    const claimed = await tx.caseDocumentVersion.updateMany({
      where: {
        id: version.id,
        organizationId: context.organizationId,
        status: "UPLOADED",
        assignedReviewerMembershipId: null,
      },
      data: { status: "IN_REVIEW", assignedReviewerMembershipId: context.membershipId },
    });
    if (claimed.count !== 1) throw new OperationalCommandError(409, "Документ уже взят другим проверяющим");
    await refreshDocumentTruth(tx, version.documentId);
    await appendOperationalAudit(tx, context, {
      entityType: "document_version",
      entityId: version.id,
      action: "document.review_started.v1",
      before: prismaJson({ status: version.status }),
      after: prismaJson({ status: "IN_REVIEW", assignedReviewerMembershipId: context.membershipId }),
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
      reason: meta.reason,
      result: prismaJson({ commandFingerprint: fingerprint, data: { versionId: version.id } }),
    });
    return { versionId: version.id, replayed: false };
  });
}

export async function decideDocumentReview(
  context: OperationalContext,
  versionId: string,
  input: {
    decision: "VERIFIED" | "REJECTED";
    checklist: Record<string, boolean>;
    reason?: string | null;
    expiresAt?: Date | null;
  },
  meta: M3CommandMeta,
  storage: DocumentStorage = getDocumentStorage(),
) {
  assertCapability(context, "documents:review");
  validateM3CommandMeta(meta);
  validateDocumentExpiryFormat(input.expiresAt);
  if (input.decision === "REJECTED" && (!input.reason || input.reason.trim().length < 3)) {
    throw new OperationalCommandError(422, "Для отклонения нужна причина");
  }
  const fingerprint = commandFingerprint({
    versionId,
    decision: input.decision,
    checklist: input.checklist,
    reason: input.reason?.trim() ?? null,
    expiresAt: input.expiresAt?.toISOString() ?? null,
  });
  const reviewIdentity = await prisma.caseDocumentVersion.findFirst({
    where: { id: versionId, organizationId: context.organizationId, assignedReviewerMembershipId: context.membershipId },
    select: { uploader: { select: { userId: true } } },
  });
  if (!reviewIdentity) throw new OperationalCommandError(404, "Назначенная проверка не найдена");
  assertIndependentDocumentReviewer(context.userId, reviewIdentity.uploader.userId);
  const existingReplay = await prisma.operationalAuditEvent.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: context.organizationId,
        idempotencyKey: meta.idempotencyKey,
      },
    },
    select: { result: true },
  });
  if (existingReplay) {
    const data = readReplayResult<{ versionId: string; decision: "VERIFIED" | "REJECTED" }>(
      existingReplay.result,
      fingerprint,
    );
    if (!data) throw new OperationalCommandError(409, "Idempotency result решения повреждён");
    if (data.decision === "VERIFIED") {
      await advanceVerifiedDocumentCaseAfterCommit(context, data.versionId, meta);
    }
    return { ...data, replayed: true };
  }

  validateDocumentExpiry(input.expiresAt);
  let verifiedStorageIdentity: DocumentIntegrityMetadata | null = null;
  if (input.decision === "VERIFIED") {
    const candidate = await prisma.caseDocumentVersion.findFirst({
      where: {
        id: versionId,
        organizationId: context.organizationId,
        assignedReviewerMembershipId: context.membershipId,
      },
      select: { ...DOCUMENT_INTEGRITY_SELECT, uploader: { select: { userId: true } } },
    });
    if (candidate) assertIndependentDocumentReviewer(context.userId, candidate.uploader.userId);
    verifiedStorageIdentity = candidate;
    if (!verifiedStorageIdentity) throw new OperationalCommandError(404, "Версия документа не найдена");
    if (verifiedStorageIdentity.status !== "IN_REVIEW" || verifiedStorageIdentity.scanStatus !== "CLEAN") {
      throw new OperationalCommandError(409, "Версия не готова к решению проверяющего");
    }
    await readVerifiedStorageObject(storage, verifiedStorageIdentity);
  }

  const committed = await runM3ProductionTransaction(context.organizationId, async (tx) => {
    const replay = await findOperationalReplay(tx, context.organizationId, meta.idempotencyKey);
    if (replay) {
      const data = readReplayResult<{ versionId: string; decision: "VERIFIED" | "REJECTED" }>(replay.result, fingerprint);
      if (!data) throw new OperationalCommandError(409, "Idempotency result решения повреждён");
      return { ...data, replayed: true };
    }
    const version = await tx.caseDocumentVersion.findFirst({
      where: {
        id: versionId,
        organizationId: context.organizationId,
        assignedReviewerMembershipId: context.membershipId,
      },
      include: {
        uploader: { select: { userId: true } },
        requirement: { select: { reviewChecklist: true } },
        case: { select: { leadId: true, ownerId: true } },
      },
    });
    if (!version) throw new OperationalCommandError(404, "Версия документа не найдена");
    assertIndependentDocumentReviewer(context.userId, version.uploader.userId);
    if (version.status !== "IN_REVIEW" || version.scanStatus !== "CLEAN") {
      throw new OperationalCommandError(409, "Версия не готова к решению проверяющего");
    }
    await authorizeDocumentTransition(tx, context, meta, {
      entityId: version.id,
      command: "review-decision",
      fromStatus: "IN_REVIEW",
      toStatus: input.decision,
    });
    if (input.decision === "VERIFIED") {
      validateDocumentExpiry(input.expiresAt);
      const newerVerified = await tx.caseDocumentVersion.findFirst({
        where: { documentId: version.documentId, versionNumber: { gt: version.versionNumber }, status: "VERIFIED" },
        select: { id: true },
      });
      if (newerVerified) throw new OperationalCommandError(409, "Более новая версия уже проверена");
      if (!verifiedStorageIdentity || !sameStorageIdentity(version, verifiedStorageIdentity)) {
        throw new OperationalCommandError(409, "Файловая версия изменилась во время проверки", "DOCUMENT_INTEGRITY_MISMATCH");
      }
      const requiredChecks = stringList(version.requirement?.reviewChecklist);
      if (requiredChecks.some((key) => input.checklist[key] !== true)) {
        throw new OperationalCommandError(422, "Заполните обязательный checklist проверки");
      }
      await tx.caseDocumentVersion.update({
        where: { id: version.id },
        data: {
          status: "VERIFIED",
          reviewedByMembershipId: context.membershipId,
          reviewedAt: new Date(),
          reviewChecklist: prismaJson(input.checklist),
          rejectionReason: null,
          expiresAt: input.expiresAt ?? null,
        },
      });
      const predecessors = await tx.caseDocumentVersion.findMany({
        where: { documentId: version.documentId, versionNumber: { lt: version.versionNumber }, status: { not: "SUPERSEDED" } },
        select: { id: true, status: true },
      });
      for (const previous of predecessors) {
        await authorizeDocumentTransition(tx, context, meta, {
          entityId: previous.id, command: "supersede", fromStatus: previous.status, toStatus: "SUPERSEDED",
        });
        await tx.caseDocumentVersion.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
        await appendOperationalAudit(tx, context, {
          entityType: "document_version", entityId: previous.id, action: "document.version_superseded.v1",
          before: prismaJson({ status: previous.status }),
          after: prismaJson({ status: "SUPERSEDED", supersededByVersionId: version.id }),
          correlationId: meta.correlationId, causationId: version.id,
          idempotencyKey: serverCommandKey("document-supersede", `${meta.idempotencyKey}:${previous.id}`), reason: meta.reason,
          result: prismaJson({ supersededVersionId: previous.id, supersededByVersionId: version.id }),
        });
      }
      await tx.caseDocument.update({ where: { id: version.documentId }, data: { status: "VERIFIED" } });
      if (version.requirementId) {
        await tx.caseDocumentRequirement.update({
          where: { id: version.requirementId },
          data: { satisfactionStatus: "SATISFIED", satisfiedByVersionId: version.id },
        });
      }
    } else {
      await tx.caseDocumentVersion.update({
        where: { id: version.id },
        data: {
          status: "REJECTED",
          reviewedByMembershipId: context.membershipId,
          reviewedAt: new Date(),
          reviewChecklist: prismaJson(input.checklist),
          rejectionReason: input.reason!.trim(),
        },
      });
      await refreshDocumentTruth(tx, version.documentId, version.requirementId);
      const owner = await tx.membership.findFirst({
        where: { organizationId: context.organizationId, agentId: version.case.ownerId, status: "ACTIVE" },
        select: { id: true },
      });
      await tx.task.upsert({
        where: {
          organizationId_idempotencyKey: {
            organizationId: context.organizationId,
            idempotencyKey: `document-rejection:${version.id}`,
          },
        },
        update: {},
        create: {
          leadId: version.case.leadId,
          agentId: version.case.ownerId,
          organizationId: context.organizationId,
          caseId: version.caseId,
          assigneeMembershipId: owner?.id ?? null,
          createdByMembershipId: context.membershipId,
          type: "PREPARATION",
          priority: "HIGH",
          status: "OPEN",
          sourceEventId: `document-rejected:${version.id}`,
          expectedOutcome: "Загрузить исправленную версию и передать на повторную проверку",
          waitingReason: input.reason!.trim(),
          idempotencyKey: `document-rejection:${version.id}`,
          title: "Исправить отклонённый документ",
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    }

    await appendOperationalAudit(tx, context, {
      entityType: "document_version",
      entityId: version.id,
      action: input.decision === "VERIFIED" ? "document.verified.v1" : "document.rejected.v1",
      before: prismaJson({ status: version.status }),
      after: prismaJson({ status: input.decision, checklist: input.checklist, expiresAt: input.expiresAt ?? null }),
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
      reason: input.reason ?? meta.reason,
      result: prismaJson({
        commandFingerprint: fingerprint,
        data: { versionId: version.id, decision: input.decision },
      }),
    });
    return { versionId: version.id, decision: input.decision, replayed: false };
  });
  if (committed.decision === "VERIFIED") {
    await advanceVerifiedDocumentCaseAfterCommit(context, committed.versionId, meta);
  }
  return committed;
}

async function advanceVerifiedDocumentCaseAfterCommit(
  context: OperationalContext,
  versionId: string,
  meta: M3CommandMeta,
): Promise<void> {
  const version = await prisma.caseDocumentVersion.findFirst({
    where: { id: versionId, organizationId: context.organizationId },
    select: { caseId: true },
  });
  if (!version) throw new OperationalCommandError(404, "Версия документа не найдена для обновления кейса");
  await advanceCaseFulfilment({
    organizationId: context.organizationId,
    caseId: version.caseId,
    actorAgentId: context.agentId,
    actorMembershipId: context.membershipId,
    idempotencyKey: meta.idempotencyKey,
    correlationId: meta.correlationId,
    causationId: versionId,
  });
}

async function authorizeDocumentTransition(
  tx: Prisma.TransactionClient,
  context: OperationalContext,
  meta: M3CommandMeta,
  transition: {
    entityId: string;
    command: "supersede" | "begin-review" | "review-decision";
    fromStatus: string;
    toStatus: string;
  },
): Promise<void> {
  await appendOperationalAudit(tx, context, {
    entityType: "document_version",
    entityId: transition.entityId,
    action: "m3.lifecycle_transition_authorized.v1",
    before: prismaJson({ status: transition.fromStatus }),
    after: prismaJson({ command: transition.command, status: transition.toStatus }),
    correlationId: meta.correlationId,
    causationId: meta.idempotencyKey,
    idempotencyKey: serverCommandKey("document-db-auth", `${meta.idempotencyKey}:${transition.entityId}:${transition.command}`),
    reason: meta.reason,
    result: prismaJson({ authorized: true }),
  });
}

export async function escalateDocumentReview(
  context: OperationalContext,
  versionId: string,
  reason: string,
  meta: M3CommandMeta,
) {
  assertCapability(context, "documents:review");
  validateM3CommandMeta(meta);
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3) throw new OperationalCommandError(422, "Нужна причина эскалации");
  const fingerprint = commandFingerprint({ command: "escalate-document-review", versionId, reason: normalizedReason });
  return runM3ProductionTransaction(context.organizationId, async (tx) => {
    const replay = await findOperationalReplay(tx, context.organizationId, meta.idempotencyKey);
    if (replay) {
      const data = readReplayResult<{ versionId: string; taskId: number }>(replay.result, fingerprint);
      if (!data) throw new OperationalCommandError(409, "Idempotency result эскалации повреждён");
      return { ...data, replayed: true };
    }
    const version = await tx.caseDocumentVersion.findFirst({
      where: {
        id: versionId,
        organizationId: context.organizationId,
        assignedReviewerMembershipId: context.membershipId,
        status: "IN_REVIEW",
      },
      select: {
        id: true,
        caseId: true,
        uploader: { select: { userId: true } },
        requirement: { select: { dueAt: true } },
        case: { select: { leadId: true, ownerId: true } },
      },
    });
    if (!version) throw new OperationalCommandError(404, "Назначенная проверка не найдена");
    assertIndependentDocumentReviewer(context.userId, version.uploader.userId);
    const owner = await tx.membership.findFirst({
      where: { organizationId: context.organizationId, agentId: version.case.ownerId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!owner) throw new OperationalCommandError(409, "У владельца кейса нет активного исполнителя", "DOCUMENT_ESCALATION_OWNER_REQUIRED");
    const taskKey = `document-review-escalation:${version.id}`;
    const priorTask = await tx.task.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: context.organizationId, idempotencyKey: taskKey } },
      select: { id: true, status: true, waitingReason: true, assigneeMembershipId: true, priority: true },
    });
    if (priorTask && priorTask.status !== "OPEN") {
      throw new OperationalCommandError(409, "Предыдущая задача эскалации закрыта; требуется отдельное решение", "DOCUMENT_ESCALATION_TASK_CLOSED");
    }
    const task = await tx.task.upsert({
      where: {
        organizationId_idempotencyKey: {
          organizationId: context.organizationId,
          idempotencyKey: `document-review-escalation:${version.id}`,
        },
      },
      update: {
        waitingReason: normalizedReason,
        priority: "HIGH",
        assigneeMembershipId: owner.id,
        agentId: version.case.ownerId,
      },
      create: {
        leadId: version.case.leadId,
        agentId: version.case.ownerId,
        organizationId: context.organizationId,
        caseId: version.caseId,
        assigneeMembershipId: owner.id,
        createdByMembershipId: context.membershipId,
        type: "PREPARATION",
        priority: "HIGH",
        status: "OPEN",
        sourceEventId: `document-review-escalation:${version.id}`,
        expectedOutcome: "Снять блокер проверки документа и зафиксировать безопасное следующее действие",
        waitingReason: normalizedReason,
        idempotencyKey: `document-review-escalation:${version.id}`,
        title: "Эскалация проверки документа",
        dueAt: version.requirement?.dueAt ?? null,
      },
      select: { id: true },
    });
    await appendOperationalAudit(tx, context, {
      entityType: "document_version",
      entityId: version.id,
      action: "document.review_escalated.v1",
      before: prismaJson({ status: "IN_REVIEW", task: priorTask }),
      after: prismaJson({ taskId: task.id, reason: normalizedReason, status: "OPEN", assigneeMembershipId: owner.id, priority: "HIGH" }),
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
      reason: normalizedReason,
      result: prismaJson({
        commandFingerprint: fingerprint,
        data: { versionId: version.id, taskId: task.id },
      }),
    });
    return { versionId: version.id, taskId: task.id, replayed: false };
  });
}

export async function listDocumentReviewQueue(context: OperationalContext) {
  assertCapability(context, "documents:review");
  const referenceTimeMs = Date.now();
  const queue = await prisma.caseDocumentVersion.findMany({
    where: {
      organizationId: context.organizationId, status: { in: ["UPLOADED", "IN_REVIEW"] }, scanStatus: "CLEAN",
      uploader: { userId: { not: context.userId } },
    },
    orderBy: [{ requirement: { dueAt: "asc" } }, { createdAt: "asc" }],
    select: {
      id: true,
      versionNumber: true,
      status: true,
      scanStatus: true,
      mimeType: true,
      size: true,
      createdAt: true,
      requirement: {
        select: {
          stableKey: true,
          dueAt: true,
          conditionExplanation: true,
          policy: { select: { scenario: true, version: true } },
          reviewChecklist: true,
        },
      },
      document: { select: { documentType: { select: { code: true, name: true, version: true } } } },
      assignedReviewerMembershipId: true,
      case: { select: { leadId: true, publicRef: true } },
    },
  });
  return queue.map((item) => ({
    ...item,
    overdue: item.requirement?.dueAt != null && item.requirement.dueAt.getTime() < referenceTimeMs,
  }));
}

export async function readAuthorizedDocument(
  context: OperationalContext,
  versionId: string,
  expectedCaseId: string,
  action: DocumentAccessAction,
  correlationId: string,
  storage: DocumentStorage = getDocumentStorage(),
): Promise<{ file: PrivateDocumentRead; mimeType: string; filename: string }> {
  assertCapability(context, "documents:access");
  if (!correlationId.trim()) throw new OperationalCommandError(400, "Нужен correlation ID");
  const purpose = context.role === "DOCUMENT_REVIEWER"
    ? "Проверка назначенной версии документа"
    : action === "DOWNLOAD"
      ? "Скачивание документа в рабочем пространстве кейса"
      : "Просмотр документа в рабочем пространстве кейса";
  const version = await prisma.caseDocumentVersion.findFirst({
    where: {
      id: versionId,
      caseId: expectedCaseId,
      organizationId: context.organizationId,
      scanStatus: "CLEAN",
      ...(context.role === "DOCUMENT_REVIEWER"
        ? { status: "IN_REVIEW", assignedReviewerMembershipId: context.membershipId }
        : { status: { in: ["UPLOADED", "IN_REVIEW", "VERIFIED", "REJECTED", "EXPIRED", "SUPERSEDED"] } }),
      ...(context.role === "AGENT" ? { case: { ownerId: context.agentId } } : {}),
    },
    select: DOCUMENT_INTEGRITY_SELECT,
  });
  if (!version) throw new OperationalCommandError(404, "Документ не найден");
  const verifiedFile = await readVerifiedStorageObject(storage, version);
  await prisma.$transaction(async (tx) => {
    await tx.documentAccessEvent.create({
      data: {
        organizationId: context.organizationId,
        caseId: version.caseId,
        documentVersionId: version.id,
        actorMembershipId: context.membershipId,
        action,
        purpose,
        correlationId,
      },
    });
    await appendOperationalAudit(tx, context, {
      entityType: "document_access",
      entityId: version.id,
      action: `document.${action.toLowerCase()}.v1`,
      before: prismaJson({}),
      after: prismaJson({ action, purpose }),
      correlationId,
      idempotencyKey: serverCommandKey("document-access", `${context.organizationId}:${context.membershipId}:${version.id}:${action}:${correlationId}`),
      result: prismaJson({ versionId: version.id }),
    });
  });
  return { file: verifiedFile, mimeType: version.mimeType, filename: `document-${version.id}` };
}

async function loadUploadPrerequisite(
  context: OperationalContext,
  input: { caseId: string; requirementId: string; documentTypeCode: string; file: File },
) {
  const record = await prisma.caseDocumentRequirement.findFirst({
    where: {
      id: input.requirementId,
      caseId: input.caseId,
      organizationId: context.organizationId,
      supersededAt: null,
      ...(context.role === "AGENT" ? { case: { ownerId: context.agentId } } : {}),
    },
    select: {
      id: true,
      acceptedDocumentTypeCodes: true,
      acceptedDocumentTypeVersionIds: true,
      isApplicable: true,
    },
  });
  if (!record) throw new OperationalCommandError(404, "Требование документа не найдено");
  if (!record.isApplicable) throw new OperationalCommandError(409, "Условное требование сейчас не применяется к кейсу");
  if (!stringList(record.acceptedDocumentTypeCodes).includes(input.documentTypeCode)) {
    throw new OperationalCommandError(422, "Тип документа не закрывает выбранное требование");
  }
  const documentType = await prisma.documentTypeDefinition.findFirst({
    where: {
      id: { in: stringList(record.acceptedDocumentTypeVersionIds) },
      organizationId: context.organizationId,
      code: input.documentTypeCode,
      status: { in: ["APPROVED", "RETIRED"] },
    },
  });
  if (!documentType) throw new OperationalCommandError(422, "Тип документа не утверждён");
  if (!stringList(documentType.allowedMimeTypes).includes(input.file.type) || input.file.size > documentType.maxBytes) {
    throw new OperationalCommandError(422, "Файл не соответствует политике типа документа");
  }
  return { requirementId: record.id, documentTypeId: documentType.id, documentTypeVersion: documentType.version };
}

async function discardUncommittedOrFail(storage: DocumentStorage, storageKey: string) {
  try {
    await storage.discardUncommitted(storageKey);
  } catch {
    throw new OperationalCommandError(
      503,
      "Не удалось безопасно удалить незавершённую загрузку; дальнейшие действия заблокированы",
      "ORPHAN_STORAGE_CLEANUP_FAILED",
    );
  }
}

async function findReplay(
  organizationId: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<Omit<UploadedDocumentResult, "replayed"> | null> {
  const replay = await prisma.operationalAuditEvent.findUnique({
    where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    select: { result: true },
  });
  return replay ? readReplayResult<Omit<UploadedDocumentResult, "replayed">>(replay.result, fingerprint) : null;
}

export function assertDocumentScannerOperational(scanner: DocumentScanner = getDocumentScanner()): void {
  let ready = false;
  try { ready = scanner.isOperational() === true; } catch { /* Readiness failures are unavailable, never a write permit. */ }
  if (!ready) {
    throw new OperationalCommandError(503, "Проверка безопасности документов недоступна", "DOCUMENT_SCANNER_UNAVAILABLE");
  }
}

export function assertIndependentDocumentReviewer(reviewerUserId: number, uploaderUserId: number): void {
  if (reviewerUserId === uploaderUserId) {
    throw new OperationalCommandError(403, "Нельзя проверять собственный документ", "DOCUMENT_SELF_REVIEW_FORBIDDEN");
  }
}

export function validateDocumentExpiry(expiresAt: Date | null | undefined): void {
  validateDocumentExpiryFormat(expiresAt);
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new OperationalCommandError(422, "Срок действия должен быть в будущем", "DOCUMENT_EXPIRY_INVALID");
  }
}

function validateDocumentExpiryFormat(expiresAt: Date | null | undefined): void {
  if (expiresAt && !Number.isFinite(expiresAt.getTime())) {
    throw new OperationalCommandError(422, "Некорректный срок действия", "DOCUMENT_EXPIRY_INVALID");
  }
}

// Signatures reject obvious MIME spoofing, not malware or malformed document internals.
export function validateDocumentBody(bytes: Uint8Array, mimeType: string): void {
  const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  const matches = mimeType === "application/pdf" ? ascii(0, 5) === "%PDF-"
    : mimeType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mimeType === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)
    : mimeType === "image/webp" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
    : mimeType === "image/heic" ? ascii(4, 8) === "ftyp" && ["heic", "heix", "hevc", "hevx"].includes(ascii(8, 12))
    : false;
  if (!matches) throw new OperationalCommandError(422, "Содержимое файла не соответствует MIME-типу", "DOCUMENT_MIME_MISMATCH");
}

export async function readBoundedDocumentMultipart(req: Request): Promise<FormData> {
  const limit = MAX_ABSOLUTE_BYTES + 256 * 1024;
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new OperationalCommandError(415, "Ожидается multipart/form-data");
  }
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    throw new OperationalCommandError(413, "Загрузка превышает допустимый размер");
  }
  if (!req.body) throw new OperationalCommandError(400, "Нет тела загрузки");
  const reader = req.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new OperationalCommandError(413, "Загрузка превышает допустимый размер");
      }
      chunks.push(Uint8Array.from(part.value).buffer);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(new Blob(chunks), { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new OperationalCommandError(400, "Некорректная multipart-загрузка");
  }
}

async function refreshDocumentTruth(tx: Prisma.TransactionClient, documentId: string, requirementId?: string | null) {
  const versions = await tx.caseDocumentVersion.findMany({
    where: { documentId }, orderBy: { versionNumber: "desc" },
    select: { id: true, versionNumber: true, status: true, scanStatus: true, expiresAt: true, requirementId: true },
  });
  const truth = evaluateDocumentRequirement(versions);
  const valid = truth.status === "SATISFIED"
    ? versions.find((v) => v.versionNumber === truth.verifiedVersionNumber) : null;
  await tx.caseDocument.update({ where: { id: documentId }, data: { status: valid ? "VERIFIED" : versions[0]?.status ?? "REQUIRED" } });
  const target = requirementId ?? versions[0]?.requirementId;
  if (target) await tx.caseDocumentRequirement.update({
    where: { id: target }, data: { satisfactionStatus: valid ? "SATISFIED" : "NOT_SATISFIED", satisfiedByVersionId: valid?.id ?? null },
  });
}

async function requireRetryableVersion(
  tx: Prisma.TransactionClient | typeof prisma, context: OperationalContext, caseId: string, versionId: string,
) {
  const version = await tx.caseDocumentVersion.findFirst({
    where: { id: versionId, caseId, organizationId: context.organizationId,
      ...(context.role === "AGENT" ? { case: { ownerId: context.agentId } } : {}) },
    select: { ...DOCUMENT_INTEGRITY_SELECT, documentId: true, requirementId: true, uploaderMembershipId: true,
      versionNumber: true, document: { select: { documentType: { select: { code: true } } } } },
  });
  if (!version) throw new OperationalCommandError(404, "Версия документа не найдена");
  if (version.status !== "QUARANTINED" || !["ERROR", "PENDING"].includes(version.scanStatus) || !version.requirementId) {
    throw new OperationalCommandError(409, "Повтор доступен только после ошибки сканирования", "DOCUMENT_RESCAN_NOT_RETRYABLE");
  }
  const newer = await tx.caseDocumentVersion.findFirst({ where: { documentId: version.documentId, versionNumber: { gt: version.versionNumber } }, select: { id: true } });
  if (newer) throw new OperationalCommandError(409, "У документа уже есть новая версия", "DOCUMENT_RESCAN_STALE");
  return version;
}

export async function retryDocumentScan(
  context: OperationalContext, caseId: string, versionId: string, meta: M3CommandMeta,
  dependencies: { storage?: DocumentStorage; scanner?: DocumentScanner } = {},
) {
  assertCapability(context, "documents:upload");
  validateM3CommandMeta(meta);
  await verifyM3ProductionDocumentPreflight(context.organizationId);
  await requireTenantCase(prisma, context, caseId, { requireOwnerForAgent: true });
  const fingerprint = commandFingerprint({ command: "retry-document-scan", caseId, versionId });
  const replay = await findReplay(context.organizationId, meta.idempotencyKey, fingerprint);
  if (replay) return { ...replay, replayed: true };
  assertDocumentScannerOperational(dependencies.scanner);
  const version = await requireRetryableVersion(prisma, context, caseId, versionId);
  const storage = dependencies.storage ?? getDocumentStorage();
  const file = await readVerifiedStorageObject(storage, version);
  const bytes = await new Response(file.stream).arrayBuffer();
  // A new immutable version preserves the failed attempt and the original uploader identity.
  return uploadCaseDocument(context, {
    caseId, requirementId: version.requirementId!, documentTypeCode: version.document.documentType.code,
    file: new File([bytes], "scan-retry", { type: version.mimeType }), source: "explicit-scan-retry",
  }, meta, { ...dependencies, storage, retryOfVersionId: versionId });
}

function validateFile(file: File): void {
  if (file.size <= 0) throw new OperationalCommandError(422, "Пустой файл");
  if (file.size > MAX_ABSOLUTE_BYTES) throw new OperationalCommandError(422, "Файл больше 10 МБ");
  if (!ALLOWED_MIME_TYPES.has(file.type)) throw new OperationalCommandError(422, "Недопустимый тип файла");
}

function sanitizeFilename(value: string): string {
  const withoutControls = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").trim();
  return withoutControls.slice(0, 180) || "document";
}

function buildOpaqueStorageKey(organizationId: string, caseId: string, mimeType: string): string {
  const tenant = createHash("sha256").update(organizationId).digest("hex").slice(0, 16);
  const caseRef = createHash("sha256").update(caseId).digest("hex").slice(0, 16);
  const extension = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin";
  return `m3-private/${tenant}/${caseRef}/${randomUUID()}.${extension}`;
}

function stringList(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const DOCUMENT_INTEGRITY_SELECT = {
  id: true,
  caseId: true,
  storageKey: true,
  storageEtag: true,
  mimeType: true,
  size: true,
  fileChecksum: true,
  status: true,
  scanStatus: true,
} satisfies Prisma.CaseDocumentVersionSelect;

type DocumentIntegrityMetadata = Prisma.CaseDocumentVersionGetPayload<{
  select: typeof DOCUMENT_INTEGRITY_SELECT;
}>;

function sameStorageIdentity(left: DocumentIntegrityMetadata, right: DocumentIntegrityMetadata): boolean {
  return left.id === right.id
    && left.caseId === right.caseId
    && left.storageKey === right.storageKey
    && left.storageEtag === right.storageEtag
    && left.mimeType === right.mimeType
    && left.size === right.size
    && left.fileChecksum === right.fileChecksum;
}

async function readVerifiedStorageObject(
  storage: DocumentStorage,
  version: DocumentIntegrityMetadata,
): Promise<PrivateDocumentRead> {
  if (!storage.isConfigured()) {
    throw new OperationalCommandError(503, "Приватное хранилище документов недоступно", "PRIVATE_STORAGE_UNAVAILABLE");
  }
  const file = await storage.readPrivate(version.storageKey);
  if (!file) {
    throw new OperationalCommandError(409, "Целостность файла не подтверждена", "DOCUMENT_INTEGRITY_MISMATCH");
  }
  const bytes = new Uint8Array(await new Response(file.stream).arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const contentTypeMatches = file.contentType === version.mimeType || file.contentType === "application/octet-stream";
  if (
    file.etag !== version.storageEtag
    || file.size !== version.size
    || bytes.byteLength !== version.size
    || checksum !== version.fileChecksum
    || !contentTypeMatches
  ) {
    throw new OperationalCommandError(409, "Целостность файла не подтверждена", "DOCUMENT_INTEGRITY_MISMATCH");
  }
  return {
    stream: new Blob([bytes], { type: version.mimeType }).stream(),
    contentType: version.mimeType,
    size: version.size,
    etag: file.etag,
  };
}
