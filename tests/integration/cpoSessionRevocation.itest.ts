import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { before, test } from "node:test";
import { handleSessionRevocation } from "../../app/api/platform-admin/sessions/revoke/route";
import { createVersionBoundUserSession } from "../../lib/agentAuth";
import { getCurrentUserSessionFromRequest } from "../../lib/auth";
import { requirePlatformAdmin } from "../../lib/platformAuth";
import { encryptPlatformMfaSecret, generatePlatformMfaSecret } from "../../lib/platformMfa";
import { SESSION_COOKIE, signSession, verifySession } from "../../lib/session";
import { createFixtureContext, db, makeRequest, skip } from "./_setup";

const opts = { skip: skip ? "requires approved isolated PostgreSQL" : false };
const faults = new AsyncLocalStorage<boolean>();
before(() => {
  if (!skip) db.$use(async (params, next) => {
    if (faults.getStore() && params.model === "PlatformAuditEvent" && params.action === "create") {
      throw new Error("SYNTHETIC_REVOCATION_AUDIT_FAILURE");
    }
    return next(params);
  });
});

async function fixture(tag: string) {
  const registry = createFixtureContext(`cpo-revoke-${tag}`);
  const member = await registry.makeMember("owner");
  const user = await db.user.update({ where: { id: member.userId }, data: {
    platformRole: "SUPER_ADMIN",
    platformMfaSecretEncrypted: encryptPlatformMfaSecret(generatePlatformMfaSecret()),
    platformMfaEnabledAt: new Date(),
  } });
  const cookie = `${SESSION_COOKIE}=${await signSession({
    userId: user.id, sessionVersion: user.sessionVersion, activeMembershipId: member.membershipId, mfaVerified: true,
  })}`;
  const request = () => makeRequest("/api/platform-admin/sessions/revoke", { method: "POST", cookie });
  const context = await requirePlatformAdmin(request());
  return {
    registry, member, user, cookie, request, context,
    dependencies: { db, requireAdmin: async () => context },
    async cleanup() { await registry.cleanup(); await registry.assertNoResidue(); },
  };
}

function responseCookie(response: Response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header);
  return header.split(";")[0]!;
}

async function auditCount(userId: number) {
  return db.platformAuditEvent.count({ where: { actorUserId: userId, action: "PLATFORM_SESSIONS_REVOKED" } });
}

async function assertRevocationAudit(userId: number, previousSessionVersion: number) {
  const events = await db.platformAuditEvent.findMany({ where: { actorUserId: userId, action: "PLATFORM_SESSIONS_REVOKED" } });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.targetType, "user");
  assert.equal(events[0]!.targetId, String(userId));
  assert.deepEqual(events[0]!.metadata, {
    scope: "all-other-sessions", previousSessionVersion, sessionVersion: previousSessionVersion + 1,
  });
}

test("CPO revocation PostgreSQL: later revocation between commit and signing is never adopted", opts, async () => {
  const f = await fixture("later-revocation");
  try {
    let signCalls = 0;
    const response = await handleSessionRevocation(f.request(), {
      ...f.dependencies,
      createSession: async (claims) => {
        signCalls++;
        assert.equal(claims.sessionVersion, f.user.sessionVersion + 1);
        const committed = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
        assert.equal(committed.sessionVersion, claims.sessionVersion);
        assert.equal(await auditCount(f.user.id), 1, "the first transaction committed its audit before signing");
        // This awaited independent transaction deterministically models a later revocation.
        await db.user.update({ where: { id: f.user.id }, data: { sessionVersion: { increment: 1 } } });
        return createVersionBoundUserSession(claims);
      },
    });
    assert.equal(response.status, 200);
    assert.equal(signCalls, 1);
    const cookie = responseCookie(response);
    const claims = await verifySession(cookie.slice(`${SESSION_COOKIE}=`.length));
    assert.equal(claims?.sessionVersion, f.user.sessionVersion + 1);
    assert.equal(claims?.mfaVerified, true);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).sessionVersion, f.user.sessionVersion + 2);
    assert.equal(await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie })), null);
    assert.equal(await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie: f.cookie })), null);
    assert.equal(await auditCount(f.user.id), 1);
    await assertRevocationAudit(f.user.id, f.user.sessionVersion);
  } finally { await f.cleanup(); }
});

test("CPO revocation PostgreSQL: parallel requests from one authenticated snapshot have one winner", opts, async () => {
  const f = await fixture("parallel");
  try {
    let arrived = 0;
    let release!: () => void;
    const bothAuthenticated = new Promise<void>((resolve) => { release = resolve; });
    const dependencies = { db, requireAdmin: async () => {
      if (++arrived === 2) release();
      await bothAuthenticated;
      return f.context;
    } };
    const responses = await Promise.all([1, 2].map(() => handleSessionRevocation(f.request(), dependencies)));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(responses.find((response) => response.status === 409)!.headers.get("set-cookie"), null);
    const winner = responses.find((response) => response.status === 200)!;
    const cookie = responseCookie(winner);
    const user = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
    assert.equal(user.sessionVersion, f.user.sessionVersion + 1);
    const session = await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie }));
    assert.equal(session?.sessionVersion, user.sessionVersion);
    assert.equal(session?.mfaVerified, true);
    assert.equal(await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie: f.cookie })), null);
    assert.equal(await auditCount(f.user.id), 1);
    await assertRevocationAudit(f.user.id, f.user.sessionVersion);
  } finally { await f.cleanup(); }
});

for (const changed of ["version", "role", "mfa"] as const) {
  test(`CPO revocation PostgreSQL: stale authenticated context cannot mutate after ${changed} changes`, opts, async () => {
    const f = await fixture(`stale-${changed}`);
    try {
      await db.user.update({ where: { id: f.user.id }, data: changed === "version"
        ? { sessionVersion: { increment: 1 } }
        : changed === "role" ? { platformRole: "USER" } : { platformMfaEnabledAt: null } });
      const before = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
      let signCalls = 0;
      const response = await handleSessionRevocation(f.request(), {
        ...f.dependencies, createSession: async () => { signCalls++; throw new Error("must not sign a stale context"); },
      });
      assert.equal(response.status, 409);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
      assert.equal(signCalls, 0);
      assert.equal(await auditCount(f.user.id), 0);
      assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: f.user.id } }), before);
    } finally { await f.cleanup(); }
  });
}

test("CPO revocation PostgreSQL: audit failure rolls back the version and preserves the prior session", opts, async () => {
  const f = await fixture("audit-rollback");
  try {
    let signCalls = 0;
    const response = await faults.run(true, () => handleSessionRevocation(f.request(), {
      ...f.dependencies, createSession: async () => { signCalls++; throw new Error("must not sign after audit rollback"); },
    }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "5");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.doesNotMatch(await response.text(), /SYNTHETIC|AUDIT_FAILURE|enc1:/);
    assert.equal(signCalls, 0);
    const user = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
    assert.equal(user.sessionVersion, f.user.sessionVersion);
    assert.equal(user.platformRole, "SUPER_ADMIN");
    assert.deepEqual(user.platformMfaEnabledAt, f.user.platformMfaEnabledAt);
    assert.equal(user.platformMfaSecretEncrypted, f.user.platformMfaSecretEncrypted);
    assert.equal(await auditCount(f.user.id), 0);
    assert.equal((await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie: f.cookie })))?.sessionVersion, f.user.sessionVersion);
  } finally { await f.cleanup(); }
});

test("CPO revocation PostgreSQL: post-commit signing failure preserves the committed revocation and audit", opts, async () => {
  const f = await fixture("signing-failure");
  try {
    let signCalls = 0;
    const response = await handleSessionRevocation(f.request(), {
      ...f.dependencies,
      createSession: async (claims) => {
        signCalls++;
        assert.equal(claims.sessionVersion, f.user.sessionVersion + 1);
        assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).sessionVersion, claims.sessionVersion);
        await assertRevocationAudit(f.user.id, f.user.sessionVersion);
        throw new Error("SYNTHETIC_POST_COMMIT_SIGNING_FAILURE");
      },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("Retry-After"), "5");
    assert.deepEqual(await response.json(), { error: "Сервис временно недоступен" });
    assert.equal(signCalls, 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).sessionVersion, f.user.sessionVersion + 1);
    await assertRevocationAudit(f.user.id, f.user.sessionVersion);
    assert.equal(await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie: f.cookie })), null);
  } finally { await f.cleanup(); }
});

test("CPO revocation PostgreSQL: missing signing keys fail before authentication or mutation", opts, async () => {
  const f = await fixture("missing-key");
  const savedSessionSecret = process.env.SESSION_SECRET;
  const savedEncryptionKey = process.env.APP_ENCRYPTION_KEY;
  try {
    delete process.env.SESSION_SECRET;
    delete process.env.APP_ENCRYPTION_KEY;
    let authCalls = 0;
    let signCalls = 0;
    const response = await handleSessionRevocation(f.request(), {
      db,
      requireAdmin: async () => { authCalls++; return f.context; },
      createSession: async () => { signCalls++; throw new Error("must not sign without keys"); },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("Retry-After"), "5");
    assert.deepEqual(await response.json(), { error: "Сервис временно недоступен" });
    assert.equal(authCalls, 0);
    assert.equal(signCalls, 0);
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: f.user.id } }), f.user);
    assert.equal(await auditCount(f.user.id), 0);
  } finally {
    if (savedSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSessionSecret;
    if (savedEncryptionKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = savedEncryptionKey;
    await f.cleanup();
  }
});

test("CPO revocation PostgreSQL: unauthenticated and unauthorized calls retain 401/403 without mutation", opts, async () => {
  const f = await fixture("auth-errors");
  try {
    const unauthenticated = await handleSessionRevocation(makeRequest("/api/platform-admin/sessions/revoke", { method: "POST" }));
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get("set-cookie"), null);
    const noMfaCookie = `${SESSION_COOKIE}=${await signSession({ userId: f.user.id, sessionVersion: f.user.sessionVersion, mfaVerified: false })}`;
    const noMfa = await handleSessionRevocation(makeRequest("/api/platform-admin/sessions/revoke", { method: "POST", cookie: noMfaCookie }));
    assert.equal(noMfa.status, 403);
    assert.equal(noMfa.headers.get("set-cookie"), null);
    await db.user.update({ where: { id: f.user.id }, data: { platformRole: "USER" } });
    const forbidden = await handleSessionRevocation(f.request());
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.headers.get("set-cookie"), null);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).sessionVersion, f.user.sessionVersion);
    assert.equal(await auditCount(f.user.id), 0);
  } finally { await f.cleanup(); }
});
