import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { POST as createInvitation } from "../../app/api/agent/invitations/route";
import { POST as register } from "../../app/api/agent/auth/register/route";
import { hashInvitationToken } from "../../lib/invitations";
import {
  createFixtureContext,
  db,
  makeRequest,
  sessionCookieHeader,
  skip,
} from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

test("M1 invitations are admin-only, tenant-scoped, single-use, recipient-bound and expiry-bound", opts, async () => {
  const fixtures = createFixtureContext("m1-invitations");
  const acceptedEmail = `invite-accepted-${randomBytes(6).toString("hex")}@test.invalid`;
  const wrongRecipientEmail = `invite-wrong-${randomBytes(6).toString("hex")}@test.invalid`;
  const expiredEmail = `invite-expired-${randomBytes(6).toString("hex")}@test.invalid`;
  try {
    const organizationId = await fixtures.makeOrganization("invite-team");
    const agent = await fixtures.makeMember("agent", { organizationId, role: "AGENT" });
    const admin = await fixtures.makeMember("admin", { organizationId, role: "ADMIN" });
    const agentCookie = await sessionCookieHeader(agent.userId, agent.agentId);
    const adminCookie = await sessionCookieHeader(admin.userId, admin.agentId);
    const commandId = `invite:${fixtures.runId}:accepted`;
    const invitationRequest = () => makeRequest("/api/agent/invitations", {
      method: "POST",
      cookie: adminCookie,
      headers: { "idempotency-key": commandId, "x-correlation-id": commandId },
      body: { email: acceptedEmail, role: "AGENT", expiresInHours: 24 },
    });

    const denied = await createInvitation(makeRequest("/api/agent/invitations", {
      method: "POST",
      cookie: agentCookie,
      headers: { "idempotency-key": `${commandId}:denied`, "x-correlation-id": `${commandId}:denied` },
      body: { email: acceptedEmail, role: "AGENT", expiresInHours: 24 },
    }));
    assert.equal(denied.status, 403);

    const conflictKey = `invite:${fixtures.runId}:conflict`;
    await db.operationalAuditEvent.create({
      data: {
        organizationId,
        actorMembershipId: admin.membershipId,
        entityType: "task",
        entityId: "synthetic-task",
        action: "task.created",
        before: {},
        after: {},
        correlationId: conflictKey,
        idempotencyKey: conflictKey,
        result: { id: 1 },
      },
    });
    const conflictingReplay = await createInvitation(makeRequest("/api/agent/invitations", {
      method: "POST",
      cookie: adminCookie,
      headers: { "idempotency-key": conflictKey, "x-correlation-id": conflictKey },
      body: { email: acceptedEmail, role: "AGENT", expiresInHours: 24 },
    }));
    assert.equal(conflictingReplay.status, 409);
    assert.equal(await db.organizationInvite.count({ where: { organizationId } }), 0);

    const created = await createInvitation(invitationRequest());
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { id: string; token: string; replayed: boolean };
    assert.equal(createdBody.replayed, false);
    assert.ok(createdBody.token.length >= 32);

    const replay = await createInvitation(invitationRequest());
    assert.equal(replay.status, 200);
    const replayBody = await replay.json() as { id: string; token?: string; replayed: boolean };
    assert.equal(replayBody.id, createdBody.id);
    assert.equal(replayBody.replayed, true);
    assert.equal(replayBody.token, undefined);
    assert.equal(await db.organizationInvite.count({ where: { organizationId, emailNormalized: acceptedEmail } }), 1);

    const accepted = await register(registrationRequest(acceptedEmail, createdBody.token));
    assert.equal(accepted.status, 200);
    const acceptedUser = await db.user.findUniqueOrThrow({
      where: { email: acceptedEmail },
      select: { id: true, agent: { select: { id: true, membership: { select: { id: true, organizationId: true, role: true, status: true } } } } },
    });
    assert.equal(acceptedUser.agent?.membership?.organizationId, organizationId);
    assert.equal(acceptedUser.agent?.membership?.role, "AGENT");
    assert.equal(acceptedUser.agent?.membership?.status, "ACTIVE");
    assert.ok(acceptedUser.agent?.membership);
    fixtures.trackCreatedMember({
      userId: acceptedUser.id,
      agentId: acceptedUser.agent.id,
      membershipId: acceptedUser.agent.membership.id,
    });
    assert.ok((await db.organizationInvite.findUniqueOrThrow({ where: { id: createdBody.id } })).acceptedAt);

    const reused = await register(registrationRequest(acceptedEmail, createdBody.token));
    assert.equal(reused.status, 403);
    assert.equal(await db.user.count({ where: { email: acceptedEmail } }), 1);

    const wrongToken = randomBytes(32).toString("base64url");
    await db.organizationInvite.create({
      data: {
        organizationId,
        emailNormalized: `expected-${wrongRecipientEmail}`,
        tokenHash: hashInvitationToken(wrongToken),
        role: "AGENT",
        expiresAt: new Date(Date.now() + 3_600_000),
        createdByMembershipId: admin.membershipId,
      },
    });
    const wrongRecipient = await register(registrationRequest(wrongRecipientEmail, wrongToken));
    assert.equal(wrongRecipient.status, 403);
    assert.equal(await db.user.count({ where: { email: wrongRecipientEmail } }), 0);

    const expiredToken = randomBytes(32).toString("base64url");
    await db.organizationInvite.create({
      data: {
        organizationId,
        emailNormalized: expiredEmail,
        tokenHash: hashInvitationToken(expiredToken),
        role: "AGENT",
        expiresAt: new Date(Date.now() - 1_000),
        createdByMembershipId: admin.membershipId,
      },
    });
    const expired = await register(registrationRequest(expiredEmail, expiredToken));
    assert.equal(expired.status, 403);
    assert.equal(await db.user.count({ where: { email: expiredEmail } }), 0);

  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

function registrationRequest(email: string, inviteToken: string) {
  return makeRequest("/api/agent/auth/register", {
    method: "POST",
    headers: { "x-forwarded-for": `127.0.0.${Math.floor(Math.random() * 200) + 1}` },
    body: {
      name: "Synthetic Invitee",
      email,
      password: "Synthetic-Invite-Password-42!",
      inviteToken,
    },
  });
}

test("invitation retries bind recipient, role and lifetime, including concurrent unique races", opts, async () => {
  const f = createFixtureContext("invitation-payload-race");
  try {
    const admin = await f.makeMember("admin", { role: "ADMIN" });
    const cookie = await sessionCookieHeader(admin.userId, admin.agentId);
    const body = { email: `${f.runId}@test.invalid`, role: "AGENT", expiresInHours: 24 };
    const request = (changes = {}, key = "same") => makeRequest("/api/agent/invitations", {
      method: "POST", cookie, headers: { "idempotency-key": `${f.runId}:${key}`, "x-correlation-id": f.runId }, body: { ...body, ...changes },
    });
    const first = await createInvitation(request());
    assert.equal(first.status, 201);
    const created = await first.json();
    for (const changes of [{ email: `other-${body.email}` }, { role: "MANAGER" }, { expiresInHours: 48 }]) {
      assert.equal((await createInvitation(request(changes))).status, 409);
    }
    const replay = await createInvitation(request());
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { id: created.id, replayed: true });
    const race = await Promise.all([
      createInvitation(request({}, "race")),
      createInvitation(request({ role: "MANAGER" }, "race")),
    ]);
    assert.deepEqual(race.map(response => response.status).sort(), [201, 409]);
    assert.equal(await db.organizationInvite.count({ where: { organizationId: admin.organizationId } }), 2);
    assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: admin.organizationId, action: "MEMBER_INVITED" } }), 2);
  } finally { await f.cleanup(); await f.assertNoResidue(); }
});
