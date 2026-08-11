import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommercialLine } from "../../lib/commercialQuote";
import { publishCommercialQuote, saveCommercialDraft } from "../../lib/commercialQuoteService";
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

async function prepareQuote(fixtures: IntegrationFixtureContext, owner: FixtureMember, suffix = "primary") {
  const runId = fixtures.runId;
  const canonicalCase = await fixtures.makeCase(owner, `publish-idempotency-${suffix}`);
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
      idempotencyKey: `m2-idempotency-meeting:${runId}:${suffix}`,
    },
  });
  const quote = await db.quote.create({
    data: {
      meetingId: meeting.id,
      organizationId: owner.organizationId,
      caseId: canonicalCase.id,
      ownerMembershipId: owner.membershipId,
      scenario: "CREMATION_V1",
      status: "DRAFT",
      currency: "RUB",
    },
  });
  const fixtureLine = line(`service:${runId}:${suffix}`);
  const draft = await db.quoteVersion.create({
    data: {
      quoteId: quote.id,
      state: "DRAFT",
      payload: JSON.stringify({ schemaVersion: 1, editorState: null }),
      subtotal: 125_000,
      discountTotal: 0,
      total: 125_000,
      totalState: "KNOWN",
      currency: "RUB",
      lineItems: {
        create: {
          stableKey: fixtureLine.stableKey,
          position: fixtureLine.position,
          type: fixtureLine.type,
          serviceCode: fixtureLine.serviceCode,
          description: fixtureLine.description,
          quantity: fixtureLine.quantity,
          unit: fixtureLine.unit,
          priceState: fixtureLine.priceState,
          clientUnitPrice: fixtureLine.clientUnitPrice,
          costState: fixtureLine.costState,
          unitCost: fixtureLine.unitCost,
          discountAmount: fixtureLine.discountAmount,
          included: fixtureLine.included,
          optional: fixtureLine.optional,
          relationKind: fixtureLine.relationKind,
          source: fixtureLine.source,
          sourceVersion: fixtureLine.sourceVersion,
          scenarioCompatibility: fixtureLine.scenarioCompatibility,
        },
      },
    },
  });
  await db.quote.update({
    where: { id: quote.id },
    data: { activeDraftVersionId: draft.id, status: "IN_REVIEW" },
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
      idempotencyKey: `m2-idempotency-task:${runId}:${suffix}`,
      title: "Опубликовать синтетическую смету",
    },
  });
  return { canonicalCase, meeting, quoteId: quote.id };
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
    const foreign = await fixtures.makeAgent("foreign");
    const cookie = await sessionCookieHeader(owner.userId, owner.agentId);
    const foreignCookie = await sessionCookieHeader(foreign.userId, foreign.agentId);
    const command = meta(fixtures.runId, "publish-api");
    const body = {
      validUntil: new Date(Date.now() + 5_000).toISOString(),
      channel: "link",
      reason: command.reason,
    };
    const request = (
      requestBody = body,
      quoteId = prepared.quoteId,
      requestCookie = cookie,
      requestCommand = command,
    ) => publishRoute(
      makeRequest(`/api/agent/quotes/${quoteId}/publish`, {
        method: "POST",
        cookie: requestCookie,
        headers: {
          "idempotency-key": requestCommand.idempotencyKey,
          "x-correlation-id": requestCommand.correlationId,
        },
        body: requestBody,
      }),
      { params: Promise.resolve({ quoteId: String(quoteId) }) },
    );

    const firstResponse = await request();
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as {
      ok: boolean;
      quoteId: number;
      quoteVersionId: number;
      versionNumber: number;
      status: string;
      total: number;
      snapshotChecksum: string;
      replayed: boolean;
    };
    assert.equal(first.ok, true);
    assert.equal(first.replayed, false);
    const persistedAfterFirst = await db.operationalAuditEvent.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: owner.organizationId,
          idempotencyKey: `quote:publish:${command.idempotencyKey}`,
        },
      },
      select: { result: true },
    });
    const afterFirst = await sideEffectCounts({
      organizationId: owner.organizationId,
      caseId: prepared.canonicalCase.id,
      quoteId: prepared.quoteId,
      publishKey: command.idempotencyKey,
    });

    const replayResponse = await request();
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json() as typeof first;
    assert.deepEqual(replay, { ...first, replayed: true });
    assert.deepEqual(await sideEffectCounts({
      organizationId: owner.organizationId,
      caseId: prepared.canonicalCase.id,
      quoteId: prepared.quoteId,
      publishKey: command.idempotencyKey,
    }), afterFirst);

    const conflicts = [
      { ...body, reason: "Другой payload" },
      { ...body, validUntil: new Date(Date.now() + 172_800_000).toISOString() },
      { ...body, channel: "print" },
    ];
    for (const changedBody of conflicts) {
      const conflictResponse = await request(changedBody);
      assert.equal(conflictResponse.status, 409);
      assert.equal((await conflictResponse.json() as { code: string }).code, "IDEMPOTENCY_CONFLICT");
    }

    const secondQuote = await prepareQuote(fixtures, owner, "second-target");
    const targetConflict = await request(body, secondQuote.quoteId);
    assert.equal(targetConflict.status, 409);
    assert.equal((await targetConflict.json() as { code: string }).code, "IDEMPOTENCY_CONFLICT");

    const crossTenant = await request(body, prepared.quoteId, foreignCookie);
    assert.equal(crossTenant.status, 404);
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
    const persistedAfterReplays = await db.operationalAuditEvent.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: owner.organizationId,
          idempotencyKey: `quote:publish:${command.idempotencyKey}`,
        },
      },
      select: { result: true },
    });
    assert.deepEqual(persistedAfterReplays.result, persistedAfterFirst.result);

    const remainingValidityMs = new Date(body.validUntil).getTime() - Date.now();
    if (remainingValidityMs >= 0) await new Promise((resolve) => setTimeout(resolve, remainingValidityMs + 50));
    const expiredReplayResponse = await request();
    assert.equal(expiredReplayResponse.status, 200);
    assert.deepEqual(await expiredReplayResponse.json(), { ...first, replayed: true });

    const malformedQuote = await prepareQuote(fixtures, owner, "malformed-result");
    const malformedCommand = meta(fixtures.runId, "malformed-result");
    await db.operationalAuditEvent.create({
      data: {
        organizationId: owner.organizationId,
        actorMembershipId: owner.membershipId,
        entityType: "quote_version",
        entityId: "0",
        action: "quote.published",
        before: {},
        after: {},
        reason: malformedCommand.reason,
        correlationId: malformedCommand.correlationId,
        idempotencyKey: `quote:publish:${malformedCommand.idempotencyKey}`,
        result: { quoteId: malformedQuote.quoteId, quoteVersionId: 0, replayed: false },
      },
    });
    const malformedReplay = await request(
      { ...body, validUntil: new Date(Date.now() + 86_400_000).toISOString() },
      malformedQuote.quoteId,
      cookie,
      malformedCommand,
    );
    assert.equal(malformedReplay.status, 409);
    assert.equal((await malformedReplay.json() as { code: string }).code, "IDEMPOTENCY_REPLAY_INVALID");
    assert.deepEqual(await sideEffectCounts({
      organizationId: owner.organizationId,
      caseId: prepared.canonicalCase.id,
      quoteId: prepared.quoteId,
      publishKey: command.idempotencyKey,
    }), afterFirst);
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

test("M2 draft replay preserves the valid ACCEPTED lifecycle status", opts, async () => {
  const fixtures = createFixtureContext("m2-accepted-draft-replay");
  try {
    const owner = await fixtures.makeAgent("owner");
    const prepared = await prepareQuote(fixtures, owner);
    await db.quote.update({ where: { id: prepared.quoteId }, data: { status: "ACCEPTED" } });

    const input = {
      meetingId: prepared.meeting.id,
      scenario: "CREMATION_V1" as const,
      lines: [line(`accepted-revision:${fixtures.runId}`)],
      context: owner.context,
      meta: meta(fixtures.runId, "accepted-draft"),
    };
    const first = await saveCommercialDraft(input);
    assert.equal(first.status, "ACCEPTED");
    assert.equal(first.replayed, false);

    const replay = await saveCommercialDraft(input);
    assert.deepEqual(replay, { ...first, replayed: true });
    const persisted = await db.operationalAuditEvent.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: owner.organizationId,
          idempotencyKey: `quote:draft:${input.meta.idempotencyKey}`,
        },
      },
      select: { result: true },
    });
    assert.deepEqual(persisted.result, first);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});
