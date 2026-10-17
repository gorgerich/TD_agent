import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { POST as saveView } from "../../app/api/agent/operations/views/route";
import { POST as inviteMember } from "../../app/api/agent/invitations/route";
import { PATCH as updateInvite } from "../../app/api/agent/invitations/[inviteId]/route";
import { PATCH as updateMembership } from "../../app/api/agent/organization/memberships/[membershipId]/route";
import { appendOperationalAudit } from "../../lib/operationalAudit";
import { serverCommandKey } from "../../lib/commandNamespace";
import { createMeeting, updateMeetingStatus } from "../../lib/meetingService";
import { projectPastMeetingEscalation } from "../../lib/operationsProjection";
import { createFixtureContext, db, makeRequest, sessionCookieHeader, skip } from "./_setup";

const opts = { skip: skip ? "Approved local integration database required" : false };
const reservedKeys = [
  serverCommandKey("db-auth-ledger", "synthetic-parent"), "projection:synthetic:audit", "quote:synthetic",
  "quote-decision:synthetic", "catalog:create:synthetic", "catalog:price:synthetic", "catalog:discontinue:synthetic",
  "invite:accepted:synthetic", "finance-mfa-enabled:synthetic", "webhook:synthetic", "webhook-audit:synthetic",
  "document-access:synthetic", "document-rejection:synthetic", "document-review-escalation:synthetic",
];

test("ordinary client can occupy old meeting child key without blocking completion; reserved new key is rejected", opts, async () => {
  const fixtures = createFixtureContext("cpo-meeting-child-collision");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "past-meeting");
    const meta = (suffix: string) => ({ idempotencyKey: `client:${fixtures.runId}:${suffix}`, correlationId: fixtures.runId });
    const meeting = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId, scheduledAt: new Date(Date.now() - 3_600_000),
    }, meta("create"));
    assert.equal(await projectPastMeetingEscalation(owner.organizationId, meeting.id, new Date()), true);
    const task = await db.task.findFirstOrThrow({ where: {
      organizationId: owner.organizationId, sourceEventId: `meeting:${meeting.id}:past-due:v${meeting.version}`, type: "MEETING_ESCALATION",
    } });
    const completionMeta = meta("complete");
    const oldKey = `${completionMeta.idempotencyKey}:escalation:${task.id}`;
    const newKey = serverCommandKey("meeting-outcome-audit", oldKey);
    const cookie = await sessionCookieHeader(owner.userId, owner.agentId);
    const viewRequest = (key: string, name: string) => makeRequest("/api/agent/operations/views", {
      method: "POST", cookie, body: { name, scope: "MY", query: { screen: "today", group: "ALL" } },
      headers: { "idempotency-key": key, "x-correlation-id": fixtures.runId },
    });
    assert.equal((await saveView(viewRequest(oldKey, "Synthetic old-key occupation"))).status, 201);
    const occupied = await db.operationalAuditEvent.findUniqueOrThrow({ where: {
      organizationId_idempotencyKey: { organizationId: owner.organizationId, idempotencyKey: oldKey },
    } });
    assert.equal(occupied.entityType, "saved_view");
    const beforeRejection = await snapshot(owner.organizationId);
    assert.equal((await saveView(viewRequest(newKey, "Synthetic server-key rejection"))).status, 400);
    assert.deepEqual(await snapshot(owner.organizationId), beforeRejection);
    const input = { status: "COMPLETED" as const, outcome: "Synthetic collision regression", version: meeting.version };
    const completed = await updateMeetingStatus(owner.context, meeting.id, input, completionMeta);
    assert.equal(completed.status, "COMPLETED");
    assert.equal((await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).operationalStatus, "COMPLETED");
    assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status, "COMPLETED");
    const childAudit = await db.operationalAuditEvent.findUniqueOrThrow({ where: {
      organizationId_idempotencyKey: { organizationId: owner.organizationId, idempotencyKey: newKey },
    } });
    assert.equal(childAudit.action, "task.completed_by_meeting_outcome");
    assert.equal(childAudit.entityId, String(task.id));
    assert.equal(await db.operationalAuditEvent.count({ where: {
      organizationId: owner.organizationId, action: "task.completed_by_meeting_outcome", entityId: String(task.id),
    } }), 1);
    assert.deepEqual(await db.operationalAuditEvent.findUniqueOrThrow({ where: { id: occupied.id } }), occupied);
    const beforeReplay = await snapshot(owner.organizationId);
    const meetingBeforeReplay = await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    const taskBeforeReplay = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual(await updateMeetingStatus(owner.context, meeting.id, input, completionMeta), { ...completed, replayed: true });
    assert.deepEqual(await snapshot(owner.organizationId), beforeReplay);
    assert.deepEqual(await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } }), meetingBeforeReplay);
    assert.deepEqual(await db.task.findUniqueOrThrow({ where: { id: task.id } }), taskBeforeReplay);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("historical successful meeting replay keeps its old child audit key without rewriting or adding an audit", opts, async () => {
  const fixtures = createFixtureContext("cpo-meeting-child-history");
  try {
    const owner = await fixtures.makeAgent("owner");
    const canonicalCase = await fixtures.makeCase(owner, "past-meeting");
    const meta = (suffix: string) => ({ idempotencyKey: `client:${fixtures.runId}:${suffix}`, correlationId: fixtures.runId });
    const meeting = await createMeeting(owner.context, {
      leadId: canonicalCase.leadId, scheduledAt: new Date(Date.now() - 3_600_000),
    }, meta("create"));
    assert.equal(await projectPastMeetingEscalation(owner.organizationId, meeting.id, new Date()), true);
    const task = await db.task.findFirstOrThrow({ where: {
      organizationId: owner.organizationId, sourceEventId: `meeting:${meeting.id}:past-due:v${meeting.version}`, type: "MEETING_ESCALATION",
    } });
    const completionMeta = meta("complete");
    const input = { status: "COMPLETED" as const, outcome: "Synthetic historical replay", version: meeting.version };
    const oldKey = `${completionMeta.idempotencyKey}:escalation:${task.id}`;
    const newKey = serverCommandKey("meeting-outcome-audit", oldKey);
    const completed = {
      id: meeting.id, caseId: canonicalCase.id, leadId: canonicalCase.leadId, status: "COMPLETED" as const,
      version: meeting.version + 1, scheduledAt: meeting.scheduledAt, ownerMembershipId: owner.membershipId,
    };
    // Seed committed pre-repair state without modifying append-only audit history or disabling its trigger.
    await db.$transaction(async (tx) => {
      const now = new Date();
      await tx.meeting.update({ where: { id: meeting.id }, data: {
        operationalStatus: "COMPLETED", status: "COMPLETED", outcome: input.outcome,
        outcomeRecordedAt: now, endedAt: now, version: { increment: 1 },
      } });
      await tx.task.update({ where: { id: task.id }, data: {
        status: "COMPLETED", completedAt: now, outcome: input.outcome, version: { increment: 1 },
      } });
      await appendOperationalAudit(tx, owner.context, {
        entityType: "task", entityId: String(task.id), action: "task.completed_by_meeting_outcome",
        before: {}, after: {}, correlationId: fixtures.runId, idempotencyKey: oldKey,
        result: { taskId: task.id, status: "COMPLETED" },
      });
      await appendOperationalAudit(tx, owner.context, {
        entityType: "meeting", entityId: String(meeting.id), action: "meeting.completed",
        before: {}, after: {}, correlationId: fixtures.runId, idempotencyKey: completionMeta.idempotencyKey,
        result: completed,
      });
    });
    const beforeReplay = await snapshot(owner.organizationId);
    const meetingBeforeReplay = await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    const taskBeforeReplay = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.deepEqual(await updateMeetingStatus(owner.context, meeting.id, input, completionMeta), { ...completed, replayed: true });
    assert.deepEqual(await snapshot(owner.organizationId), beforeReplay);
    assert.deepEqual(await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } }), meetingBeforeReplay);
    assert.deepEqual(await db.task.findUniqueOrThrow({ where: { id: task.id } }), taskBeforeReplay);
    assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: owner.organizationId, idempotencyKey: newKey } }), 0);
    assert.equal(await db.operationalAuditEvent.count({ where: {
      organizationId: owner.organizationId, action: "task.completed_by_meeting_outcome", entityId: String(task.id),
    } }), 1);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

async function snapshot(organizationId: string) {
  // Compare complete fixture rows without exposing synthetic token hashes in assertion output.
  const rows = [
    await db.savedOperationalView.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    await db.organizationInvite.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    await db.membership.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    await db.agent.findMany({ where: { membership: { organizationId } }, orderBy: { id: "asc" } }),
    await db.operationalAuditEvent.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
  ];
  return { counts: rows.map((items) => items.length), digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}

test("all raw shared-audit API ingresses reject reserved keys with zero writes, including historical keys", opts, async () => {
  const fixtures = createFixtureContext("cpo-namespace-reject");
  try {
    const organizationId = await fixtures.makeOrganization("team");
    const admin = await fixtures.makeMember("admin", { organizationId, role: "ADMIN" });
    const agent = await fixtures.makeMember("agent", { organizationId, role: "AGENT" });
    const adminCookie = await sessionCookieHeader(admin.userId, admin.agentId);
    const agentCookie = await sessionCookieHeader(agent.userId, agent.agentId);
    const request = (cookie: string, body: unknown, key: string, method = "POST") => makeRequest("/api/synthetic", {
      method, cookie, body, headers: { "idempotency-key": ` ${key} `, "x-correlation-id": fixtures.runId },
    });
    const seed = await inviteMember(request(adminCookie, { email: `${fixtures.runId}@synthetic.invalid`, role: "AGENT" }, `client:${fixtures.runId}:seed`));
    assert.equal(seed.status, 201);
    const { id: inviteId } = await seed.json() as { id: string };
    await db.operationalAuditEvent.create({ data: {
      organizationId, actorMembershipId: agent.membershipId, entityType: "saved_view", entityId: "synthetic-historical",
      action: "saved_view.created", before: {}, after: {}, result: { id: "synthetic-historical" },
      correlationId: fixtures.runId, idempotencyKey: reservedKeys[0],
    } });
    const boundaries = [
      { name: "saved view by AGENT", call: (key: string) => saveView(request(agentCookie, { name: "Synthetic view", scope: "MY", query: { screen: "today", group: "ALL" } }, key)) },
      { name: "invite create", call: (key: string) => inviteMember(request(adminCookie, { email: `${fixtures.runId}-new@synthetic.invalid`, role: "AGENT" }, key)) },
      ...(["RESEND", "REVOKE"] as const).map((action) => ({ name: `invite ${action}`, call: (key: string) => updateInvite(request(adminCookie, { action }, key, "PATCH"), { params: Promise.resolve({ inviteId }) }) })),
      { name: "membership role and suspension", call: (key: string) => updateMembership(request(adminCookie, { role: "MANAGER", status: "SUSPENDED", reason: "Synthetic regression" }, key, "PATCH"), { params: Promise.resolve({ membershipId: agent.membershipId }) }) },
    ];
    const before = await snapshot(organizationId);
    for (const boundary of boundaries) {
      for (const key of reservedKeys) {
        const response = await boundary.call(key);
        assert.equal(response.status, 400, boundary.name);
        assert.deepEqual(await snapshot(organizationId), before, `${boundary.name}: zero writes`);
      }
    }
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("normal shared-audit API commands and exact replays preserve one write per command", opts, async () => {
  const fixtures = createFixtureContext("cpo-namespace-replay");
  try {
    const organizationId = await fixtures.makeOrganization("team");
    const admin = await fixtures.makeMember("admin", { organizationId, role: "ADMIN" });
    const agent = await fixtures.makeMember("agent", { organizationId, role: "AGENT" });
    const cookie = await sessionCookieHeader(admin.userId, admin.agentId);
    const agentCookie = await sessionCookieHeader(agent.userId, agent.agentId);
    const request = (body: unknown, suffix: string, method = "POST", session = cookie) => makeRequest("/api/synthetic", {
      method, cookie: session, body, headers: { "idempotency-key": `client:${fixtures.runId}:${suffix}`, "x-correlation-id": fixtures.runId },
    });
    const exactReplay = async (call: () => Promise<Response>, status: number) => {
      const first = await call();
      assert.equal(first.status, status);
      const initial = await first.json() as { replayed: boolean; id?: string; view?: { id: string }; result?: unknown; token?: string };
      assert.equal(initial.replayed, false);
      const before = await snapshot(organizationId);
      const replay = await call();
      assert.equal(replay.status, 200);
      const repeated = await replay.json() as typeof initial;
      assert.equal(repeated.replayed, true);
      assert.equal(repeated.id, initial.id);
      assert.equal(repeated.view?.id, initial.view?.id);
      assert.deepEqual(repeated.result, initial.result);
      assert.equal(repeated.token, undefined);
      assert.deepEqual(await snapshot(organizationId), before);
      return initial;
    };
    await exactReplay(() => saveView(request({ name: "Synthetic view", scope: "MY", query: { screen: "today", group: "ALL" } }, "view", "POST", agentCookie)), 201);
    const created = await exactReplay(() => inviteMember(request({ email: `${fixtures.runId}@synthetic.invalid`, role: "AGENT" }, "invite")), 201);
    assert.equal(typeof created.token, "string");
    const params = { params: Promise.resolve({ inviteId: created.id! }) };
    const resent = await exactReplay(() => updateInvite(request({ action: "RESEND" }, "resend", "PATCH"), params), 200);
    assert.equal(typeof resent.token, "string");
    await exactReplay(() => updateInvite(request({ action: "REVOKE" }, "revoke", "PATCH"), params), 200);
    await exactReplay(() => updateMembership(request({ role: "MANAGER", reason: "Synthetic regression" }, "member", "PATCH"), { params: Promise.resolve({ membershipId: agent.membershipId }) }), 200);
    assert.equal(await db.operationalAuditEvent.count({ where: { organizationId } }), 5);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("shared audit writer still accepts genuine server-derived keys without client validation", opts, async () => {
  const fixtures = createFixtureContext("cpo-namespace-internal");
  try {
    const member = await fixtures.makeAgent("owner");
    for (const key of reservedKeys) {
      await db.$transaction((tx) => appendOperationalAudit(tx, member.context, {
        entityType: "task", entityId: "synthetic", action: "synthetic.internal", before: {}, after: {},
        correlationId: fixtures.runId, idempotencyKey: key, result: {},
      }));
    }
    assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: member.organizationId } }), reservedKeys.length);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});
