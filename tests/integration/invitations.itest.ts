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

    if (acceptedUser.agent?.membership) {
      await db.membership.delete({ where: { id: acceptedUser.agent.membership.id } });
    }
    if (acceptedUser.agent) await db.agent.delete({ where: { id: acceptedUser.agent.id } });
    await db.user.delete({ where: { id: acceptedUser.id } });
  } finally {
    const leftover = await db.user.findUnique({
      where: { email: acceptedEmail },
      select: { id: true, agent: { select: { id: true, membership: { select: { id: true } } } } },
    });
    if (leftover?.agent?.membership) await db.membership.delete({ where: { id: leftover.agent.membership.id } });
    if (leftover?.agent) await db.agent.delete({ where: { id: leftover.agent.id } });
    if (leftover) await db.user.delete({ where: { id: leftover.id } });
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
