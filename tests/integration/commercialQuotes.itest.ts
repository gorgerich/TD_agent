import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommercialLine, CommercialScenario } from "../../lib/commercialQuote";
import { reconcileCommercialQuotes } from "../../lib/commercialReconciliation";
import {
  createCommercialClientLink,
  endCommercialPresentation,
  getCommercialQuoteForMeeting,
  getCommercialPresentation,
  markCommercialQuoteInReview,
  publishCommercialQuote,
  recordCommercialClientDecision,
  resolveCommercialClientView,
  revokeCommercialClientLinks,
  saveCommercialDraft,
  startCommercialPresentation,
} from "../../lib/commercialQuoteService";
import { OperationalCommandError } from "../../lib/operationalTransaction";
import { GET as getMeetingQuoteRoute } from "../../app/api/agent/meeting/[meetingId]/quote/route";
import {
  createFixtureContext,
  db,
  makeRequest,
  sessionCookieHeader,
  skip,
  type FixtureMember,
} from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

function meta(runId: string, action: string) {
  return {
    idempotencyKey: `m2:${runId}:${action}`,
    correlationId: `m2-correlation:${runId}:${action}`,
  };
}

function knownLine(
  stableKey: string,
  scenario: CommercialScenario,
  price = 125_000,
): CommercialLine {
  return {
    stableKey,
    position: 0,
    type: "SERVICE",
    serviceCode: stableKey,
    description: "Организация церемонии",
    quantity: 1,
    unit: "услуга",
    priceState: "KNOWN",
    clientUnitPrice: price,
    costState: "KNOWN",
    unitCost: 80_000,
    discountAmount: 0,
    included: false,
    optional: false,
    relationKind: "STANDALONE",
    source: "integration-catalog",
    sourceVersion: "1",
    scenarioCompatibility: [scenario],
  };
}

async function makeCommercialMeeting(owner: FixtureMember, caseId: string, leadId: number, runId: string) {
  return db.meeting.create({
    data: {
      leadId,
      agentId: owner.agentId,
      organizationId: owner.organizationId,
      caseId,
      ownerMembershipId: owner.membershipId,
      operationalStatus: "COMPLETED",
      idempotencyKey: `m2-meeting:${runId}`,
    },
  });
}

test("M2 canonical draft, review, publish and client decision preserve immutable versions", opts, async () => {
  const fixtures = createFixtureContext("m2-commercial-life");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "commercial");
    await db.case.update({
      where: { id: canonicalCase.id },
      data: { stage: "QUOTING", scenarioId: "CREMATION_V1" },
    });
    const meeting = await makeCommercialMeeting(owner, canonicalCase.id, canonicalCase.leadId, fixtures.runId);
    const v1Lines = [knownLine("service:ceremony", "CREMATION_V1")];

    const draft = await saveCommercialDraft({
      meetingId: meeting.id,
      scenario: "CREMATION_V1",
      lines: v1Lines,
      editorState: { step: "review" },
      context: owner.context,
      meta: meta(fixtures.runId, "draft-v1"),
    });
    assert.equal(draft.status, "DRAFT");
    const draftReplay = await saveCommercialDraft({
      meetingId: meeting.id,
      scenario: "CREMATION_V1",
      lines: v1Lines,
      editorState: { step: "review" },
      context: owner.context,
      meta: meta(fixtures.runId, "draft-v1"),
    });
    assert.deepEqual(draftReplay, draft);
    const presentation = await startCommercialPresentation({
      quoteId: Number(draft.quoteId),
      context: owner.context,
      meta: meta(fixtures.runId, "presentation-v1"),
    });
    assert.equal((await getCommercialPresentation(String(presentation.presentationId), owner.context)).quoteId, Number(draft.quoteId));
    assert.equal(await db.quoteVersion.count({ where: { quoteId: Number(draft.quoteId), state: "PUBLISHED" } }), 0);
    await endCommercialPresentation({
      presentationId: String(presentation.presentationId),
      context: owner.context,
      meta: meta(fixtures.runId, "presentation-end-v1"),
    });
    await assert.rejects(
      getCommercialPresentation(String(presentation.presentationId), owner.context),
      (error: unknown) => error instanceof OperationalCommandError && error.status === 409,
    );

    await markCommercialQuoteInReview({
      quoteId: Number(draft.quoteId),
      context: owner.context,
      meta: meta(fixtures.runId, "review-v1"),
    });
    const publishInput = {
      quoteId: Number(draft.quoteId),
      validUntil: new Date(Date.now() + 86_400_000),
      channel: "client-link",
      context: owner.context,
      meta: meta(fixtures.runId, "publish-v1"),
    };
    const [publishedV1, publishReplay] = await Promise.all([
      publishCommercialQuote(publishInput),
      publishCommercialQuote(publishInput),
    ]);
    assert.equal(publishReplay.quoteVersionId, publishedV1.quoteVersionId);
    assert.equal(await db.quoteVersion.count({
      where: { quoteId: Number(draft.quoteId), state: "PUBLISHED" },
    }), 1);
    const publishedRead = await getCommercialQuoteForMeeting(meeting.id, owner.context);
    assert.deepEqual(publishedRead?.published?.editorState, { step: "review" });
    await assert.rejects(
      db.quoteVersion.update({
        where: { id: publishedV1.quoteVersionId },
        data: { payload: "{\"tampered\":true}" },
      }),
      /immutable/,
    );
    const publishedLine = await db.quoteLineItem.findFirstOrThrow({
      where: { quoteVersionId: publishedV1.quoteVersionId },
    });
    await assert.rejects(
      db.quoteLineItem.update({ where: { id: publishedLine.id }, data: { clientUnitPrice: 1 } }),
      /immutable/,
    );
    await assert.rejects(
      db.quoteLineItem.delete({ where: { id: publishedLine.id } }),
      /immutable/,
    );
    await assert.rejects(
      db.quoteLineItem.create({
        data: {
          quoteVersionId: publishedV1.quoteVersionId,
          stableKey: "tamper:insert",
          position: 99,
          type: "SERVICE",
          serviceCode: "tamper",
          description: "Недопустимая вставка",
          quantity: 1,
          unit: "услуга",
          priceState: "KNOWN",
          clientUnitPrice: 1,
          costState: "KNOWN",
          unitCost: 1,
          source: "tamper-test",
          sourceVersion: "1",
          scenarioCompatibility: ["CREMATION_V1"],
        },
      }),
      /immutable/,
    );

    const linkV1 = await createCommercialClientLink({
      quoteId: Number(draft.quoteId),
      expiresAt: new Date(Date.now() + 86_400_000),
      context: owner.context,
      meta: meta(fixtures.runId, "link-v1"),
    });
    const publicV1 = await resolveCommercialClientView(linkV1.token);
    assert.equal(publicV1.state, "PUBLISHED");
    if (publicV1.state !== "PUBLISHED") throw new Error("Expected published client view");
    assert.equal(publicV1.version.total, 125_000);
    assert.equal("unitCost" in publicV1.version.lines[0], false);

    const changeInput = {
      token: linkV1.token,
      type: "CHANGES_REQUESTED" as const,
      comment: "Нужен другой вариант",
      ...meta(fixtures.runId, "request-changes-v1"),
    };
    const [changeDecision, changeReplay] = await Promise.all([
      recordCommercialClientDecision(changeInput),
      recordCommercialClientDecision({
        ...changeInput,
        idempotencyKey: `${changeInput.idempotencyKey}:second-click`,
      }),
    ]);
    assert.equal(changeReplay.decisionId, changeDecision.decisionId);
    assert.equal(await db.quoteClientDecision.count({
      where: { quoteVersionId: Number(publishedV1.quoteVersionId) },
    }), 1);

    const v1RowBefore = await db.quoteVersion.findUniqueOrThrow({
      where: { id: Number(publishedV1.quoteVersionId) },
      select: { payload: true, total: true, snapshotChecksum: true },
    });
    const v2Lines = [knownLine("service:ceremony", "CREMATION_V1", 140_000)];
    await saveCommercialDraft({
      meetingId: meeting.id,
      scenario: "CREMATION_V1",
      lines: v2Lines,
      context: owner.context,
      meta: meta(fixtures.runId, "draft-v2"),
    });
    await markCommercialQuoteInReview({
      quoteId: Number(draft.quoteId),
      context: owner.context,
      meta: meta(fixtures.runId, "review-v2"),
    });
    const publishedV2 = await publishCommercialQuote({
      quoteId: Number(draft.quoteId),
      validUntil: new Date(Date.now() + 172_800_000),
      channel: "client-link",
      context: owner.context,
      meta: meta(fixtures.runId, "publish-v2"),
    });
    assert.equal(publishedV2.versionNumber, 2);
    assert.equal((await resolveCommercialClientView(linkV1.token)).state, "REVOKED");
    const v1RowAfter = await db.quoteVersion.findUniqueOrThrow({
      where: { id: Number(publishedV1.quoteVersionId) },
      select: { payload: true, total: true, snapshotChecksum: true, state: true },
    });
    assert.deepEqual(
      { payload: v1RowAfter.payload, total: v1RowAfter.total, snapshotChecksum: v1RowAfter.snapshotChecksum },
      v1RowBefore,
    );
    assert.equal(v1RowAfter.state, "SUPERSEDED");

    const linkV2 = await createCommercialClientLink({
      quoteId: Number(draft.quoteId),
      expiresAt: new Date(Date.now() + 86_400_000),
      context: owner.context,
      meta: meta(fixtures.runId, "link-v2"),
    });
    const accepted = await recordCommercialClientDecision({
      token: linkV2.token,
      type: "ACCEPTED",
      ...meta(fixtures.runId, "accept-v2"),
    });
    assert.equal(accepted.type, "ACCEPTED");
    assert.equal((await db.case.findUniqueOrThrow({ where: { id: canonicalCase.id } })).stage, "CONTRACTING");
    assert.equal(await db.quoteClientDecision.count({ where: { quoteVersionId: Number(publishedV2.quoteVersionId) } }), 1);
    assert.equal((await reconcileCommercialQuotes(owner.organizationId)).discrepancies, 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M2 unknown price blocks publication and unknown cost never becomes a fake margin", opts, async () => {
  const fixtures = createFixtureContext("m2-commercial-unknown");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "unknown");
    await db.case.update({
      where: { id: canonicalCase.id },
      data: { stage: "QUOTING", scenarioId: "FAMILY_PLOT_BURIAL_V1" },
    });
    const meeting = await makeCommercialMeeting(owner, canonicalCase.id, canonicalCase.leadId, fixtures.runId);
    const unknownPrice = {
      ...knownLine("service:cemetery", "FAMILY_PLOT_BURIAL_V1"),
      priceState: "UNKNOWN" as const,
      clientUnitPrice: null,
      costState: "UNKNOWN" as const,
      unitCost: null,
    };
    const saved = await saveCommercialDraft({
      meetingId: meeting.id,
      scenario: "FAMILY_PLOT_BURIAL_V1",
      lines: [unknownPrice],
      context: owner.context,
      meta: meta(fixtures.runId, "unknown-draft"),
    });
    const read = await getCommercialQuoteForMeeting(meeting.id, owner.context);
    assert.equal(read?.draft?.total, null);
    assert.equal(read?.draft?.margin, null);
    assert.match(read?.draft?.blockers[0] ?? "", /не подтверждена/);
    await assert.rejects(
      publishCommercialQuote({
        quoteId: Number(saved.quoteId),
        validUntil: new Date(Date.now() + 86_400_000),
        channel: "client-link",
        context: owner.context,
        meta: meta(fixtures.runId, "publish-without-review"),
      }),
      /проверку/,
    );
    await markCommercialQuoteInReview({
      quoteId: Number(saved.quoteId),
      context: owner.context,
      meta: meta(fixtures.runId, "unknown-review"),
    });
    await assert.rejects(
      publishCommercialQuote({
        quoteId: Number(saved.quoteId),
        validUntil: new Date(Date.now() + 86_400_000),
        channel: "client-link",
        context: owner.context,
        meta: meta(fixtures.runId, "unknown-publish"),
      }),
      /не подтверждена/,
    );
    assert.equal(await db.quoteVersion.count({ where: { quoteId: Number(saved.quoteId), state: "PUBLISHED" } }), 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M2 tenant boundaries and link lifecycle fail closed", opts, async () => {
  const fixtures = createFixtureContext("m2-commercial-security");
  try {
    const owner = await fixtures.makeAgent("owner");
    const foreign = await fixtures.makeAgent("foreign");
    const teammate = await fixtures.makeMember("teammate", { organizationId: owner.organizationId, role: "AGENT" });
    const manager = await fixtures.makeMember("manager", { organizationId: owner.organizationId, role: "MANAGER" });
    const canonicalCase = await fixtures.makeCase(owner, "secure");
    await db.case.update({
      where: { id: canonicalCase.id },
      data: { stage: "QUOTING", scenarioId: "CREMATION_V1" },
    });
    const meeting = await makeCommercialMeeting(owner, canonicalCase.id, canonicalCase.leadId, fixtures.runId);
    const saved = await saveCommercialDraft({
      meetingId: meeting.id,
      scenario: "CREMATION_V1",
      lines: [knownLine("service:secure", "CREMATION_V1")],
      context: owner.context,
      meta: meta(fixtures.runId, "secure-draft"),
    });
    assert.equal(await getCommercialQuoteForMeeting(meeting.id, foreign.context), null);
    assert.equal(await getCommercialQuoteForMeeting(meeting.id, teammate.context), null);
    assert.equal((await getCommercialQuoteForMeeting(meeting.id, manager.context))?.quoteId, saved.quoteId);
    const routeParams = { params: Promise.resolve({ meetingId: String(meeting.id) }) };
    const foreignResponse = await getMeetingQuoteRoute(
      makeRequest(`/api/agent/meeting/${meeting.id}/quote`, {
        cookie: await sessionCookieHeader(foreign.userId, foreign.agentId),
      }),
      routeParams,
    );
    assert.equal(foreignResponse.status, 404);
    const teammateResponse = await getMeetingQuoteRoute(
      makeRequest(`/api/agent/meeting/${meeting.id}/quote`, {
        cookie: await sessionCookieHeader(teammate.userId, teammate.agentId),
      }),
      routeParams,
    );
    assert.equal(teammateResponse.status, 404);
    const managerResponse = await getMeetingQuoteRoute(
      makeRequest(`/api/agent/meeting/${meeting.id}/quote`, {
        cookie: await sessionCookieHeader(manager.userId, manager.agentId),
      }),
      routeParams,
    );
    assert.equal(managerResponse.status, 200);
    assert.equal((await managerResponse.json()).quote.quoteId, saved.quoteId);
    await assert.rejects(
      markCommercialQuoteInReview({
        quoteId: Number(saved.quoteId),
        context: foreign.context,
        meta: meta(fixtures.runId, "foreign-review"),
      }),
      (error: unknown) => error instanceof OperationalCommandError && error.status === 404,
    );
    await markCommercialQuoteInReview({
      quoteId: Number(saved.quoteId),
      context: owner.context,
      meta: meta(fixtures.runId, "secure-review"),
    });
    await publishCommercialQuote({
      quoteId: Number(saved.quoteId),
      validUntil: new Date(Date.now() + 86_400_000),
      channel: "client-link",
      context: owner.context,
      meta: meta(fixtures.runId, "secure-publish"),
    });
    const link = await createCommercialClientLink({
      quoteId: Number(saved.quoteId),
      expiresAt: new Date(Date.now() + 86_400_000),
      context: owner.context,
      meta: meta(fixtures.runId, "secure-link"),
    });
    assert.equal(await db.quoteClientLink.count({ where: { tokenHash: link.token } }), 0);
    assert.equal((await resolveCommercialClientView("not-a-valid-token")).state, "UNAVAILABLE");
    assert.equal(link.replayed, false);
    // Reissuing under the same idempotency key must replay the existing link rather than
    // revoke it and mint a second one.
    const replayedLink = await createCommercialClientLink({
      quoteId: Number(saved.quoteId),
      expiresAt: new Date(Date.now() + 86_400_000),
      context: owner.context,
      meta: meta(fixtures.runId, "secure-link"),
    });
    assert.equal(replayedLink.replayed, true);
    assert.equal(replayedLink.linkId, link.linkId);
    assert.equal(replayedLink.token, link.token);
    assert.equal(replayedLink.quoteVersionId, link.quoteVersionId);
    assert.equal(
      await db.quoteClientLink.count({ where: { quoteVersionId: link.quoteVersionId, revokedAt: null } }),
      1,
    );

    // Suspending the organization must close the client-facing surface as well, not only
    // staff sessions. The public state stays UNAVAILABLE so the tenant's administrative
    // status is never disclosed to a link holder.
    assert.equal((await resolveCommercialClientView(link.token)).state, "PUBLISHED");
    await db.organization.update({ where: { id: owner.organizationId }, data: { status: "SUSPENDED" } });
    assert.equal((await resolveCommercialClientView(link.token)).state, "UNAVAILABLE");
    await assert.rejects(
      recordCommercialClientDecision({
        token: link.token,
        type: "ACCEPTED",
        ...meta(fixtures.runId, "suspended-accept"),
      }),
      (error: unknown) => error instanceof OperationalCommandError && error.status === 404,
    );
    assert.equal(
      await db.quoteClientDecision.count({ where: { quoteVersionId: link.quoteVersionId } }),
      0,
      "A suspended organization must not collect a client decision",
    );
    await db.organization.update({ where: { id: owner.organizationId }, data: { status: "ACTIVE" } });
    assert.equal((await resolveCommercialClientView(link.token)).state, "PUBLISHED");
    const [concurrentLinkA, concurrentLinkB] = await Promise.all([
      createCommercialClientLink({
        quoteId: Number(saved.quoteId),
        expiresAt: new Date(Date.now() + 86_400_000),
        context: owner.context,
        meta: meta(fixtures.runId, "concurrent-link-a"),
      }),
      createCommercialClientLink({
        quoteId: Number(saved.quoteId),
        expiresAt: new Date(Date.now() + 86_400_000),
        context: owner.context,
        meta: meta(fixtures.runId, "concurrent-link-b"),
      }),
    ]);
    assert.equal(await db.quoteClientLink.count({
      where: {
        quoteVersionId: concurrentLinkA.quoteVersionId,
        revokedAt: null,
      },
    }), 1);
    assert.equal(
      await db.quoteClientLink.count({
        where: {
          id: { in: [concurrentLinkA.linkId, concurrentLinkB.linkId] },
          revokedAt: { not: null },
        },
      }),
      1,
    );
    // A replay must hand back a link the family can open. Re-issuing under a key whose link
    // was revoked used to report success with the revoked token.
    await revokeCommercialClientLinks({
      quoteId: Number(saved.quoteId),
      context: owner.context,
      meta: meta(fixtures.runId, "revoke-before-replay"),
    });
    await assert.rejects(
      createCommercialClientLink({
        quoteId: Number(saved.quoteId),
        expiresAt: new Date(Date.now() + 86_400_000),
        context: owner.context,
        meta: meta(fixtures.runId, "secure-link"),
      }),
      (error: unknown) => error instanceof OperationalCommandError && error.status === 409,
    );

    const expiringLink = await createCommercialClientLink({
      quoteId: Number(saved.quoteId),
      expiresAt: new Date(Date.now() + 86_400_000),
      context: owner.context,
      meta: meta(fixtures.runId, "expiring-link"),
    });
    await db.quoteClientLink.update({
      where: { id: expiringLink.linkId },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    assert.equal((await resolveCommercialClientView(expiringLink.token)).state, "EXPIRED");
    // Replaying the expired key must refuse rather than hand back a token the family cannot
    // open — the same contract as the revoked case.
    await assert.rejects(
      createCommercialClientLink({
        quoteId: Number(saved.quoteId),
        expiresAt: new Date(Date.now() + 86_400_000),
        context: owner.context,
        meta: meta(fixtures.runId, "expiring-link"),
      }),
      (error: unknown) => error instanceof OperationalCommandError && error.status === 409,
    );
    const afterExpiry = await createCommercialClientLink({
      quoteId: Number(saved.quoteId),
      expiresAt: new Date(Date.now() + 86_400_000),
      context: owner.context,
      meta: meta(fixtures.runId, "link-after-expiry"),
    });
    assert.equal((await resolveCommercialClientView(afterExpiry.token)).state, "PUBLISHED");
    await revokeCommercialClientLinks({
      quoteId: Number(saved.quoteId),
      context: owner.context,
      meta: meta(fixtures.runId, "revoke"),
    });
    await revokeCommercialClientLinks({
      quoteId: Number(saved.quoteId),
      context: owner.context,
      meta: meta(fixtures.runId, "revoke"),
    });
    assert.equal((await resolveCommercialClientView(link.token)).state, "REVOKED");
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});
