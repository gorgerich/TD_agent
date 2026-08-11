import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommercialLine } from "../../lib/commercialQuote";
import {
  markCommercialQuoteInReview,
  publishCommercialQuote,
  saveCommercialDraft,
} from "../../lib/commercialQuoteService";
import { POST as publishRoute } from "../../app/api/agent/quotes/[quoteId]/publish/route";
import {
  createFixtureContext,
  db,
  makeRequest,
  sessionCookieHeader,
  skip,
  type FixtureMember,
  type IntegrationFixtureContext,
} from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

function meta(runId: string, action: string) {
  return {
    idempotencyKey: `m2-idempotency:${runId}:${action}`,
    correlationId: `m2-idempotency-correlation:${runId}:${action}`,
    reason: "Проверка правдивого idempotency replay",
  };
}

function line(stableKey: string): CommercialLine {
  return {
    stableKey,
    position: 0,
    type: "SERVICE",
    serviceCode: stableKey,
    description: "Синтетическая услуга",
    quantity: 1,
    unit: "услуга",
    priceState: "KNOWN",
    clientUnitPrice: 125_000,
    costState: "KNOWN",
    unitCost: 80_000,
    discountAmount: 0,
    included: false,
    optional: false,
    relationKind: "STANDALONE",
    source: "integration-catalog",
    sourceVersion: "1",
    scenarioCompatibility: ["CREMATION_V1"],
  };
}

async function prepareQuote(fixtures: IntegrationFixtureContext, owner: FixtureMember) {
  const runId = fixtures.runId;
  const canonicalCase = await fixtures.makeCase(owner, "publish-idempotency");
  await db.case.update({
    where: { id: canonicalCase.id },
    data: { stage: "QUOTING", scenarioId: "CREMATION_V1" },
  });
  const meeting = await db.meeting.create({
    data: {
      leadId: canonicalCase.leadId,
      agentId: owner.agentId,
      organizationId: owner.organizationId,
      caseId: canonicalCase.id,
      ownerMembershipId: owner.membershipId,
      operationalStatus: "COMPLETED",
      idempotencyKey: `m2-idempotency-meeting:${runId}`,
    },
  });
  const draft = await saveCommercialDraft({
    meetingId: meeting.id,
    scenario: "CREMATION_V1",
    lines: [line(`service:${runId}`)],
    context: owner.context,
    meta: meta(runId, "draft"),
  });
  await markCommercialQuoteInReview({
    quoteId: draft.quoteId,
    context: owner.context,
    meta: meta(runId, "review"),
  });
  await db.task.create({
    data: {
      leadId: canonicalCase.leadId,
      agentId: owner.agentId,
      organizationId: owner.organizationId,
      caseId: canonicalCase.id,
      assigneeMembershipId: owner.membershipId,
      createdByMembershipId: owner.membershipId,
      type: "QUOTE_SEND",
      priority: "HIGH",
      status: "OPEN",
      idempotencyKey: `m2-idempotency-task:${runId}`,
      title: "Опубликовать синтетическую смету",
    },
  });
  return { canonicalCase, meeting, quoteId: draft.quoteId };
}

async function sideEffectCounts(input: {
  organizationId: string;
  caseId: string;
  quoteId: number;
  publishKey: string;
}) {
  const event = await db.caseEvent.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId: input.organizationId,
        idempotencyKey: `${input.publishKey}:case`,
      },
    },
    select: { id: true },
  });
  return {
    publishedVersions: await db.quoteVersion.count({
      where: { quoteId: input.quoteId, versionNumber: { not: null } },
    }),
    publishAudit: await db.operationalAuditEvent.count({
      where: { organizationId: input.organizationId, idempotencyKey: `quote:publish:${input.publishKey}` },
    }),
    caseEvents: await db.caseEvent.count({
      where: { caseId: input.caseId, idempotencyKey: `${input.publishKey}:case` },
    }),
    tasks: await db.task.count({ where: { caseId: input.caseId } }),
    completedTasks: await db.task.count({ where: { caseId: input.caseId, status: "COMPLETED" } }),
    taskProjectionAudit: event
      ? await db.operationalAuditEvent.count({
          where: { organizationId: input.organizationId, causationId: event.id, action: "task.completed_by_event" },
        })
      : 0,
    projectionReceipts: event
      ? await db.projectionReceipt.count({
          where: { organizationId: input.organizationId, sourceEventId: event.id },
        })
      : 0,
  };
}

test("M2 publish idempotency truth: API replay is true and changed payload conflicts", opts, async () => {
  const fixtures = createFixtureContext("m2-publish-api-replay");
  try {
    const owner = await fixtures.makeAgent("owner");
    const prepared = await prepareQuote(fixtures, owner);
    const cookie = await sessionCookieHeader(owner.userId, owner.agentId);
    const command = meta(fixtures.runId, "publish-api");
    const body = {
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      channel: "link",
      reason: command.reason,
    };
    const request = (requestBody = body) => publishRoute(
      makeRequest(`/api/agent/quotes/${prepared.quoteId}/publish`, {
        method: "POST",
        cookie,
        headers: {
          "idempotency-key": command.idempotencyKey,
          "x-correlation-id": command.correlationId,
        },
        body: requestBody,
      }),
      { params: Promise.resolve({ quoteId: String(prepared.quoteId) }) },
    );

    const firstResponse = await request();
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as {
      quoteVersionId: number;
      versionNumber: number;
      replayed: boolean;
    };
    assert.equal(first.replayed, false);
    const afterFirst = await sideEffectCounts({
      organizationId: owner.organizationId,
      caseId: prepared.canonicalCase.id,
      quoteId: prepared.quoteId,
      publishKey: command.idempotencyKey,
    });

    const replayResponse = await request();
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json() as typeof first;
    assert.equal(replay.replayed, true);
    assert.equal(replay.quoteVersionId, first.quoteVersionId);
    assert.equal(replay.versionNumber, first.versionNumber);
    assert.deepEqual(await sideEffectCounts({
      organizationId: owner.organizationId,
      caseId: prepared.canonicalCase.id,
      quoteId: prepared.quoteId,
      publishKey: command.idempotencyKey,
    }), afterFirst);

    const conflictResponse = await request({ ...body, reason: "Другой payload" });
    assert.equal(conflictResponse.status, 409);
    assert.equal((await conflictResponse.json() as { code: string }).code, "IDEMPOTENCY_CONFLICT");
    assert.deepEqual(await sideEffectCounts({
      organizationId: owner.organizationId,
      caseId: prepared.canonicalCase.id,
      quoteId: prepared.quoteId,
      publishKey: command.idempotencyKey,
    }), afterFirst);
    assert.deepEqual(afterFirst, {
      publishedVersions: 1,
      publishAudit: 1,
      caseEvents: 1,
      tasks: 1,
      completedTasks: 1,
      taskProjectionAudit: 1,
      projectionReceipts: 1,
    });
    const persisted = await db.operationalAuditEvent.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: owner.organizationId,
          idempotencyKey: `quote:publish:${command.idempotencyKey}`,
        },
      },
      select: { result: true },
    });
    assert.equal((persisted.result as { replayed: boolean }).replayed, false);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M2 publish idempotency truth: parallel duplicates create one result with truthful flags", opts, async () => {
  const fixtures = createFixtureContext("m2-publish-parallel-replay");
  try {
    const owner = await fixtures.makeAgent("owner");
    const prepared = await prepareQuote(fixtures, owner);
    const command = meta(fixtures.runId, "publish-parallel");
    const input = {
      quoteId: prepared.quoteId,
      validUntil: new Date(Date.now() + 86_400_000),
      channel: "link",
      context: owner.context,
      meta: command,
    };
    const results = await Promise.all(Array.from({ length: 6 }, () => publishCommercialQuote(input)));
    assert.equal(new Set(results.map((result) => result.quoteVersionId)).size, 1);
    assert.equal(new Set(results.map((result) => result.versionNumber)).size, 1);
    assert.equal(results.filter((result) => result.replayed === false).length, 1);
    assert.equal(results.filter((result) => result.replayed === true).length, 5);
    assert.deepEqual(await sideEffectCounts({
      organizationId: owner.organizationId,
      caseId: prepared.canonicalCase.id,
      quoteId: prepared.quoteId,
      publishKey: command.idempotencyKey,
    }), {
      publishedVersions: 1,
      publishAudit: 1,
      caseEvents: 1,
      tasks: 1,
      completedTasks: 1,
      taskProjectionAudit: 1,
      projectionReceipts: 1,
    });
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});
