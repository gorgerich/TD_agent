import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { before, test } from "node:test";
import { handleMfaEnrollment } from "../../app/api/platform-admin/mfa/route";
import { getCurrentUserSessionFromRequest } from "../../lib/auth";
import { SESSION_COOKIE, signSession } from "../../lib/session";
import { encryptPlatformMfaSecret, generatePlatformMfaSecret, totp } from "../../lib/platformMfa";
import { createFixtureContext, db, makeRequest, skip } from "./_setup";

const opts = { skip: skip ? "requires approved isolated PostgreSQL" : false };
const faults = new AsyncLocalStorage<boolean>();
before(() => {
  if (!skip) db.$use(async (params, next) => {
    if (faults.getStore() && params.model === "PlatformAuditEvent" && params.action === "create") throw new Error("SYNTHETIC_MFA_AUDIT_FAILURE");
    return next(params);
  });
});

async function fixture(tag: string, finance = false) {
  const registry = createFixtureContext(`cpo-mfa-${tag}`);
  const member = await registry.makeMember("enrolling", { role: finance ? "FINANCE" : "AGENT" });
  const secret = generatePlatformMfaSecret();
  const encrypted = encryptPlatformMfaSecret(secret);
  const user = await db.user.update({ where: { id: member.userId }, data: {
    platformRole: finance ? "USER" : "SUPER_ADMIN", platformMfaSecretEncrypted: encrypted,
  } });
  const cookie = `${SESSION_COOKIE}=${await signSession({ userId: user.id, sessionVersion: user.sessionVersion, activeMembershipId: member.membershipId })}`;
  const session = await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie }));
  assert.ok(session);
  const request = (action: "BEGIN" | "CONFIRM") => makeRequest("/api/platform-admin/mfa", {
    method: "POST", cookie, body: action === "BEGIN" ? { action } : { action, code: totp(secret) },
  });
  const dependencies = { db, getSession: async () => session, rateLimit: async () => null };
  return { registry, member, user, encrypted, secret, cookie, session, request, dependencies };
}

for (const action of ["BEGIN", "CONFIRM"] as const) test(`CPO MFA PostgreSQL: ${action} cannot adopt a concurrent session revocation`, opts, async () => {
  const f = await fixture(action.toLowerCase());
  try {
    await db.user.update({ where: { id: f.user.id }, data: { sessionVersion: { increment: 1 } } });
    const response = await handleMfaEnrollment(f.request(action), f.dependencies);
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("set-cookie"), null);
    const after = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
    assert.equal(after.sessionVersion, f.user.sessionVersion + 1);
    assert.equal(after.platformMfaEnabledAt, null);
    assert.equal(after.platformMfaSecretEncrypted, f.encrypted);
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: f.user.id } }), 0);
  } finally { await f.registry.cleanup(); await f.registry.assertNoResidue(); }
});

test("CPO MFA PostgreSQL: parallel confirmation has one audited winner and revokes the prior session", opts, async () => {
  const f = await fixture("parallel");
  try {
    const responses = await Promise.all([handleMfaEnrollment(f.request("CONFIRM"), f.dependencies), handleMfaEnrollment(f.request("CONFIRM"), f.dependencies)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(responses.find((response) => response.status === 409)?.headers.get("set-cookie"), null);
    const after = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
    assert.equal(after.sessionVersion, f.user.sessionVersion + 1);
    assert.ok(after.platformMfaEnabledAt);
    assert.equal(after.platformMfaSecretEncrypted, f.encrypted);
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: f.user.id, action: "PLATFORM_MFA_ENABLED" } }), 1);
    assert.equal(await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie: f.cookie })), null);
    const cookie = responses.find((response) => response.status === 200)!.headers.get("set-cookie")!.split(";")[0];
    const enabled = await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie }));
    assert.equal(enabled?.mfaVerified, true);
    assert.equal(enabled?.sessionVersion, after.sessionVersion);
  } finally { await f.registry.cleanup(); await f.registry.assertNoResidue(); }
});

test("CPO MFA PostgreSQL: audit failure rolls back enablement and session increment", opts, async () => {
  const f = await fixture("rollback");
  try {
    const response = await faults.run(true, () => handleMfaEnrollment(f.request("CONFIRM"), f.dependencies));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    const after = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
    assert.equal(after.sessionVersion, f.user.sessionVersion);
    assert.equal(after.platformMfaEnabledAt, null);
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: f.user.id } }), 0);
  } finally { await f.registry.cleanup(); await f.registry.assertNoResidue(); }
});

test("CPO MFA PostgreSQL: Finance enrollment records only its tenant audit and preserves roles", opts, async () => {
  const f = await fixture("finance", true);
  try {
    const response = await handleMfaEnrollment(f.request("CONFIRM"), f.dependencies);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).redirectTo, "/agent/finance");
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).platformRole, "USER");
    assert.equal((await db.membership.findUniqueOrThrow({ where: { id: f.member.membershipId } })).role, "FINANCE");
    assert.equal(await db.operationalAuditEvent.count({ where: { organizationId: f.member.organizationId, actorMembershipId: f.member.membershipId, action: "finance.mfa_enabled.v1" } }), 1);
    assert.equal(await db.platformAuditEvent.count({ where: { actorUserId: f.user.id } }), 0);
  } finally { await f.registry.cleanup(); await f.registry.assertNoResidue(); }
});
