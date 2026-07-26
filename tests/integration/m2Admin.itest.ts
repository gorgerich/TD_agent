import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { POST as login } from "../../app/api/agent/auth/login/route";
import { POST as activatePlatformAccount } from "../../app/api/platform-admin/activation/route";
import { GET as platformDashboard } from "../../app/api/platform-admin/dashboard/route";
import {
  GET as platformOrganization,
  PATCH as updateOrganization,
} from "../../app/api/platform-admin/organizations/[organizationId]/route";
import { POST as createInvitation } from "../../app/api/agent/invitations/route";
import { GET as readTeam } from "../../app/api/agent/organization/team/route";
import { PATCH as updateMembership } from "../../app/api/agent/organization/memberships/[membershipId]/route";
import { bootstrapPlatformSuperAdmin } from "../../lib/platformBootstrap";
import { hashPassword, verifyPassword } from "../../lib/password";
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

test("M2 first platform admin activation is hash-only, one-time and preserves existing credentials", opts, async () => {
  const fixtures = createFixtureContext("m2-platform-activation");
  const email = `m2-activation-${randomBytes(6).toString("hex")}@test.invalid`;
  const existingEmail = `m2-existing-${randomBytes(6).toString("hex")}@test.invalid`;
  const password = "M2-First-Owner-Private-Password-42!";
  const existingPassword = "M2-Existing-Owner-Password-42!";
  const blockedEmail = `m2-blocked-${randomBytes(6).toString("hex")}@test.invalid`;
  try {
    await assert.rejects(
      db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, blockedEmail)),
      /CONFIRM_PLATFORM_ADMIN_ACTIVATION_OUTPUT=YES/,
    );
    assert.equal(await db.user.count({ where: { email: blockedEmail } }), 0);

    const first = await db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, email.toUpperCase(), {
      allowActivationOutput: true,
    }));
    fixtures.trackUser(first.userId);
    assert.ok(first.activation);
    const provisioned = await db.user.findUniqueOrThrow({
      where: { id: first.userId },
      select: { email: true, passwordHash: true, platformRole: true },
    });
    assert.equal(provisioned.email, email);
    assert.equal(provisioned.passwordHash, null);
    assert.equal(provisioned.platformRole, "SUPER_ADMIN");
    assert.equal(await db.agent.count({ where: { userId: first.userId } }), 0);
    assert.equal(await db.membership.count({ where: { userId: first.userId } }), 0);

    const firstActivation = await db.platformAccountActivation.findFirstOrThrow({
      where: { userId: first.userId },
    });
    assert.equal(firstActivation.tokenHash.length, 64);
    assert.notEqual(firstActivation.tokenHash, first.activation.token);
    assert.equal(JSON.stringify(firstActivation).includes(first.activation.token), false);
    const firstAudit = await db.platformAuditEvent.findMany({
      where: { actorUserId: first.userId },
      select: { action: true, metadata: true },
    });
    assert.equal(JSON.stringify(firstAudit).includes(first.activation.token), false);
    assert.equal(firstAudit.some((event) => event.action === "PLATFORM_ADMIN_USER_PROVISIONED"), true);
    assert.equal(firstAudit.some((event) => event.action === "PLATFORM_ACCOUNT_ACTIVATION_CREATED"), true);

    const replacement = await db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, email, {
      allowActivationOutput: true,
    }));
    assert.ok(replacement.activation);
    assert.notEqual(replacement.activation.token, first.activation.token);
    assert.equal((await db.platformAccountActivation.findUniqueOrThrow({
      where: { id: firstActivation.id },
      select: { revokedAt: true },
    })).revokedAt instanceof Date, true);

    const revoked = await activatePlatformAccount(makeRequest("/api/platform-admin/activation", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.20.1" },
      body: { action: "VERIFY", token: first.activation.token },
    }));
    assert.equal(revoked.status, 400);

    const activation = await activatePlatformAccount(makeRequest("/api/platform-admin/activation", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.20.2" },
      body: {
        action: "ACTIVATE",
        token: replacement.activation.token,
        password,
        confirmation: password,
      },
    }));
    assert.equal(activation.status, 200);
    assert.equal((await activation.clone().json()).redirectTo, "/platform-admin");
    assert.ok(activation.headers.get("set-cookie"));
    const activated = await db.user.findUniqueOrThrow({
      where: { id: first.userId },
      select: { passwordHash: true },
    });
    assert.equal(verifyPassword(password, activated.passwordHash), true);
    assert.equal((await db.platformAccountActivation.findFirstOrThrow({
      where: { userId: first.userId, consumedAt: { not: null } },
      select: { consumedAt: true },
    })).consumedAt instanceof Date, true);

    const replay = await activatePlatformAccount(makeRequest("/api/platform-admin/activation", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.20.3" },
      body: {
        action: "ACTIVATE",
        token: replacement.activation.token,
        password,
        confirmation: password,
      },
    }));
    assert.equal(replay.status, 400);
    assert.deepEqual(await replay.json(), await revoked.json());

    const loginResponse = await login(makeRequest("/api/agent/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.20.4" },
      body: { email, password },
    }));
    assert.equal(loginResponse.status, 200);
    assert.equal((await loginResponse.json()).redirectTo, "/platform-admin");

    const expired = await db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, `${email}.expired`, {
      allowActivationOutput: true,
      now: new Date(Date.now() - 60_000),
      activationTtlMs: 1,
    }));
    fixtures.trackUser(expired.userId);
    assert.ok(expired.activation);
    const expiredResponse = await activatePlatformAccount(makeRequest("/api/platform-admin/activation", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.20.5" },
      body: { action: "VERIFY", token: expired.activation.token },
    }));
    assert.equal(expiredResponse.status, 400);

    const existingHash = hashPassword(existingPassword);
    const existing = await db.user.create({
      data: { email: existingEmail, passwordHash: existingHash },
      select: { id: true },
    });
    fixtures.trackUser(existing.id);
    const existingBootstrap = await db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, existingEmail));
    const existingReplay = await db.$transaction((tx) => bootstrapPlatformSuperAdmin(tx, existingEmail));
    assert.equal(existingBootstrap.activation, undefined);
    assert.equal(existingReplay.replayed, true);
    assert.equal((await db.user.findUniqueOrThrow({
      where: { id: existing.id },
      select: { passwordHash: true, platformRole: true },
    })).passwordHash, existingHash);
    assert.equal(verifyPassword(existingPassword, existingHash), true);
    assert.equal(await db.platformAuditEvent.count({
      where: { actorUserId: existing.id, action: "PLATFORM_ROLE_BOOTSTRAPPED" },
    }), 1);

    const massAssignment = await activatePlatformAccount(makeRequest("/api/platform-admin/activation", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.20.6" },
      body: { action: "VERIFY", token: "x".repeat(43), platformRole: "SUPER_ADMIN", email },
    }));
    assert.equal(massAssignment.status, 400);

    let rateLimitedStatus = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await activatePlatformAccount(makeRequest("/api/platform-admin/activation", {
        method: "POST",
        headers: { "x-forwarded-for": "127.0.20.7" },
        body: { action: "VERIFY", token: "z".repeat(43) },
      }));
      rateLimitedStatus = response.status;
    }
    assert.equal(rateLimitedStatus, 429);
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
