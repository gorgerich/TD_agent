import { createHash, createHmac } from "node:crypto";
import { Prisma, type QuoteClientDecisionType } from "@prisma/client";
import { z } from "zod";
import {
  CommercialQuoteError,
  assertPublishable,
  calculateCommercialTotals,
  canonicalSnapshotJson,
  diffCommercialLines,
  isClientVisibleCommercialLine,
  quoteSnapshotChecksum,
  readPublishedQuoteSnapshot,
  settleCommercialLines,
  type CommercialLine,
  type CommercialLineSettlement,
  type CommercialScenario,
  type PublishedQuoteSnapshot,
} from "@/lib/commercialQuote";
import { transitionCaseInTransaction, type CaseCommandContext } from "@/lib/caseService";
import { appendOperationalAudit, findOperationalReplay } from "@/lib/operationalAudit";
import type { OperationalContext } from "@/lib/operationalAuth";
import { runOperationalTransaction, OperationalCommandError } from "@/lib/operationalTransaction";
import { prisma } from "@/lib/prisma";

/**
 * Commercial writes are the widest serializable transactions in the product: a single
 * command can touch Quote, QuoteVersion, QuoteLineItem, QuoteClientLink, Case, Task and
 * the shared operational audit log. That footprint makes P2034 serialization conflicts
 * measurably more likely here than for the narrower M1 commands, so these commands get a
 * higher bounded retry budget than the shared default.
 *
 * Retrying is safe by construction for every command below: each one runs entirely inside
 * the transaction, is fully rolled back before a retry, and is keyed by an idempotency
 * key that it re-checks on each attempt. Only P2034 is retried — see
 * runOperationalTransaction; every other error still surfaces on the first attempt.
 */
const COMMERCIAL_COMMAND_ATTEMPTS = 5;

type CommandMeta = {
  idempotencyKey: string;
  correlationId: string;
  reason?: string;
};

type DraftInput = {
  meetingId: number;
  scenario: CommercialScenario;
  lines: CommercialLine[];
  editorState?: Prisma.InputJsonValue;
  context: OperationalContext;
  meta: CommandMeta;
};

type PublishInput = {
  quoteId: number;
  validUntil: Date;
  channel: string;
  context: OperationalContext;
  meta: CommandMeta;
};

type DraftCommandResult = {
  quoteId: number;
  draftVersionId: number;
  status: string;
  totals: ReturnType<typeof calculateCommercialTotals>;
  replayed: boolean;
};

type ReviewCommandResult = {
  quoteId: number;
  draftVersionId: number;
  status: string;
  totals: ReturnType<typeof calculateCommercialTotals>;
  diff: ReturnType<typeof diffCommercialLines>;
  previousTotal: number | null;
  totalDelta: number | null;
};

type PublishCommandResult = {
  quoteId: number;
  quoteVersionId: number;
  versionNumber: number;
  status: string;
  total: number;
  snapshotChecksum: string;
  replayed: boolean;
};

type PresentationCommandResult = {
  presentationId: string;
  quoteId: number;
  expiresAt: string;
};

type DecisionCommandResult = {
  decisionId: string;
  type: QuoteClientDecisionType;
  replayed: boolean;
};

const CommercialTotalsReplaySchema = z.object({
  subtotal: z.number().int().nonnegative().safe(),
  discountTotal: z.number().int().nonnegative().safe(),
  total: z.number().int().nonnegative().safe().nullable(),
  totalState: z.enum(["KNOWN", "UNKNOWN", "REQUESTED", "EXPIRED"]),
  costTotal: z.number().int().nonnegative().safe().nullable(),
  margin: z.number().int().safe().nullable(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  countedLineKeys: z.array(z.string()),
});

const DraftReplaySchema = z.object({
  quoteId: z.number().int().positive().safe(),
  draftVersionId: z.number().int().positive().safe(),
  status: z.literal("DRAFT"),
  totals: CommercialTotalsReplaySchema,
  replayed: z.boolean(),
});

const PublishReplaySchema = z.object({
  quoteId: z.number().int().positive().safe(),
  quoteVersionId: z.number().int().positive().safe(),
  versionNumber: z.number().int().positive().safe(),
  status: z.literal("PUBLISHED"),
  total: z.number().int().nonnegative().safe(),
  snapshotChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  replayed: z.boolean(),
});

export type CommercialQuoteReadModel = {
  quoteId: number;
  meetingId: number;
  caseId: string;
  status: string;
  scenario: CommercialScenario;
  draft: CommercialVersionReadModel | null;
  published: CommercialVersionReadModel | null;
  history: CommercialVersionHistoryItem[];
};

export type CommercialVersionReadModel = {
  id: number;
  versionNumber: number | null;
  state: string;
  lines: CommercialLine[];
  subtotal: number;
  discountTotal: number;
  total: number | null;
  totalState: string;
  costTotal: number | null;
  margin: number | null;
  blockers: string[];
  warnings: string[];
  publishedAt: string | null;
  validUntil: string | null;
  editorState: Prisma.JsonValue | null;
};

export type CommercialVersionHistoryItem = {
  id: number;
  versionNumber: number;
  state: string;
  total: number | null;
  totalState: string;
  costTotal: number | null;
  margin: number | null;
  lineCount: number;
  publishedAt: string | null;
  validUntil: string | null;
};

export async function getCommercialQuoteForMeeting(
  meetingId: number,
  context: OperationalContext,
): Promise<CommercialQuoteReadModel | null> {
  const quote = await prisma.quote.findFirst({
    where: {
      meetingId,
      organizationId: context.organizationId,
      ...(context.role === "AGENT" ? { ownerMembershipId: context.membershipId } : {}),
    },
    include: {
      activeDraftVersion: { include: { lineItems: { orderBy: { position: "asc" } } } },
      latestPublishedVersion: { include: { lineItems: { orderBy: { position: "asc" } } } },
      versions: {
        where: { versionNumber: { not: null } },
        include: { lineItems: { orderBy: { position: "asc" } } },
        orderBy: { versionNumber: "desc" },
      },
    },
  });
  return quote ? quoteReadModel(quote) : null;
}

export async function requireCommercialMeetingAccess(
  meetingId: number,
  context: OperationalContext,
): Promise<void> {
  const meeting = await prisma.meeting.findFirst({
    where: {
      id: meetingId,
      organizationId: context.organizationId,
      ...(context.role === "AGENT" ? { ownerMembershipId: context.membershipId } : {}),
    },
    select: { id: true },
  });
  if (!meeting) throw new OperationalCommandError(404, "Встреча не найдена");
}

export async function saveCommercialDraft(input: DraftInput): Promise<DraftCommandResult> {
  validateMeta(input.meta);
  const computed = calculateCommercialTotals(input.lines, input.scenario);

  return runOperationalTransaction(async (tx) => {
    const meeting = await loadMeetingForMutation(tx, input.meetingId, input.context);
    if (meeting.case.scenarioId !== input.scenario) {
      throw new OperationalCommandError(422, "Сценарий сметы должен совпадать со сценарием кейса");
    }
    const auditKey = `quote:draft:${input.meta.idempotencyKey}`;
    const replay = await findOperationalReplay(tx, input.context.organizationId, auditKey);
    if (replay) return readReplayResult(DraftReplaySchema, replay.result);

    let quote = await tx.quote.findFirst({
      where: { meetingId: meeting.id, organizationId: input.context.organizationId },
      include: { activeDraftVersion: true, latestPublishedVersion: { include: { lineItems: true } } },
    });
    if (!quote) {
      quote = await tx.quote.create({
        data: {
          meetingId: meeting.id,
          organizationId: input.context.organizationId,
          caseId: meeting.caseId,
          ownerMembershipId: meeting.ownerMembershipId,
          scenario: input.scenario,
          status: "DRAFT",
        },
        include: { activeDraftVersion: true, latestPublishedVersion: { include: { lineItems: true } } },
      });
    }

    let draftId = quote.activeDraftVersionId;
    if (!draftId) {
      const draftLines = input.lines;
      const draftTotals = calculateCommercialTotals(draftLines, input.scenario);
      const draft = await tx.quoteVersion.create({
        data: {
          quoteId: quote.id,
          state: "DRAFT",
          payload: draftPayload(draftLines, draftTotals, input.editorState),
          subtotal: draftTotals.subtotal,
          discountTotal: draftTotals.discountTotal,
          total: draftTotals.total ?? draftTotals.subtotal - draftTotals.discountTotal,
          totalState: draftTotals.totalState,
          currency: "RUB",
          correlationId: input.meta.correlationId,
          lineItems: { create: draftLines.map(lineCreateInput) },
        },
      });
      draftId = draft.id;
    } else {
      await tx.quoteLineItem.deleteMany({ where: { quoteVersionId: draftId } });
      await tx.quoteVersion.update({
        where: { id: draftId },
        data: {
          payload: draftPayload(input.lines, computed, input.editorState),
          subtotal: computed.subtotal,
          discountTotal: computed.discountTotal,
          total: computed.total ?? computed.subtotal - computed.discountTotal,
          totalState: computed.totalState,
          correlationId: input.meta.correlationId,
          lineItems: { create: input.lines.map(lineCreateInput) },
        },
      });
    }

    const updated = await tx.quote.update({
      where: { id: quote.id },
      data: {
        activeDraftVersionId: draftId,
        organizationId: input.context.organizationId,
        caseId: meeting.caseId,
        ownerMembershipId: meeting.ownerMembershipId,
        scenario: input.scenario,
        // An accepted quote is a terminal commercial fact. The builder autosaves 900ms
        // after any editor change, so writing "DRAFT" unconditionally let an agent merely
        // touching a field erase a client's recorded acceptance from the read model — the
        // decision row survived, but the registry derives its state from Quote.status.
        status: quote.status === "ACCEPTED" ? quote.status : "DRAFT",
        version: { increment: 1 },
      },
    });
    const result = {
      quoteId: updated.id,
      draftVersionId: draftId,
      status: updated.status,
      totals: computed,
      replayed: false,
    };
    await appendOperationalAudit(tx, input.context, {
      entityType: "quote",
      entityId: String(updated.id),
      action: "quote.draft_saved",
      before: { status: quote.status, activeDraftVersionId: quote.activeDraftVersionId },
      after: { status: updated.status, activeDraftVersionId: draftId, totalState: computed.totalState },
      reason: input.meta.reason,
      correlationId: input.meta.correlationId,
      idempotencyKey: auditKey,
      result: json(result),
    });
    return result;
  }, COMMERCIAL_COMMAND_ATTEMPTS);
}

export async function markCommercialQuoteInReview(input: {
  quoteId: number;
  context: OperationalContext;
  meta: CommandMeta;
}): Promise<ReviewCommandResult> {
  validateMeta(input.meta);
  return runOperationalTransaction(async (tx) => {
    const quote = await loadQuoteForMutation(tx, input.quoteId, input.context);
    const auditKey = `quote:review:${input.meta.idempotencyKey}`;
    const replay = await findOperationalReplay(tx, input.context.organizationId, auditKey);
    if (replay) return replay.result as unknown as ReviewCommandResult;
    if (!quote.activeDraftVersion) throw new OperationalCommandError(422, "Нет активного черновика для проверки");

    const totals = calculateCommercialTotals(
      quote.activeDraftVersion.lineItems.map(lineFromRecord),
      scenarioFromQuote(quote.scenario),
    );
    const previousLines = quote.latestPublishedVersion?.lineItems.map(lineFromRecord) ?? [];
    const diff = diffCommercialLines(previousLines, quote.activeDraftVersion.lineItems.map(lineFromRecord));
    const previousTotal = quote.latestPublishedVersion?.totalState === "KNOWN"
      ? quote.latestPublishedVersion.total
      : null;
    const totalDelta = totals.total !== null && previousTotal !== null ? totals.total - previousTotal : null;
    const updated = await tx.quote.update({
      where: { id: quote.id },
      data: { status: "IN_REVIEW", version: { increment: 1 } },
    });
    const result = {
      quoteId: quote.id,
      draftVersionId: quote.activeDraftVersion.id,
      status: updated.status,
      totals,
      diff,
      previousTotal,
      totalDelta,
    };
    await appendOperationalAudit(tx, input.context, {
      entityType: "quote",
      entityId: String(quote.id),
      action: "quote.review_started",
      before: { status: quote.status },
      after: { status: updated.status },
      reason: input.meta.reason,
      correlationId: input.meta.correlationId,
      idempotencyKey: auditKey,
      result: json(result),
    });
    return result;
  }, COMMERCIAL_COMMAND_ATTEMPTS);
}

export async function publishCommercialQuote(input: PublishInput): Promise<PublishCommandResult> {
  validateMeta(input.meta);

  return runOperationalTransaction(async (tx) => {
    const quote = await loadQuoteForMutation(tx, input.quoteId, input.context);
    const auditKey = `quote:publish:${input.meta.idempotencyKey}`;
    const replay = await findOperationalReplay(tx, input.context.organizationId, auditKey);
    if (replay) return publishReplayResult(tx, input, replay);
    if (input.validUntil.getTime() <= Date.now()) {
      throw new OperationalCommandError(422, "Срок действия опубликованной сметы должен быть в будущем");
    }
    if (!quote.activeDraftVersion) throw new OperationalCommandError(422, "Нет активного черновика для публикации");
    if (quote.status !== "IN_REVIEW") {
      throw new OperationalCommandError(409, "Перед публикацией откройте проверку состава и цен");
    }

    const scenario = scenarioFromQuote(quote.scenario);
    const lines = quote.activeDraftVersion.lineItems.map(lineFromRecord);
    const totals = calculateCommercialTotals(lines, scenario);
    assertPublishable(totals);
    const versionNumber = (await tx.quoteVersion.aggregate({
      where: { quoteId: quote.id, versionNumber: { not: null } },
      _max: { versionNumber: true },
    }))._max.versionNumber ?? 0;
    const nextVersionNumber = versionNumber + 1;
    const now = new Date();
    const snapshotBase = {
      schemaVersion: 1 as const,
      quoteId: quote.id,
      versionNumber: nextVersionNumber,
      organizationId: input.context.organizationId,
      caseId: quote.caseId!,
      scenario,
      currency: "RUB" as const,
      publishedAt: now.toISOString(),
      validUntil: input.validUntil.toISOString(),
      lines,
      editorState: draftEditorState(quote.activeDraftVersion.payload),
      totals: {
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        total: totals.total,
        totalState: totals.totalState,
        costTotal: totals.costTotal,
        margin: totals.margin,
        countedLineKeys: totals.countedLineKeys,
      },
    } satisfies PublishedQuoteSnapshot;
    const checksum = quoteSnapshotChecksum(snapshotBase);

    if (quote.latestPublishedVersion) {
      await tx.quoteVersion.update({
        where: { id: quote.latestPublishedVersion.id },
        data: { state: "SUPERSEDED" },
      });
      await tx.quoteClientLink.updateMany({
        where: { quoteVersionId: quote.latestPublishedVersion.id, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    const publishedDraft = await tx.quoteVersion.create({
      data: {
        quoteId: quote.id,
        versionNumber: nextVersionNumber,
        state: "DRAFT",
        payload: canonicalSnapshotJson(snapshotBase),
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        total: totals.total,
        totalState: "KNOWN",
        currency: "RUB",
        snapshotChecksum: checksum,
        catalogSourceVersion: catalogSourceVersion(lines),
        publishedByMembershipId: input.context.membershipId,
        publishedAt: now,
        publishReason: input.meta.reason ?? "Передача клиенту",
        publishChannel: input.channel,
        validUntil: input.validUntil,
        idempotencyKey: input.meta.idempotencyKey,
        correlationId: input.meta.correlationId,
        lineItems: { create: lines.map(lineCreateInput) },
      },
    });
    const published = await tx.quoteVersion.update({
      where: { id: publishedDraft.id },
      data: { state: "PUBLISHED" },
    });

    const updated = await tx.quote.update({
      where: { id: quote.id },
      data: {
        status: "PUBLISHED",
        activeDraftVersionId: null,
        latestPublishedVersionId: published.id,
        version: { increment: 1 },
      },
    });
    const caseContext: CaseCommandContext = {
      organizationId: input.context.organizationId,
      membershipId: input.context.membershipId,
      agentId: quote.case!.ownerId,
      actorId: input.context.agentId,
      idempotencyKey: `${input.meta.idempotencyKey}:case`,
      correlationId: input.meta.correlationId,
      causationId: input.meta.idempotencyKey,
    };
    await transitionCaseInTransaction(tx, {
      leadId: quote.case!.leadId,
      eventType: quote.case!.stage === "QUOTING" ? "quote.published.v1" : "quote.republished.v1",
      payload: { quoteVersionId: published.id },
      context: caseContext,
    });

    const result = {
      quoteId: quote.id,
      quoteVersionId: published.id,
      versionNumber: nextVersionNumber,
      status: updated.status,
      total: published.total,
      snapshotChecksum: checksum,
      replayed: false,
    };
    await appendOperationalAudit(tx, input.context, {
      entityType: "quote_version",
      entityId: String(published.id),
      action: "quote.published",
      before: { latestPublishedVersionId: quote.latestPublishedVersionId, status: quote.status },
      after: { latestPublishedVersionId: published.id, status: updated.status, versionNumber: nextVersionNumber },
      reason: input.meta.reason,
      correlationId: input.meta.correlationId,
      idempotencyKey: auditKey,
      result: json(result),
    });
    return result;
  }, COMMERCIAL_COMMAND_ATTEMPTS);
}

export async function createCommercialClientLink(input: {
  quoteId: number;
  expiresAt: Date;
  context: OperationalContext;
  meta: CommandMeta;
}): Promise<{ linkId: string; quoteVersionId: number; replayed: boolean; token: string }> {
  validateMeta(input.meta);
  if (input.expiresAt.getTime() <= Date.now()) throw new OperationalCommandError(422, "Срок ссылки должен быть в будущем");
  const secret = clientLinkSecret();
  const rawToken = createHmac("sha256", secret)
    .update(`${input.context.organizationId}:${input.quoteId}:${input.meta.idempotencyKey}`)
    .digest("base64url");
  const tokenHash = tokenDigest(rawToken);

  const result = await runOperationalTransaction(async (tx) => {
    const quote = await loadQuoteForMutation(tx, input.quoteId, input.context);
    if (!quote.latestPublishedVersion || quote.latestPublishedVersion.state !== "PUBLISHED") {
      throw new OperationalCommandError(422, "Сначала опубликуйте актуальную версию сметы");
    }
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "QuoteVersion" WHERE "id" = ${quote.latestPublishedVersion.id} FOR UPDATE`,
    );
    const expiresAt = quote.latestPublishedVersion.validUntil
      && input.expiresAt > quote.latestPublishedVersion.validUntil
      ? quote.latestPublishedVersion.validUntil
      : input.expiresAt;
    const existing = await tx.quoteClientLink.findUnique({ where: { tokenHash } });
    if (existing) {
      if (existing.quoteVersionId !== quote.latestPublishedVersion.id) {
        throw new OperationalCommandError(409, "Ключ повторной команды уже использован");
      }
      // A replay must return a link the family can actually open. The token is derived from
      // the idempotency key, so re-issuing after a revoke used to hand back the revoked
      // token with replayed: true — success to the agent, "Ссылка недоступна" to the client.
      if (existing.revokedAt !== null) {
        throw new OperationalCommandError(409, "Ссылка по этому ключу была отозвана. Используйте новый ключ.");
      }
      if (existing.expiresAt <= new Date()) {
        throw new OperationalCommandError(409, "Срок ссылки по этому ключу истёк. Используйте новый ключ.");
      }
      return { linkId: existing.id, quoteVersionId: existing.quoteVersionId, replayed: true };
    }
    await tx.quoteClientLink.updateMany({
      where: { quoteVersionId: quote.latestPublishedVersion.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const created = await tx.quoteClientLink.create({
      data: {
        quoteVersionId: quote.latestPublishedVersion.id,
        tokenHash,
        expiresAt,
        createdByMembershipId: input.context.membershipId,
      },
    });
    await appendOperationalAudit(tx, input.context, {
      entityType: "quote_version",
      entityId: String(created.quoteVersionId),
      action: "quote.client_link_created",
      before: {},
      after: { linkId: created.id, expiresAt: created.expiresAt.toISOString() },
      correlationId: input.meta.correlationId,
      idempotencyKey: `quote:link:${input.meta.idempotencyKey}`,
      result: { linkId: created.id, quoteVersionId: created.quoteVersionId },
    });
    return { linkId: created.id, quoteVersionId: created.quoteVersionId, replayed: false };
  }, COMMERCIAL_COMMAND_ATTEMPTS);
  return { ...result, token: rawToken };
}

export async function revokeCommercialClientLinks(input: {
  quoteId: number;
  context: OperationalContext;
  meta: CommandMeta;
}): Promise<{ quoteId: number; revokedCount: number }> {
  validateMeta(input.meta);
  return runOperationalTransaction(async (tx) => {
    const quote = await loadQuoteForMutation(tx, input.quoteId, input.context);
    const auditKey = `quote:link-revoke:${input.meta.idempotencyKey}`;
    const replay = await findOperationalReplay(tx, input.context.organizationId, auditKey);
    if (replay) return replay.result as unknown as { quoteId: number; revokedCount: number };
    const now = new Date();
    const updated = await tx.quoteClientLink.updateMany({
      where: { quoteVersion: { quoteId: quote.id }, revokedAt: null },
      data: { revokedAt: now },
    });
    const result = { quoteId: quote.id, revokedCount: updated.count };
    await appendOperationalAudit(tx, input.context, {
      entityType: "quote",
      entityId: String(quote.id),
      action: "quote.client_links_revoked",
      before: {},
      after: { revokedCount: updated.count },
      correlationId: input.meta.correlationId,
      idempotencyKey: auditKey,
      result,
    });
    return result;
  }, COMMERCIAL_COMMAND_ATTEMPTS);
}

export async function startCommercialPresentation(input: {
  quoteId: number;
  context: OperationalContext;
  meta: CommandMeta;
}): Promise<PresentationCommandResult> {
  validateMeta(input.meta);
  return runOperationalTransaction(async (tx) => {
    const quote = await loadQuoteForMutation(tx, input.quoteId, input.context);
    const auditKey = `quote:presentation-start:${input.meta.idempotencyKey}`;
    const replay = await findOperationalReplay(tx, input.context.organizationId, auditKey);
    if (replay) return replay.result as unknown as PresentationCommandResult;
    if (!quote.activeDraftVersion) throw new OperationalCommandError(422, "Сначала сохраните черновик сметы");
    const lines = quote.activeDraftVersion.lineItems.map(lineFromRecord);
    const totals = calculateCommercialTotals(lines, scenarioFromQuote(quote.scenario));
    const created = await tx.quotePresentationSession.create({
      data: {
        quoteId: quote.id,
        ownerMembershipId: input.context.membershipId,
        state: json({
          schemaVersion: 1,
          draftVersionId: quote.activeDraftVersion.id,
          lines: (() => {
            const settlement = settleCommercialLines(lines);
            return lines
              .filter(isClientVisibleCommercialLine)
              .map((line) => clientSafeLine(line, settlement.get(line.stableKey)));
          })(),
          totals: {
            total: totals.total,
            totalState: totals.totalState,
            blockers: totals.blockers,
          },
        }),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });
    const result = { presentationId: created.id, quoteId: quote.id, expiresAt: created.expiresAt.toISOString() };
    await appendOperationalAudit(tx, input.context, {
      entityType: "quote",
      entityId: String(quote.id),
      action: "quote.presentation_started",
      before: {},
      after: { presentationId: created.id, draftVersionId: quote.activeDraftVersion.id },
      correlationId: input.meta.correlationId,
      idempotencyKey: auditKey,
      result,
    });
    return result;
  }, COMMERCIAL_COMMAND_ATTEMPTS);
}

export async function getCommercialPresentation(id: string, context: OperationalContext) {
  const session = await prisma.quotePresentationSession.findFirst({
    where: {
      id,
      quote: { organizationId: context.organizationId },
      ...(context.role === "AGENT" ? { ownerMembershipId: context.membershipId } : {}),
    },
    include: {
      quote: {
        select: {
          id: true,
          meeting: { select: { lead: { select: { name: true } } } },
        },
      },
    },
  });
  if (!session) throw new OperationalCommandError(404, "Презентация не найдена");
  if (session.endedAt || session.expiresAt <= new Date()) {
    throw new OperationalCommandError(409, "Презентация завершена");
  }
  return {
    id: session.id,
    quoteId: session.quoteId,
    clientName: session.quote.meeting.lead.name,
    state: session.state,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function endCommercialPresentation(input: {
  presentationId: string;
  context: OperationalContext;
  meta: CommandMeta;
}): Promise<{ presentationId: string; quoteId: number; endedAt: string }> {
  validateMeta(input.meta);
  return runOperationalTransaction(async (tx) => {
    const session = await tx.quotePresentationSession.findFirst({
      where: {
        id: input.presentationId,
        quote: { organizationId: input.context.organizationId },
        ...(input.context.role === "AGENT" ? { ownerMembershipId: input.context.membershipId } : {}),
      },
    });
    if (!session) throw new OperationalCommandError(404, "Презентация не найдена");
    const auditKey = `quote:presentation-end:${input.meta.idempotencyKey}`;
    const replay = await findOperationalReplay(tx, input.context.organizationId, auditKey);
    if (replay) {
      return replay.result as unknown as { presentationId: string; quoteId: number; endedAt: string };
    }
    const endedAt = session.endedAt ?? new Date();
    if (!session.endedAt) {
      await tx.quotePresentationSession.update({ where: { id: session.id }, data: { endedAt } });
    }
    const result = { presentationId: session.id, quoteId: session.quoteId, endedAt: endedAt.toISOString() };
    await appendOperationalAudit(tx, input.context, {
      entityType: "quote",
      entityId: String(session.quoteId),
      action: "quote.presentation_ended",
      before: { presentationId: session.id, endedAt: session.endedAt?.toISOString() ?? null },
      after: { presentationId: session.id, endedAt: endedAt.toISOString() },
      correlationId: input.meta.correlationId,
      idempotencyKey: auditKey,
      result,
    });
    return result;
  }, COMMERCIAL_COMMAND_ATTEMPTS);
}

export async function resolveCommercialClientView(token: string) {
  const tokenHash = tokenDigest(token);
  const link = await prisma.quoteClientLink.findUnique({
    where: { tokenHash },
    include: {
      quoteVersion: {
        include: {
          lineItems: { orderBy: { position: "asc" } },
          publishedBy: { select: { user: { select: { name: true, phone: true } } } },
          quote: {
            select: {
              latestPublishedVersionId: true,
              organization: { select: { name: true, status: true } },
            },
          },
          decisions: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!link) return { state: "UNAVAILABLE" as const };
  // Suspending an organization must close its client-facing surface too, not only staff
  // sessions. Report UNAVAILABLE rather than a distinct state: the tenant's administrative
  // status is not a fact a public link holder is entitled to learn.
  if (link.quoteVersion.quote.organization?.status !== "ACTIVE") return { state: "UNAVAILABLE" as const };
  const now = Date.now();
  if (link.revokedAt) return { state: "REVOKED" as const };
  if (link.expiresAt.getTime() <= now || link.quoteVersion.validUntil && link.quoteVersion.validUntil.getTime() <= now) {
    return { state: "EXPIRED" as const };
  }
  if (link.quoteVersion.quote.latestPublishedVersionId !== link.quoteVersionId || link.quoteVersion.state === "SUPERSEDED") {
    return { state: "SUPERSEDED" as const };
  }
  if (link.quoteVersion.state !== "PUBLISHED") return { state: "UNAVAILABLE" as const };
  return {
    state: "PUBLISHED" as const,
    linkId: link.id,
    version: publicVersion(link.quoteVersion),
    organizationName: link.quoteVersion.quote.organization?.name ?? "Тихий дом",
    agentName: link.quoteVersion.publishedBy?.user.name ?? null,
    agentPhone: link.quoteVersion.publishedBy?.user.phone ?? null,
    decision: link.quoteVersion.decisions[0]?.type ?? null,
  };
}

export async function recordCommercialClientDecision(input: {
  token: string;
  type: QuoteClientDecisionType;
  comment?: string;
  idempotencyKey: string;
  correlationId: string;
}): Promise<DecisionCommandResult> {
  validateMeta({ idempotencyKey: input.idempotencyKey, correlationId: input.correlationId });
  const tokenHash = tokenDigest(input.token);
  try {
    return await runOperationalTransaction(async (tx) => {
      const link = await tx.quoteClientLink.findUnique({
      where: { tokenHash },
      include: {
        quoteVersion: {
          include: {
            quote: { include: { case: true, organization: { select: { status: true } } } },
          },
        },
      },
    });
    if (!link || link.revokedAt || link.expiresAt <= new Date()) {
      throw new OperationalCommandError(404, "Ссылка недоступна");
    }
    // A suspended organization must not be able to collect new client decisions through a
    // link that was issued while it was still active. Same 404 as an unknown link: the
    // public surface never discloses the tenant's administrative status.
    if (link.quoteVersion.quote.organization?.status !== "ACTIVE") {
      throw new OperationalCommandError(404, "Ссылка недоступна");
    }
    const version = link.quoteVersion;
    if (
      version.state !== "PUBLISHED"
      || version.validUntil && version.validUntil <= new Date()
      || version.quote.latestPublishedVersionId !== version.id
    ) {
      throw new OperationalCommandError(409, "Эта версия сметы больше не актуальна");
    }
    await tx.$queryRaw`SELECT id FROM "QuoteVersion" WHERE id = ${version.id} FOR UPDATE`;
    const existing = await tx.quoteClientDecision.findUnique({
      where: { quoteVersionId: version.id },
    });
    if (existing) {
      if (existing.type !== input.type) throw new OperationalCommandError(409, "Решение по этой версии уже зафиксировано");
      return { decisionId: existing.id, type: existing.type, replayed: true };
    }
    if (input.type === "CHANGES_REQUESTED" && !input.comment?.trim()) {
      throw new OperationalCommandError(422, "Опишите, что нужно изменить");
    }

    const decision = await tx.quoteClientDecision.create({
      data: {
        quoteVersionId: version.id,
        type: input.type,
        comment: input.type === "CHANGES_REQUESTED" ? input.comment?.trim().slice(0, 2000) || null : null,
        source: "public-client-link",
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
      },
    });
    await tx.quote.update({
      where: { id: version.quoteId },
      data: { status: input.type === "ACCEPTED" ? "ACCEPTED" : "REJECTED", version: { increment: 1 } },
    });

    if (input.type === "ACCEPTED" && version.quote.case) {
      await transitionCaseInTransaction(tx, {
        leadId: version.quote.case.leadId,
        eventType: "quote.accepted.v1",
        payload: { quoteVersionId: version.id },
        context: {
          organizationId: version.quote.organizationId!,
          membershipId: version.quote.ownerMembershipId!,
          agentId: version.quote.case.ownerId,
          actorId: version.quote.case.ownerId,
          idempotencyKey: `${input.idempotencyKey}:case`,
          correlationId: input.correlationId,
          causationId: decision.id,
        },
      });
    } else if (input.type === "CHANGES_REQUESTED" && version.quote.case) {
      const openTask = await tx.task.findFirst({
        where: {
          organizationId: version.quote.organizationId!,
          caseId: version.quote.case.id,
          type: "QUOTE_SEND",
          status: "OPEN",
        },
      });
      if (!openTask) {
        await tx.task.create({
          data: {
            leadId: version.quote.case.leadId,
            agentId: version.quote.case.ownerId,
            organizationId: version.quote.organizationId!,
            caseId: version.quote.case.id,
            assigneeMembershipId: version.quote.ownerMembershipId,
            createdByMembershipId: version.quote.ownerMembershipId!,
            type: "QUOTE_SEND",
            priority: "HIGH",
            status: "OPEN",
            title: "Учесть изменения клиента в смете",
            expectedOutcome: "Опубликована новая версия сметы",
            idempotencyKey: `quote-decision:${decision.id}:follow-up`,
          },
        });
      }
    }

    const actorContext = {
      organizationId: version.quote.organizationId!,
      membershipId: null,
    };
    await appendOperationalAudit(tx, actorContext, {
      entityType: "quote_client_decision",
      entityId: decision.id,
      action: input.type === "ACCEPTED" ? "quote.client_accepted" : "quote.client_changes_requested",
      before: { quoteStatus: "PUBLISHED" },
      after: { quoteStatus: input.type === "ACCEPTED" ? "ACCEPTED" : "REJECTED", decisionType: input.type },
      reason: input.type === "CHANGES_REQUESTED" ? "Клиент запросил изменения" : "Клиент принял опубликованную версию",
      correlationId: input.correlationId,
      causationId: link.id,
      idempotencyKey: `quote:decision:${input.idempotencyKey}`,
      result: { decisionId: decision.id, quoteVersionId: version.id },
      actorType: "client-link",
    });
      return { decisionId: decision.id, type: decision.type, replayed: false };
    }, COMMERCIAL_COMMAND_ATTEMPTS);
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const replay = await prisma.quoteClientLink.findUnique({
      where: { tokenHash },
      select: {
        quoteVersion: {
          select: {
            decisions: { take: 1 },
          },
        },
      },
    });
    const decision = replay?.quoteVersion.decisions[0];
    if (!decision) throw error;
    if (decision.type !== input.type) {
      throw new OperationalCommandError(409, "Решение по этой версии уже зафиксировано");
    }
    return { decisionId: decision.id, type: decision.type, replayed: true };
  }
}

function loadMeetingForMutation(tx: Prisma.TransactionClient, meetingId: number, context: OperationalContext) {
  return tx.meeting.findFirst({
    where: {
      id: meetingId,
      organizationId: context.organizationId,
      ...(context.role === "AGENT" ? { ownerMembershipId: context.membershipId } : {}),
    },
    select: { id: true, caseId: true, ownerMembershipId: true, case: { select: { scenarioId: true } } },
  }).then((meeting) => {
    if (!meeting) throw new OperationalCommandError(404, "Встреча не найдена");
    return meeting;
  });
}

async function loadQuoteForMutation(
  tx: Prisma.TransactionClient,
  quoteId: number,
  context: OperationalContext,
) {
  const quote = await tx.quote.findFirst({
    where: {
      id: quoteId,
      organizationId: context.organizationId,
      ...(context.role === "AGENT" ? { ownerMembershipId: context.membershipId } : {}),
    },
    include: {
      case: true,
      activeDraftVersion: { include: { lineItems: { orderBy: { position: "asc" } } } },
      latestPublishedVersion: { include: { lineItems: { orderBy: { position: "asc" } } } },
    },
  });
  if (!quote || !quote.caseId || !quote.organizationId || !quote.ownerMembershipId || !quote.case) {
    throw new OperationalCommandError(404, "Смета не найдена");
  }
  return quote;
}

async function publishReplayResult(
  tx: Prisma.TransactionClient,
  input: PublishInput,
  replay: NonNullable<Awaited<ReturnType<typeof findOperationalReplay>>>,
): Promise<PublishCommandResult> {
  const result = readReplayResult(PublishReplaySchema, replay.result);
  const published = await tx.quoteVersion.findUnique({
    where: { id: result.quoteVersionId },
    select: {
      quoteId: true,
      versionNumber: true,
      total: true,
      snapshotChecksum: true,
      validUntil: true,
      publishChannel: true,
      publishReason: true,
      idempotencyKey: true,
    },
  });
  const expectedReason = input.meta.reason ?? "Передача клиенту";
  const matchesOriginalCommand = replay.action === "quote.published"
    && replay.entityType === "quote_version"
    && replay.entityId === String(result.quoteVersionId)
    && result.quoteId === input.quoteId
    && published?.quoteId === input.quoteId
    && published.versionNumber === result.versionNumber
    && published.total === result.total
    && published.snapshotChecksum === result.snapshotChecksum
    && published.validUntil?.getTime() === input.validUntil.getTime()
    && published.publishChannel === input.channel
    && published.publishReason === expectedReason
    && published.idempotencyKey === input.meta.idempotencyKey;

  if (!matchesOriginalCommand) {
    throw new OperationalCommandError(
      409,
      "Ключ повторной команды уже использован с другими параметрами",
      "IDEMPOTENCY_CONFLICT",
    );
  }
  return result;
}

function readReplayResult<T extends { replayed: boolean }>(
  schema: z.ZodType<T>,
  value: Prisma.JsonValue,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new OperationalCommandError(
      409,
      "Сохранённый результат повторной команды повреждён",
      "IDEMPOTENCY_REPLAY_INVALID",
    );
  }
  return { ...parsed.data, replayed: true };
}

function lineCreateInput(line: CommercialLine) {
  return {
    stableKey: line.stableKey,
    position: line.position,
    type: line.type,
    catalogItemId: normalizedCatalogId(line.catalogItemId),
    catalogRevisionId: line.catalogRevisionId ?? null,
    serviceCode: line.serviceCode ?? null,
    description: line.description.trim().slice(0, 500),
    quantity: line.quantity,
    unit: line.unit.trim().slice(0, 50),
    priceState: line.priceState,
    clientUnitPrice: line.clientUnitPrice,
    costState: line.costState,
    unitCost: line.unitCost,
    discountAmount: line.discountAmount,
    included: line.included,
    optional: line.optional,
    relationKind: line.relationKind,
    relationKey: line.relationKey ?? null,
    source: line.source.trim().slice(0, 100),
    sourceVersion: line.sourceVersion.trim().slice(0, 100),
    scenarioCompatibility: line.scenarioCompatibility,
  };
}

function lineFromRecord(line: {
  stableKey: string;
  position: number;
  type: string;
  catalogItemId: string | null;
  catalogRevisionId: string | null;
  serviceCode: string | null;
  description: string;
  quantity: number;
  unit: string;
  priceState: string;
  clientUnitPrice: number | null;
  costState: string;
  unitCost: number | null;
  discountAmount: number;
  included: boolean;
  optional: boolean;
  relationKind: string;
  relationKey: string | null;
  source: string;
  sourceVersion: string;
  scenarioCompatibility: Prisma.JsonValue;
}): CommercialLine {
  return {
    stableKey: line.stableKey,
    position: line.position,
    type: line.type as CommercialLine["type"],
    catalogItemId: line.catalogItemId,
    catalogRevisionId: line.catalogRevisionId,
    serviceCode: line.serviceCode,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    priceState: line.priceState as CommercialLine["priceState"],
    clientUnitPrice: line.clientUnitPrice,
    costState: line.costState as CommercialLine["costState"],
    unitCost: line.unitCost,
    discountAmount: line.discountAmount,
    included: line.included,
    optional: line.optional,
    relationKind: line.relationKind as CommercialLine["relationKind"],
    relationKey: line.relationKey,
    source: line.source,
    sourceVersion: line.sourceVersion,
    scenarioCompatibility: Array.isArray(line.scenarioCompatibility)
      ? line.scenarioCompatibility.filter((value): value is CommercialScenario =>
          value === "CREMATION_V1" || value === "FAMILY_PLOT_BURIAL_V1")
      : [],
  };
}

function quoteReadModel(quote: {
  id: number;
  meetingId: number;
  caseId: string | null;
  status: string;
  scenario: string | null;
  activeDraftVersion: VersionWithLines | null;
  latestPublishedVersion: VersionWithLines | null;
  versions: VersionWithLines[];
}): CommercialQuoteReadModel {
  const scenario = scenarioFromQuote(quote.scenario);
  return {
    quoteId: quote.id,
    meetingId: quote.meetingId,
    caseId: quote.caseId ?? "",
    status: quote.status,
    scenario,
    draft: quote.activeDraftVersion ? versionReadModel(quote.activeDraftVersion, scenario) : null,
    published: quote.latestPublishedVersion ? versionReadModel(quote.latestPublishedVersion, scenario) : null,
    history: quote.versions.flatMap((version) => {
      if (version.versionNumber === null) return [];
      const model = versionReadModel(version, scenario);
      return [{
        id: model.id,
        versionNumber: version.versionNumber,
        state: model.state,
        total: model.total,
        totalState: model.totalState,
        costTotal: model.costTotal,
        margin: model.margin,
        lineCount: model.lines.length,
        publishedAt: model.publishedAt,
        validUntil: model.validUntil,
      }];
    }),
  };
}

type VersionWithLines = {
  id: number;
  quoteId: number;
  versionNumber: number | null;
  state: string;
  publishedAt: Date | null;
  validUntil: Date | null;
  payload: string;
  snapshotChecksum: string | null;
  lineItems: Parameters<typeof lineFromRecord>[0][];
};

function versionReadModel(version: VersionWithLines, scenario: CommercialScenario): CommercialVersionReadModel {
  if (version.versionNumber !== null && isImmutablePublishedState(version.state)) {
    return publishedVersionReadModel(version);
  }

  const lines = version.lineItems.map(lineFromRecord);
  const totals = calculateCommercialTotals(lines, scenario);
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    state: version.state,
    lines,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    total: totals.total,
    totalState: totals.totalState,
    costTotal: totals.costTotal,
    margin: totals.margin,
    blockers: totals.blockers,
    warnings: totals.warnings,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    validUntil: version.validUntil?.toISOString() ?? null,
    editorState: draftEditorState(version.payload),
  };
}

function isImmutablePublishedState(state: string) {
  return state === "PUBLISHED" || state === "SUPERSEDED" || state === "EXPIRED";
}

function publishedVersionReadModel(version: VersionWithLines): CommercialVersionReadModel {
  const snapshot = requirePublishedSnapshot(version);
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    state: version.state,
    lines: snapshot.lines,
    subtotal: snapshot.totals.subtotal,
    discountTotal: snapshot.totals.discountTotal,
    total: snapshot.totals.total,
    totalState: snapshot.totals.totalState,
    costTotal: snapshot.totals.costTotal,
    margin: snapshot.totals.margin,
    blockers: [],
    warnings: snapshot.totals.costTotal === null
      ? ["Себестоимость опубликованной версии не подтверждена"]
      : [],
    publishedAt: snapshot.publishedAt,
    validUntil: snapshot.validUntil,
    editorState: snapshot.editorState as Prisma.JsonValue,
  };
}

function requirePublishedSnapshot(version: VersionWithLines): PublishedQuoteSnapshot {
  return readPublishedQuoteSnapshot({
    payload: version.payload,
    snapshotChecksum: version.snapshotChecksum,
    quoteId: version.quoteId,
    versionNumber: version.versionNumber,
  });
}

function publicVersion(version: VersionWithLines & {
  currency: string;
  total: number;
  snapshotChecksum: string | null;
}) {
  const snapshot = requirePublishedSnapshot(version);
  const domainLines = snapshot.lines;
  // The client-facing amounts come from the domain, not from a second calculation in the
  // view. A replacement target or a package child must never render a price it does not
  // contribute to the total.
  const settlement = settleCommercialLines(domainLines);
  const lines = domainLines
    .filter(isClientVisibleCommercialLine)
    .map((line) => clientSafeLine(line, settlement.get(line.stableKey)));
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    publishedAt: snapshot.publishedAt,
    validUntil: snapshot.validUntil,
    currency: snapshot.currency,
    total: snapshot.totals.total,
    snapshotChecksum: version.snapshotChecksum,
    lines,
  };
}

function clientSafeLine(line: CommercialLine, settlement?: CommercialLineSettlement) {
  return {
    settlement: settlement?.settlement ?? "COUNTED",
    lineTotal: settlement?.lineTotal ?? null,
    stableKey: line.stableKey,
    position: line.position,
    type: line.type,
    catalogItemId: line.catalogItemId ?? null,
    catalogRevisionId: line.catalogRevisionId ?? null,
    serviceCode: line.serviceCode ?? null,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    priceState: line.priceState,
    clientUnitPrice: line.clientUnitPrice,
    discountAmount: line.discountAmount,
    included: line.included,
    optional: line.optional,
    relationKind: line.relationKind,
    relationKey: line.relationKey ?? null,
    source: line.source,
    sourceVersion: line.sourceVersion,
    scenarioCompatibility: line.scenarioCompatibility,
  };
}

function draftPayload(
  lines: CommercialLine[],
  totals: ReturnType<typeof calculateCommercialTotals>,
  editorState?: Prisma.InputJsonValue,
) {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "commercial-draft",
    lines,
    editorState: editorState ?? null,
    totals: {
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      total: totals.total,
      totalState: totals.totalState,
      costTotal: totals.costTotal,
      margin: totals.margin,
    },
  });
}

function draftEditorState(payload: string): Prisma.JsonValue | null {
  try {
    const value = JSON.parse(payload) as { editorState?: Prisma.JsonValue };
    return value.editorState ?? null;
  } catch {
    return null;
  }
}

function scenarioFromQuote(value: string | null): CommercialScenario {
  if (value === "CREMATION_V1" || value === "FAMILY_PLOT_BURIAL_V1") return value;
  throw new OperationalCommandError(422, "Сначала выберите сценарий кейса");
}

function normalizedCatalogId(value?: string | null) {
  if (!value) return null;
  return value.startsWith("custom-") ? value.slice("custom-".length) : null;
}

function validateMeta(meta: CommandMeta) {
  if (!meta.idempotencyKey.trim() || !meta.correlationId.trim()) {
    throw new OperationalCommandError(400, "Нужны Idempotency-Key и X-Correlation-Id");
  }
}

function catalogSourceVersion(lines: CommercialLine[]) {
  return createHash("sha256")
    .update(lines.map((line) => `${line.source}:${line.sourceVersion}`).sort().join("|"))
    .digest("hex");
}

function clientLinkSecret() {
  const secret = process.env.CLIENT_LINK_SECRET ?? process.env.APP_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) throw new CommercialQuoteError("CLIENT_LINK_SECRET_MISSING", "Client link secret is unavailable");
  return secret;
}

function tokenDigest(token: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return createHash("sha256").update("invalid-client-link").digest("hex");
  return createHash("sha256").update(token).digest("hex");
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
