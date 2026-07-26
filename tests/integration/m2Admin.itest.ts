import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { POST as login } from "../../app/api/agent/auth/login/route";
import { GET as platformDashboard } from "../../app/api/platform-admin/dashboard/route";
import {
  GET as platformOrganization,
  PATCH as updateOrganization,
} from "../../app/api/platform-admin/organizations/[organizationId]/route";
import { POST as createInvitation } from "../../app/api/agent/invitations/route";
import { GET as readTeam } from "../../app/api/agent/organization/team/route";
import { PATCH as updateMembership } from "../../app/api/agent/organization/memberships/[membershipId]/route";
import { bootstrapPlatformSuperAdmin } from "../../lib/platformBootstrap";
import { hashPassword } from "../../lib/password";
import { signSession, SESSION_COOKIE } from "../../lib/session";
import {
  createFixtureContext,
  db,
  makeRequest,
  sessionCookieHeader,
  skip,
} from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };

test("M2 platform role is separate from tenant roles and supports platform-only login", opts, async () => {
  const fixtures = createFixtureContext("m2-platform");
  const password = "M2-Synthetic-Password-42!";
  const email = `m2-platform-${randomBytes(6).toString("hex")}@test.invalid`;
  try {
    const user = await db.user.create({
      data: { email, name: "M2 Platform Owner", passwordHash: hashPassword(password) },
      select: { id: true },
    });
    fixtures.trackUser(user.id);

    const first = await db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, email.toUpperCase()));
    const replay = await db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, ` ${email} `));
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: user.id, action: "PLATFORM_ROLE_BOOTSTRAPPED" } }), 1);

    const loginResponse = await login(makeRequest("/api/agent/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.10.1" },
      body: { email, password },
    }));
    assert.equal(loginResponse.status, 200);
    assert.equal((await loginResponse.clone().json()).redirectTo, "/platform-admin");
    const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    assert.equal(await db.agent.count({ where: { userId: user.id } }), 0);
    assert.equal(await db.membership.count({ where: { userId: user.id } }), 0);

    const dashboard = await platformDashboard(makeRequest("/api/platform-admin/dashboard", { cookie }));
    assert.equal(dashboard.status, 200);
    await db.user.update({ where: { id: user.id }, data: { platformRole: "USER" } });
    assert.equal((await platformDashboard(makeRequest("/api/platform-admin/dashboard", { cookie }))).status, 403);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M2 organization administration is tenant-scoped and enforces capabilities and last-admin", opts, async () => {
  const fixtures = createFixtureContext("m2-tenant-admin");
  try {
    const organizationA = await fixtures.makeOrganization("alpha");
    const organizationB = await fixtures.makeOrganization("beta");
    const adminA = await fixtures.makeMember("admin-a", { organizationId: organizationA, role: "ADMIN" });
    const managerA = await fixtures.makeMember("manager-a", { organizationId: organizationA, role: "MANAGER" });
    const agentA = await fixtures.makeMember("agent-a", { organizationId: organizationA, role: "AGENT" });
    const adminB = await fixtures.makeMember("admin-b", { organizationId: organizationB, role: "ADMIN" });
    const adminCookie = await sessionCookieHeader(adminA.userId, adminA.agentId);
    const managerCookie = await sessionCookieHeader(managerA.userId, managerA.agentId);
    const agentCookie = await sessionCookieHeader(agentA.userId, agentA.agentId);

    const forgedPlatformToken = await signSession({
      userId: adminA.userId,
      activeMembershipId: adminA.membershipId,
      role: "SUPER_ADMIN",
      version: 2,
    });
    const forgedPlatformCookie = `${SESSION_COOKIE}=${forgedPlatformToken}`;
    assert.equal((await platformDashboard(makeRequest("/api/platform-admin/dashboard", { cookie: forgedPlatformCookie }))).status, 403);
    assert.equal((await platformDashboard(makeRequest("/api/platform-admin/dashboard", { cookie: managerCookie }))).status, 403);
    assert.equal((await platformDashboard(makeRequest("/api/platform-admin/dashboard", { cookie: agentCookie }))).status, 403);

    const ownTeam = await readTeam(makeRequest("/api/agent/organization/team", { cookie: adminCookie }));
    assert.equal(ownTeam.status, 200);
    const ownBody = await ownTeam.json() as { id: string; memberships: Array<{ id: string }> };
    assert.equal(ownBody.id, organizationA);
    assert.equal(ownBody.memberships.some((membership) => membership.id === adminB.membershipId), false);
    assert.equal((await readTeam(makeRequest("/api/agent/organization/team", { cookie: managerCookie }))).status, 403);

    const inviteId = `m2-invite:${fixtures.runId}`;
    const managerInvite = await createInvitation(commandRequest("/api/agent/invitations", managerCookie, inviteId, {
      email: `manager-denied-${fixtures.runId}@test.invalid`,
      role: "ADMIN",
      confirmation: "НАЗНАЧИТЬ АДМИНИСТРАТОРА",
      expiresInHours: 24,
    }, "POST"));
    assert.equal(managerInvite.status, 403);
    const agentInvite = await createInvitation(commandRequest("/api/agent/invitations", agentCookie, `${inviteId}:agent`, {
      email: `agent-denied-${fixtures.runId}@test.invalid`,
      role: "AGENT",
      expiresInHours: 24,
    }, "POST"));
    assert.equal(agentInvite.status, 403);

    const crossTenant = await updateMembership(
      commandRequest(`/api/agent/organization/memberships/${adminB.membershipId}`, adminCookie, `${inviteId}:cross`, {
        role: "AGENT",
        reason: "Проверка tenant isolation",
      }),
      { params: Promise.resolve({ membershipId: adminB.membershipId }) },
    );
    assert.equal(crossTenant.status, 404);

    const lastAdmin = await updateMembership(
      commandRequest(`/api/agent/organization/memberships/${adminA.membershipId}`, adminCookie, `${inviteId}:last`, {
        role: "MANAGER",
        reason: "Проверка последнего администратора",
      }),
      { params: Promise.resolve({ membershipId: adminA.membershipId }) },
    );
    assert.equal(lastAdmin.status, 409);

    const promote = await updateMembership(
      commandRequest(`/api/agent/organization/memberships/${managerA.membershipId}`, adminCookie, `${inviteId}:promote`, {
        role: "ADMIN",
        confirmation: "НАЗНАЧИТЬ АДМИНИСТРАТОРА",
        reason: "Второй администратор для continuity",
        platformRole: "SUPER_ADMIN",
      }),
      { params: Promise.resolve({ membershipId: managerA.membershipId }) },
    );
    assert.equal(promote.status, 200);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: managerA.userId }, select: { platformRole: true } })).platformRole, "USER");

    const suspend = await updateMembership(
      commandRequest(`/api/agent/organization/memberships/${agentA.membershipId}`, adminCookie, `${inviteId}:suspend`, {
        status: "SUSPENDED",
        reason: "Проверка остановки operational доступа",
      }),
      { params: Promise.resolve({ membershipId: agentA.membershipId }) },
    );
    assert.equal(suspend.status, 200);
    assert.equal((await readTeam(makeRequest("/api/agent/organization/team", { cookie: agentCookie }))).status, 401);
    assert.equal((await db.membership.findUniqueOrThrow({ where: { id: agentA.membershipId } })).status, "SUSPENDED");
    assert.equal((await db.agent.findUniqueOrThrow({ where: { id: agentA.agentId } })).status, "SUSPENDED");
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M2 organization suspension is platform-only and revokes stale operational sessions", opts, async () => {
  const fixtures = createFixtureContext("m2-org-suspend");
  const password = "M2-Platform-Suspend-42!";
  const email = `m2-suspend-${randomBytes(6).toString("hex")}@test.invalid`;
  try {
    const organizationId = await fixtures.makeOrganization("suspend");
    const admin = await fixtures.makeMember("admin", { organizationId, role: "ADMIN" });
    const user = await db.user.create({
      data: { email, passwordHash: hashPassword(password), platformRole: "SUPER_ADMIN" },
      select: { id: true },
    });
    fixtures.trackUser(user.id);
    const platformCookie = `${SESSION_COOKIE}=${await signSession({ userId: user.id, version: 2 })}`;
    const adminCookie = await sessionCookieHeader(admin.userId, admin.agentId);

    const suspend = await updateOrganization(
      makeRequest(`/api/platform-admin/organizations/${organizationId}`, {
        method: "PATCH",
        cookie: platformCookie,
        body: { status: "SUSPENDED", confirmation: "ПРИОСТАНОВИТЬ ОРГАНИЗАЦИЮ" },
      }),
      { params: Promise.resolve({ organizationId }) },
    );
    assert.equal(suspend.status, 200);
    assert.equal((await readTeam(makeRequest("/api/agent/organization/team", { cookie: adminCookie }))).status, 401);

    const detail = await platformOrganization(
      makeRequest(`/api/platform-admin/organizations/${organizationId}`, { cookie: platformCookie }),
      { params: Promise.resolve({ organizationId }) },
    );
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).status, "SUSPENDED");

    const resume = await updateOrganization(
      makeRequest(`/api/platform-admin/organizations/${organizationId}`, {
        method: "PATCH",
        cookie: platformCookie,
        body: { status: "ACTIVE", confirmation: "ВОЗОБНОВИТЬ ОРГАНИЗАЦИЮ" },
      }),
      { params: Promise.resolve({ organizationId }) },
    );
    assert.equal(resume.status, 200);
    assert.equal((await readTeam(makeRequest("/api/agent/organization/team", { cookie: adminCookie }))).status, 200);

    const audit = await db.platformAuditEvent.findMany({ where: { actorUserId: user.id }, select: { metadata: true } });
    assert.equal(JSON.stringify(audit).match(/password|token|cookie|otp|secret/gi)?.length ?? 0, 0);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

function commandRequest(url: string, cookie: string, commandId: string, body: unknown, method = "PATCH") {
  return makeRequest(url, {
    method,
    cookie,
    headers: { "idempotency-key": commandId, "x-correlation-id": commandId },
    body,
  });
}
