import assert from "node:assert/strict";
import { before, test } from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { POST as createOrganization } from "../../app/api/platform-admin/organizations/route";
import { POST as reissueInvitation } from "../../app/api/platform-admin/organizations/[organizationId]/first-admin-invite/route";
import { POST as register } from "../../app/api/agent/auth/register/route";
import { POST as invite } from "../../app/api/agent/invitations/route";
import { POST as login } from "../../app/api/agent/auth/login/route";
import { ADMIN_CONFIRMATION } from "../../lib/organizationAdmin";
import { hashInvitationToken } from "../../lib/invitations";
import { SESSION_COOKIE, signSession } from "../../lib/session";
import { createFixtureContext, db, makeRequest, sessionCookieHeader, skip } from "./_setup";

const opts = { skip: skip ? "requires approved isolated PostgreSQL" : false };
const faults = new AsyncLocalStorage<boolean>();
before(() => {
  if (!skip) db.$use(async (params, next) => {
    if (faults.getStore() && params.model === "PlatformAuditEvent" && params.action === "create") {
      throw new Prisma.PrismaClientInitializationError("Synthetic database write unavailable", "5.22.0", "P1001");
    }
    return next(params);
  });
});
const password = "Synthetic-Onboarding-Password-2026!";

async function fixture(tag: string) {
  const f = createFixtureContext(`org-onboarding-${tag}`);
  const outsider = await f.makeMember("outsider");
  const owner = await db.user.create({ data: { email: `${f.runId}-owner@test.invalid`, platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() } });
  f.trackUser(owner.id);
  const cookie = `${SESSION_COOKIE}=${await signSession({ userId: owner.id, sessionVersion: owner.sessionVersion, version: 2, mfaVerified: true })}`;
  const noMfa = `${SESSION_COOKIE}=${await signSession({ userId: owner.id, sessionVersion: owner.sessionVersion, version: 2 })}`;
  const body = { name: "Synthetic new organization", slug: `new-${f.runId}`, timezone: "Europe/Moscow", email: `${f.runId}-admin@test.invalid`, confirmation: ADMIN_CONFIRMATION, reason: "Owner approved synthetic onboarding" };
  const request = (changes = {}, key = "create", auth = cookie) => makeRequest("/api/platform-admin/organizations", {
    method: "POST", cookie: auth, headers: { "idempotency-key": `${f.runId}:${key}`, "x-correlation-id": `${f.runId}:trace`, "x-forwarded-for": f.runId }, body: { ...body, ...changes },
  });
  async function trackOrganization() {
    const organization = await db.organization.findUnique({ where: { slug: body.slug }, select: { id: true } });
    if (organization) f.trackCreatedOrganization(organization.id);
    return organization;
  }
  async function trackUser(email: string) {
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { agent: { include: { membership: true } } } });
    assert.ok(user.agent?.membership);
    f.trackCreatedMember({ userId: user.id, agentId: user.agent.id, membershipId: user.agent.membership.id });
    return user;
  }
  const token = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get("invite")!;
  const accept = (email: string, inviteToken: string) => register(makeRequest("/api/agent/auth/register", {
    method: "POST", headers: { "x-forwarded-for": `${f.runId}:${email}` }, body: { name: "Synthetic staff", email, password, inviteToken },
  }));
  return { f, outsider, owner, cookie, noMfa, body, request, trackOrganization, trackUser, token, accept };
}

test("real onboarding API: MFA SUPER_ADMIN creates organization and hash-only first ADMIN invite; ADMIN invites all operational roles", opts, async () => {
  const x = await fixture("happy");
  try {
    const response = await createOrganization(x.request());
    const created = await response.json();
    await x.trackOrganization();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(created.replayed, false);
    const token = x.token(created.inviteUrl);
    const row = await db.platformOrganizationInvite.findUniqueOrThrow({ where: { tokenHash: hashInvitationToken(token) } });
    assert.equal(row.createdByUserId, x.owner.id);
    assert.equal(row.role, "ADMIN");
    assert.equal(JSON.stringify(row).includes(token), false);
    const accepted = await x.accept(x.body.email, token);
    const admin = await x.trackUser(x.body.email);
    assert.equal(accepted.status, 200);
    assert.equal(admin.platformRole, "USER");
    assert.equal(admin.agent!.membership!.role, "ADMIN");
    assert.equal(admin.agent!.membership!.organizationId, created.organizationId);
    assert.equal((await login(makeRequest("/api/agent/auth/login", { method: "POST", body: { email: x.body.email, password } }))).status, 200);
    const adminCookie = await sessionCookieHeader(admin.id, admin.agent!.id);
    for (const role of ["AGENT", "MANAGER", "FINANCE", "DOCUMENT_REVIEWER"] as const) {
      const email = `${x.f.runId}-${role.toLowerCase()}@test.invalid`;
      const invited = await invite(makeRequest("/api/agent/invitations", {
        method: "POST", cookie: adminCookie, headers: { "idempotency-key": `${x.f.runId}:${role}`, "x-correlation-id": x.f.runId }, body: { email, role },
      }));
      assert.equal(invited.status, 201);
      const inviteBody = await invited.json();
      const registered = await x.accept(email, inviteBody.token);
      const user = await x.trackUser(email);
      assert.equal(registered.status, 200);
      assert.equal(user.platformRole, "USER");
      assert.equal(user.agent!.membership!.role, role);
      assert.equal(user.agent!.membership!.organizationId, created.organizationId);
      const loggedIn = await login(makeRequest("/api/agent/auth/login", { method: "POST", body: { email, password } }));
      assert.equal(loggedIn.status, 200);
      const loginBody = await loggedIn.json();
      if (role === "FINANCE") assert.equal(loginBody.redirectTo, "/setup/platform-admin-mfa");
      if (role === "DOCUMENT_REVIEWER") assert.equal(loginBody.redirectTo, "/agent/document-review");
    }
    assert.equal((await x.accept(x.body.email, token)).status, 403);
    const audit = await db.platformAuditEvent.findMany({ where: { actorUserId: x.owner.id } });
    assert.equal(audit.filter(event => event.action === "ORGANIZATION_CREATED_WITH_ADMIN_INVITE").length, 1);
    assert.equal(JSON.stringify(audit).includes(token), false);
    assert.equal(JSON.stringify(audit).includes(x.body.email), false);
    assert.equal(await db.membership.count({ where: { organizationId: created.organizationId, role: "ADMIN" } }), 1);
  } finally { await x.trackOrganization(); await x.f.cleanup(); await x.f.assertNoResidue(); }
});

test("onboarding refuses non-platform, missing MFA, stale role/version, invalid timezone and mass assignment before creating any organization", opts, async () => {
  const x = await fixture("denied");
  try {
    assert.equal((await createOrganization(x.request({}, "none", ""))).status, 401);
    assert.equal((await createOrganization(x.request({}, "member", await sessionCookieHeader(x.outsider.userId, x.outsider.agentId)))).status, 403);
    assert.equal((await createOrganization(x.request({}, "mfa", x.noMfa))).status, 403);
    for (const change of [{ timezone: "Not/A_Timezone" }, { platformRole: "SUPER_ADMIN" }, { role: "ADMIN" }, { confirmation: "yes" }]) {
      assert.equal((await createOrganization(x.request(change))).status, 400);
    }
    await db.user.update({ where: { id: x.owner.id }, data: { sessionVersion: { increment: 1 } } });
    assert.equal((await createOrganization(x.request())).status, 401);
    assert.equal(await db.organization.count({ where: { slug: x.body.slug } }), 0);
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: x.owner.id } }), 0);
  } finally { await x.f.cleanup(); await x.f.assertNoResidue(); }
});

test("concurrent duplicate create returns one token/organization/audit and truthful replay; changed payload conflicts", opts, async () => {
  const x = await fixture("parallel");
  try {
    const responses = await Promise.all([createOrganization(x.request()), createOrganization(x.request()), createOrganization(x.request())]);
    const bodies = await Promise.all(responses.map(response => response.json()));
    await x.trackOrganization();
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 200, 201]);
    assert.equal(bodies.filter(body => body.replayed === false && body.inviteUrl).length, 1);
    assert.equal(bodies.filter(body => body.replayed === true && body.inviteUrl === null).length, 2);
    assert.equal(new Set(bodies.map(body => body.organizationId)).size, 1);
    assert.equal((await createOrganization(x.request({ name: "Changed payload" }))).status, 409);
    assert.equal((await createOrganization(x.request({}, "new-key"))).status, 409);
    assert.equal(await db.platformOrganizationInvite.count({ where: { organizationId: bodies[0].organizationId } }), 1);
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: x.owner.id, action: "ORGANIZATION_CREATED_WITH_ADMIN_INVITE" } }), 1);
  } finally { await x.trackOrganization(); await x.f.cleanup(); await x.f.assertNoResidue(); }
});

test("first ADMIN reissue revokes old bearer, preserves tenant boundary and refuses any existing ADMIN", opts, async () => {
  const x = await fixture("reissue");
  try {
    const response = await createOrganization(x.request());
    const created = await response.json();
    await x.trackOrganization();
    assert.equal(response.status, 201);
    const params = { params: Promise.resolve({ organizationId: created.organizationId }) };
    const req = (email: string, key: string) => makeRequest(`/api/platform-admin/organizations/${created.organizationId}/first-admin-invite`, {
      method: "POST", cookie: x.cookie, headers: { "idempotency-key": `${x.f.runId}:${key}`, "x-correlation-id": x.f.runId, "x-forwarded-for": x.f.runId },
      body: { email, confirmation: ADMIN_CONFIRMATION, reason: "Replace lost invitation" },
    });
    const nextEmail = `${x.f.runId}-replacement@test.invalid`;
    const results = await Promise.all([reissueInvitation(req(nextEmail, "reissue"), params), reissueInvitation(req(nextEmail, "reissue"), params)]);
    const resultsBody = await Promise.all(results.map(r => r.json()));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 201]);
    const newToken = x.token(resultsBody.find(body => body.inviteUrl)!.inviteUrl);
    assert.equal((await x.accept(x.body.email, x.token(created.inviteUrl))).status, 403);
    const accepted = await x.accept(nextEmail, newToken);
    await x.trackUser(nextEmail);
    assert.equal(accepted.status, 200);
    assert.equal((await reissueInvitation(req(nextEmail, "after-admin"), params)).status, 409);
    assert.equal(await db.membership.count({ where: { organizationId: created.organizationId, role: "ADMIN" } }), 1);
    assert.equal((await db.membership.findUniqueOrThrow({ where: { id: x.outsider.membershipId } })).role, "AGENT");
  } finally { await x.trackOrganization(); await x.f.cleanup(); await x.f.assertNoResidue(); }
});

test("onboarding audit failure rolls back organization and invitation; existing account is never moved or modified", opts, async () => {
  const x = await fixture("rollback");
  try {
    const before = await db.user.findUniqueOrThrow({ where: { id: x.outsider.userId } });
    assert.equal((await faults.run(true, () => createOrganization(x.request()))).status, 503);
    assert.equal(await db.organization.count({ where: { slug: x.body.slug } }), 0);
    assert.equal(await db.platformOrganizationInvite.count({ where: { createdByUserId: x.owner.id } }), 0);
    assert.equal((await createOrganization(x.request({ email: before.email! }, "existing-account"))).status, 409);
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: x.outsider.userId } }), before);
    assert.equal(await db.organization.count({ where: { slug: x.body.slug } }), 0);
  } finally { await x.f.cleanup(); await x.f.assertNoResidue(); }
});
