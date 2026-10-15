import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { runOperationalTransaction } from "../../lib/operationalTransaction";
import { POST as assign } from "../../app/api/platform-admin/organizations/[organizationId]/first-admin/route";
import { POST as invite } from "../../app/api/agent/invitations/route";
import { POST as register } from "../../app/api/agent/auth/register/route";
import { PATCH as changeMembership } from "../../app/api/agent/organization/memberships/[membershipId]/route";
import { ADMIN_CONFIRMATION } from "../../lib/organizationAdmin";
import { assignFirstOrganizationAdminInTransaction, type FirstOrganizationAdminInput } from "../../lib/platformFirstOrganizationAdmin";
import { SESSION_COOKIE, signSession } from "../../lib/session";
import { createFixtureContext, db, makeRequest, sessionCookieHeader, skip } from "./_setup";

const opts = { skip: skip ? "DB access not authorized; requires approved isolated integration environment" : false };

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function actorFixture(tag: string) {
  const f = createFixtureContext(tag);
  try {
    const member = await f.makeMember("candidate");
    const owner = await db.user.create({ data: { email: `${f.runId}@test.invalid`, platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() } });
    f.trackUser(owner.id);
    const context = { userId: owner.id, platformRole: "SUPER_ADMIN" as const, platformMfaEnabled: true, mfaVerified: true,
      sessionVersion: owner.sessionVersion, sessionIssuedAtEpochSeconds: 1, hasOperationalAccess: false };
    const command: FirstOrganizationAdminInput = { organizationId: member.organizationId, membershipId: member.membershipId,
      confirmation: ADMIN_CONFIRMATION, reason: "Synthetic current actor regression", idempotencyKey: f.runId, correlationId: f.runId };
    const run = () => runOperationalTransaction((tx) => assignFirstOrganizationAdminInTransaction(tx, context, command));
    const auditCount = () => db.platformAuditEvent.count({ where: { actorUserId: owner.id, action: "ORGANIZATION_FIRST_ADMIN_ASSIGNED", targetId: member.organizationId } });
    return { f, member, owner, context, command, run, auditCount };
  } catch (error) { await f.cleanup(); throw error; }
}

test("CPO-02 stale hydrated actor version/role/MFA cannot mutate or append an audit", opts, async () => {
  for (const data of [{ sessionVersion: 1 }, { platformRole: "USER" as const }, { platformMfaEnabledAt: null }]) {
    const x = await actorFixture("cpo02-stale-actor");
    try {
      await db.user.update({ where: { id: x.owner.id }, data });
      await assert.rejects(x.run(), { status: 403 });
      await db.organization.update({ where: { id: x.member.organizationId }, data: { status: "SUSPENDED" } });
      await assert.rejects(x.run(), { status: 403 });
      await assert.rejects(runOperationalTransaction((tx) => assignFirstOrganizationAdminInTransaction(tx, x.context,
        { ...x.command, organizationId: `missing:${x.f.runId}` })), { status: 403 });
      assert.equal((await db.membership.findUniqueOrThrow({ where: { id: x.member.membershipId } })).role, "AGENT");
      assert.equal(await x.auditCount(), 0);
    } finally { await x.f.cleanup(); await x.f.assertNoResidue(); }
  }
});

test("CPO-02 stale replay is rejected without changing the successful ADMIN or audit", opts, async () => {
  for (const data of [{ sessionVersion: 1 }, { platformRole: "USER" as const }, { platformMfaEnabledAt: null }]) {
    const x = await actorFixture("cpo02-stale-replay");
    try {
      assert.equal((await x.run()).replayed, false);
      await db.user.update({ where: { id: x.owner.id }, data });
      await assert.rejects(x.run(), { status: 403 });
      assert.equal((await db.membership.findUniqueOrThrow({ where: { id: x.member.membershipId } })).role, "ADMIN");
      assert.equal(await x.auditCount(), 1);
    } finally { await x.f.cleanup(); await x.f.assertNoResidue(); }
  }
});

test("CPO-02 concurrent actor revocation wins before actor lock; no ADMIN/audit survives", opts, async () => {
  const x = await actorFixture("cpo02-revocation-overlap");
  const locked = gate(), release = gate(), attempted = gate();
  const locks: string[] = [];
  let acquiredUser = false;
  let pending: ReturnType<typeof x.run> | undefined;
  const revocation = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${x.owner.id} FOR UPDATE`;
    await tx.user.update({ where: { id: x.owner.id }, data: { sessionVersion: { increment: 1 } } });
    locked.resolve();
    await release.promise;
  });
  // Attach handlers immediately; neither race is allowed to become an unhandled rejection.
  const revocationOutcome = revocation.then(() => ({ error: null }), (error: unknown) => ({ error }));
  try {
    await Promise.race([locked.promise, revocationOutcome.then(() => { throw new Error("Revocation settled before lock barrier"); })]);
    pending = runOperationalTransaction((tx) => {
      const observed = new Proxy(tx, {
        get(target, property, receiver) {
          if (property !== "$queryRaw") return Reflect.get(target, property, receiver);
          return async (...args: unknown[]) => {
            const sql = Array.isArray(args[0]) ? args[0].join("?") : "";
            const table = sql.match(/FROM "(Organization|User|Membership)"/)?.[1];
            if (table) locks.push(table);
            if (table === "User") attempted.resolve();
            const query = target.$queryRaw as (...parameters: unknown[]) => Promise<unknown>;
            const result = await query.apply(target, args);
            if (table === "User") acquiredUser = true;
            return result;
          };
        },
      }) as Prisma.TransactionClient;
      return assignFirstOrganizationAdminInTransaction(observed, x.context, x.command);
    });
    const outcome = pending.then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error }));
    await Promise.race([attempted.promise, outcome.then(() => { throw new Error("Bootstrap settled before actor-lock attempt"); })]);
    assert.deepEqual(locks, ["Organization", "User"]);
    assert.equal(acquiredUser, false, "Revocation must still hold the actor lock");
    release.resolve();
    assert.equal((await revocationOutcome).error, null);
    const result = await outcome;
    assert.equal(result.value, null);
    assert.equal((result.error as { status?: number }).status, 403);
    assert.equal(locks.includes("Membership"), false);
    for (let index = 0; index < locks.length; index++) if (locks[index] === "User") assert.equal(locks[index - 1], "Organization");
    assert.equal((await db.membership.findUniqueOrThrow({ where: { id: x.member.membershipId } })).role, "AGENT");
    assert.equal(await x.auditCount(), 0);
  } finally {
    release.resolve();
    await revocationOutcome;
    await pending?.catch(() => undefined);
    await x.f.cleanup(); await x.f.assertNoResidue();
  }
});

test("CPO-02 reserved client command namespace refuses before membership/audit writes", opts, async () => {
  const x = await actorFixture("cpo02-reserved-key");
  try {
    for (const prefix of ["server:", "projection:", "quote:", "finance-mfa-enabled:"]) {
      await assert.rejects(runOperationalTransaction((tx) => assignFirstOrganizationAdminInTransaction(tx, x.context,
        { ...x.command, idempotencyKey: `${prefix}bootstrap` })), { status: 400 });
    }
    assert.equal((await db.membership.findUniqueOrThrow({ where: { id: x.member.membershipId } })).role, "AGENT");
    assert.equal(await x.auditCount(), 0);
  } finally { await x.f.cleanup(); await x.f.assertNoResidue(); }
});

test("CPO-02 platform owner assigns first ADMIN, who invites and registers FINANCE/reviewer/manager; last-admin and tenant/platform separation survive", opts, async () => {
  const f = createFixtureContext("cpo02-first-admin-path");
  try {
    const organizationId = await f.makeOrganization("bootstrap");
    const member = await f.makeMember("first", { organizationId });
    const outsider = await f.makeMember("outsider");
    const owner = await db.user.create({ data: { email: `${f.runId}@test.invalid`, platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() } });
    f.trackUser(owner.id);
    const ownerCookie = `${SESSION_COOKIE}=${await signSession({ userId: owner.id, version: 2, sessionVersion: owner.sessionVersion, mfaVerified: true })}`;
    const noMfaCookie = `${SESSION_COOKIE}=${await signSession({ userId: owner.id, version: 2, sessionVersion: owner.sessionVersion })}`;
    const memberCookie = await sessionCookieHeader(member.userId, member.agentId);
    const path = `/api/platform-admin/organizations/${organizationId}/first-admin`;
    const request = (cookie = ownerCookie, overrides = {}, key = "first") => makeRequest(path, {
      method: "POST", cookie,
      headers: { "idempotency-key": `${f.runId}:${key}`, "x-correlation-id": `${f.runId}:trace` },
      body: { membershipId: member.membershipId, confirmation: ADMIN_CONFIRMATION, reason: "Approved initial ADMIN", ...overrides },
    });
    const params = { params: Promise.resolve({ organizationId }) };
    assert.equal((await assign(request(""), params)).status, 401);
    assert.equal((await assign(request(memberCookie), params)).status, 403);
    assert.equal((await assign(request(noMfaCookie), params)).status, 403);
    assert.equal((await assign(request(ownerCookie, { confirmation: "yes" }), params)).status, 400);
    assert.equal((await assign(request(ownerCookie, { platformRole: "SUPER_ADMIN" }), params)).status, 400);
    assert.equal((await assign(request(ownerCookie, { membershipId: outsider.membershipId }), params)).status, 404);

    const parallel = await Promise.all([assign(request(), params), assign(request(), params)]);
    assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 201]);
    assert.equal((await assign(request(), params)).status, 200);
    assert.equal((await assign(request(ownerCookie, { reason: "Changed command" }), params)).status, 409);
    assert.equal((await assign(request(ownerCookie, {}, "another"), params)).status, 409);
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: owner.id, action: "ORGANIZATION_FIRST_ADMIN_ASSIGNED", targetId: organizationId } }), 1);
    assert.equal((await db.membership.findUniqueOrThrow({ where: { id: outsider.membershipId } })).role, "AGENT");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: member.userId } })).platformRole, "USER");
    assert.equal((await assign(request(memberCookie), params)).status, 403);

    for (const role of ["FINANCE", "DOCUMENT_REVIEWER", "MANAGER"] as const) {
      const email = `${f.runId}-${role.toLowerCase()}@test.invalid`;
      const invited = await invite(makeRequest("/api/agent/invitations", {
        method: "POST", cookie: memberCookie,
        headers: { "idempotency-key": `${f.runId}:invite:${role}`, "x-correlation-id": `${f.runId}:invite` },
        body: { email, role },
      }));
      assert.equal(invited.status, 201);
      const { token } = await invited.json();
      const registration = () => makeRequest("/api/agent/auth/register", {
        method: "POST", headers: { "x-forwarded-for": `cpo02-${f.runId}-${role}` },
        body: { name: `Synthetic ${role}`, email, password: "Synthetic-Cpo02-Password-42!", inviteToken: token },
      });
      assert.equal((await register(registration())).status, 200);
      const user = await db.user.findUniqueOrThrow({ where: { email }, include: { agent: { include: { membership: true } } } });
      assert.ok(user.agent?.membership);
      f.trackCreatedMember({ userId: user.id, agentId: user.agent.id, membershipId: user.agent.membership.id });
      assert.equal(user.agent.membership.role, role);
      assert.equal(user.agent.membership.organizationId, organizationId);
      assert.equal(user.platformRole, "USER");
      assert.equal((await register(registration())).status, 403);
    }
    for (const mutation of [{ role: "AGENT" }, { status: "SUSPENDED" }]) {
      const response = await changeMembership(makeRequest(`/api/agent/organization/memberships/${member.membershipId}`, {
        method: "PATCH", cookie: memberCookie,
        headers: { "idempotency-key": `${f.runId}:${JSON.stringify(mutation)}`, "x-correlation-id": `${f.runId}:last` },
        body: { ...mutation, reason: "Last admin regression" },
      }), { params: Promise.resolve({ membershipId: member.membershipId }) });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "LAST_ACTIVE_ADMIN");
    }
  } finally { await f.cleanup(); await f.assertNoResidue(); }
});

test("CPO-02 different parallel candidates/keys yield exactly one ADMIN and one atomic audit", opts, async () => {
  const f = createFixtureContext("cpo02-first-admin-race");
  try {
    const organizationId = await f.makeOrganization("race");
    const a = await f.makeMember("a", { organizationId });
    const b = await f.makeMember("b", { organizationId });
    const owner = await db.user.create({ data: { email: `${f.runId}@test.invalid`, platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() } });
    f.trackUser(owner.id);
    const cookie = `${SESSION_COOKIE}=${await signSession({ userId: owner.id, version: 2, sessionVersion: owner.sessionVersion, mfaVerified: true })}`;
    const responses = await Promise.all([a, b].map((member) => assign(makeRequest(`/api/platform-admin/organizations/${organizationId}/first-admin`, {
      method: "POST", cookie,
      headers: { "idempotency-key": `${f.runId}:${member.membershipId}`, "x-correlation-id": `${f.runId}:race` },
      body: { membershipId: member.membershipId, confirmation: ADMIN_CONFIRMATION, reason: "Parallel bootstrap" },
    }), { params: Promise.resolve({ organizationId }) })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    assert.equal(await db.membership.count({ where: { organizationId, role: "ADMIN" } }), 1);
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: owner.id, targetId: organizationId, action: "ORGANIZATION_FIRST_ADMIN_ASSIGNED" } }), 1);
  } finally { await f.cleanup(); await f.assertNoResidue(); }
});

test("CPO-02 audit and role roll back together; same key is isolated across tenants", opts, async () => {
  const f = createFixtureContext("cpo02-first-admin-atomic");
  try {
    const a = await f.makeMember("a");
    const b = await f.makeMember("b");
    const owner = await db.user.create({ data: { email: `${f.runId}@test.invalid`, platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date() } });
    f.trackUser(owner.id);
    const context = { userId: owner.id, platformRole: "SUPER_ADMIN" as const, platformMfaEnabled: true, mfaVerified: true, sessionVersion: 0, sessionIssuedAtEpochSeconds: 1, hasOperationalAccess: false };
    const command = (member: typeof a): FirstOrganizationAdminInput => ({ organizationId: member.organizationId, membershipId: member.membershipId, confirmation: ADMIN_CONFIRMATION, reason: "Atomic bootstrap", idempotencyKey: f.runId, correlationId: f.runId });
    await assert.rejects(db.$transaction(async (tx) => {
      await assignFirstOrganizationAdminInTransaction(tx, context, command(a));
      throw new Error("simulated commit failure");
    }, { isolationLevel: "Serializable" }), /simulated commit failure/);
    assert.equal((await db.membership.findUniqueOrThrow({ where: { id: a.membershipId } })).role, "AGENT");
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: owner.id } }), 0);
    for (const member of [a, b]) {
      const result = await db.$transaction((tx) => assignFirstOrganizationAdminInTransaction(tx, context, command(member)), { isolationLevel: "Serializable" });
      assert.equal(result.replayed, false);
    }
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: owner.id } }), 2);
  } finally { await f.cleanup(); await f.assertNoResidue(); }
});
