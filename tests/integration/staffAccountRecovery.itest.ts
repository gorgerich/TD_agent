import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PlatformContext } from "../../lib/platformAuth";
import { getCurrentUserSessionFromRequest } from "../../lib/auth";
import { signSession, SESSION_COOKIE } from "../../lib/session";
import { hashPassword, verifyPassword } from "../../lib/password";
import { decryptPlatformMfaSecret, encryptPlatformMfaSecret, generatePlatformMfaSecret, totp } from "../../lib/platformMfa";
import { consumeStaffAccountRecovery, hashStaffRecoveryToken, issueStaffAccountRecovery, revokeStaffAccountRecovery, StaffAccountRecoveryError, STAFF_RECOVERY_CONFIRMATION, STAFF_RECOVERY_TTL_MS, verifyStaffAccountRecovery } from "../../lib/staffAccountRecovery";
import { handleStaffAccountRecovery } from "../../app/api/agent/auth/staff-recovery/route";
import { handleStaffRecoveryIssuance } from "../../app/api/platform-admin/staff-recovery/route";
import { createFixtureContext, db, makeRequest, skip } from "./_setup";

const opts = { skip: skip ? "requires approved isolated PostgreSQL" : false };
const faults = new AsyncLocalStorage<boolean>();
before(() => {
  if (!skip) db.$use(async (params, next) => {
    if (faults.getStore() && params.model === "PlatformAuditEvent" && params.action === "create") throw new Error("SYNTHETIC_STAFF_AUDIT_FAILURE");
    return next(params);
  });
});
const newPassword = "Synthetic staff recovered 2026!";
let oldHash: string;
let nextHash: string;
before(() => {
  process.env.STAFF_RECOVERY_LOCAL_ORIGIN = "http://127.0.0.1:3001";
  oldHash = hashPassword("Synthetic old staff 2026!"); nextHash = hashPassword(newPassword);
});
const tx = <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

async function fixture(tag: string, finance = true) {
  const registry = createFixtureContext(`staff-recovery-${tag}`);
  const member = await registry.makeMember("staff", { role: finance ? "FINANCE" : "AGENT" });
  const owner = await registry.makeMember("owner");
  const existingSecret = encryptPlatformMfaSecret(generatePlatformMfaSecret());
  const subject = await db.user.update({ where: { id: member.userId }, data: {
    passwordHash: oldHash, platformMfaSecretEncrypted: existingSecret, platformMfaEnabledAt: new Date(),
  } });
  const issuerUser = await db.user.update({ where: { id: owner.userId }, data: {
    platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date(), passwordHash: oldHash,
  } });
  const issuer = { userId: owner.userId, sessionVersion: issuerUser.sessionVersion, platformRole: "SUPER_ADMIN",
    platformMfaEnabled: true, mfaVerified: true } as PlatformContext;
  const input = { organizationId: member.organizationId, membershipId: member.membershipId,
    reason: "Confirmed staff identity by owner", confirmation: STAFF_RECOVERY_CONFIRMATION, idempotencyKey: randomUUID() };
  const issue = (at?: Date, ttlMs?: number) => tx((t) => issueStaffAccountRecovery(t, issuer, { ...input, idempotencyKey: randomUUID() }, { now: at, ttlMs }));
  const bearer = (url: string | undefined) => { assert.ok(url); return new URLSearchParams(new URL(url).hash.slice(1)).get("token")!; };
  const consume = (token: string, mfaCode?: string, at?: Date) => tx(async (t) => {
    const record = await t.staffAccountRecovery.findUniqueOrThrow({ where: { tokenHash: hashStaffRecoveryToken(token) } });
    return consumeStaffAccountRecovery(t, { token, passwordHash: nextHash, mfaCode: mfaCode ?? totp(decryptPlatformMfaSecret(record.mfaSecretEncrypted), Math.floor((at?.getTime() ?? Date.now()) / 30_000)), now: at });
  });
  const oldCookie = `${SESSION_COOKIE}=${await signSession({ userId: subject.id, sessionVersion: subject.sessionVersion, activeMembershipId: member.membershipId, mfaVerified: true })}`;
  async function cleanup() {
    await db.staffAccountRecovery.deleteMany({ where: { userId: subject.id } });
    await registry.cleanup(); await registry.assertNoResidue();
  }
  return { registry, member, owner, issuer, input, subject, existingSecret, issue, bearer, consume, oldCookie, cleanup };
}

test("staff recovery: hash-only bearer, real password/MFA consume, session revocation and exact role/history preservation", opts, async () => {
  const f = await fixture("happy");
  try {
    const issued = await f.issue();
    const token = f.bearer(issued.url);
    const row = await db.staffAccountRecovery.findUniqueOrThrow({ where: { id: issued.id } });
    assert.notEqual(row.tokenHash, token); assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
    assert.ok(row.expiresAt.getTime() - row.createdAt.getTime() <= STAFF_RECOVERY_TTL_MS);
    const setup = await tx((t) => verifyStaffAccountRecovery(t, token));
    assert.equal(setup.resetMfa, true);
    assert.equal(decryptPlatformMfaSecret(row.mfaSecretEncrypted), setup.secret);
    const beforeMember = await db.membership.findUniqueOrThrow({ where: { id: f.member.membershipId } });
    const beforeOrg = await db.organization.findUniqueOrThrow({ where: { id: f.member.organizationId } });
    const response = await handleStaffAccountRecovery(makeRequest("/api/agent/auth/staff-recovery", { method: "POST", body: {
      action: "RECOVER", token, password: newPassword, confirmation: newPassword, mfaCode: totp(setup.secret),
    } }), { limiter: async () => null, identityLimiter: async () => null });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).redirectTo, "/agent/finance");
    const user = await db.user.findUniqueOrThrow({ where: { id: f.subject.id } });
    assert.equal(verifyPassword(newPassword, user.passwordHash), true);
    assert.equal(user.platformRole, "USER"); assert.equal(user.sessionVersion, f.subject.sessionVersion + 1);
    assert.equal(user.platformMfaSecretEncrypted, row.mfaSecretEncrypted);
    assert.deepEqual(await db.membership.findUniqueOrThrow({ where: { id: f.member.membershipId } }), beforeMember);
    assert.deepEqual(await db.organization.findUniqueOrThrow({ where: { id: f.member.organizationId } }), beforeOrg);
    assert.equal(await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie: f.oldCookie })), null);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    const session = await getCurrentUserSessionFromRequest(makeRequest("/session", { cookie }));
    assert.equal(session?.sessionVersion, user.sessionVersion); assert.equal(session?.mfaVerified, true);
    assert.equal(session?.activeMembershipId, f.member.membershipId);
    await assert.rejects(f.consume(token), StaffAccountRecoveryError);
    const audit = await db.platformAuditEvent.findMany({ where: { targetType: "staff-recovery", targetId: issued.id } });
    const serialized = JSON.stringify(audit);
    for (const value of [token, setup.secret, setup.uri, newPassword, nextHash, row.mfaSecretEncrypted, f.input.reason]) assert.equal(serialized.includes(value), false);
    assert.equal(audit.filter((e) => e.action === "STAFF_ACCOUNT_RECOVERED").length, 1);
  } finally { await f.cleanup(); }
});

test("staff recovery: non-Finance password recovery preserves existing MFA and never grants platform role", opts, async () => {
  const f = await fixture("agent", false);
  try {
    const issued = await f.issue();
    const result = await f.consume(f.bearer(issued.url));
    assert.equal(result.mfaVerified, false);
    const user = await db.user.findUniqueOrThrow({ where: { id: f.subject.id } });
    assert.equal(user.platformRole, "USER"); assert.equal(user.platformMfaSecretEncrypted, f.existingSecret);
    assert.deepEqual(user.platformMfaEnabledAt, f.subject.platformMfaEnabledAt);
    assert.equal((await db.membership.findUniqueOrThrow({ where: { id: f.member.membershipId } })).role, "AGENT");
  } finally { await f.cleanup(); }
});

test("staff recovery: expiry, replacement issuance and explicit revoke invalidate bearers", opts, async () => {
  const f = await fixture("expiry");
  try {
    const expired = await f.issue(new Date(Date.now() - STAFF_RECOVERY_TTL_MS - 1000));
    await assert.rejects(tx((t) => verifyStaffAccountRecovery(t, f.bearer(expired.url))), StaffAccountRecoveryError);
    await assert.rejects(f.consume(f.bearer(expired.url)), StaffAccountRecoveryError);
    const first = await f.issue(); const second = await f.issue();
    assert.ok((await db.staffAccountRecovery.findUniqueOrThrow({ where: { id: first.id } })).revokedAt);
    await assert.rejects(f.consume(f.bearer(first.url)), StaffAccountRecoveryError);
    await tx((t) => revokeStaffAccountRecovery(t, f.issuer, { ...f.input, recoveryId: second.id }));
    await assert.rejects(f.consume(f.bearer(second.url)), StaffAccountRecoveryError);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.subject.id } })).passwordHash, oldHash);
  } finally { await f.cleanup(); }
});

test("staff recovery: concurrent consume has exactly one winner, one increment and one audit", opts, async () => {
  const f = await fixture("parallel");
  try {
    const issued = await f.issue(); const token = f.bearer(issued.url);
    const results = await Promise.allSettled([f.consume(token), f.consume(token)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof StaffAccountRecoveryError);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.subject.id } })).sessionVersion, f.subject.sessionVersion + 1);
    assert.equal(await db.platformAuditEvent.count({ where: { targetId: issued.id, action: "STAFF_ACCOUNT_RECOVERED" } }), 1);
  } finally { await f.cleanup(); }
});

test("staff recovery: concurrent issuance leaves one usable bearer", opts, async () => {
  const f = await fixture("parallel-issue");
  try {
    const issued = await Promise.all([f.issue(), f.issue()]);
    const open = await db.staffAccountRecovery.findMany({ where: { userId: f.subject.id, revokedAt: null, consumedAt: null } });
    assert.equal(open.length, 1);
    const usable = issued.find((r) => r.id === open[0].id)!;
    await f.consume(f.bearer(usable.url));
    const old = issued.find((r) => r.id !== usable.id)!;
    await assert.rejects(f.consume(f.bearer(old.url)), StaffAccountRecoveryError);
  } finally { await f.cleanup(); }
});

test("staff recovery: same-key retry/concurrent issuance never re-emits a bearer or revokes its original link", opts, async () => {
  const f = await fixture("idempotent");
  try {
    const issue = () => tx((t) => issueStaffAccountRecovery(t, f.issuer, f.input));
    const outcomes = await Promise.all([issue(), issue()]);
    const first = outcomes.find((r) => !r.replayed)!;
    const replay = outcomes.find((r) => r.replayed)!;
    assert.ok(first.url); assert.equal(new URL(first.url).origin, "http://127.0.0.1:3001");
    assert.equal(replay.id, first.id); assert.equal(replay.url, undefined);
    assert.equal((await issue()).url, undefined);
    const ownerCookie = `${SESSION_COOKIE}=${await signSession({ userId: f.issuer.userId, sessionVersion: f.issuer.sessionVersion, mfaVerified: true })}`;
    const apiIssue = (key: string) => handleStaffRecoveryIssuance(makeRequest("/api/platform-admin/staff-recovery", {
      method: "POST", cookie: ownerCookie,
      headers: { "Idempotency-Key": key, "X-Correlation-Id": key, origin: "https://attacker.invalid", "x-forwarded-host": "attacker.invalid" },
      body: { organizationId: f.input.organizationId, membershipId: f.input.membershipId, reason: f.input.reason, confirmation: f.input.confirmation },
    }), false, async () => null);
    const apiReplay = await apiIssue(f.input.idempotencyKey);
    assert.equal(apiReplay.status, 200);
    const replayBody = await apiReplay.json();
    assert.equal(replayBody.replayed, true); assert.equal(Object.hasOwn(replayBody, "url"), false);
    assert.equal(await db.staffAccountRecovery.count({ where: { userId: f.subject.id } }), 1);
    const row = await db.staffAccountRecovery.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(row.revokedAt, null); assert.equal(row.consumedAt, null);
    assert.equal(await db.platformAuditEvent.count({ where: { targetId: first.id, action: "STAFF_RECOVERY_ISSUED" } }), 1);
    await assert.rejects(tx((t) => issueStaffAccountRecovery(t, f.issuer, { ...f.input, reason: "Different explicit reason" })), { status: 409 });
    const newResponse = await apiIssue(randomUUID());
    assert.equal(newResponse.status, 201);
    const replacement = await newResponse.json();
    assert.equal(replacement.replayed, false);
    assert.equal(new URL(replacement.url).origin, "http://127.0.0.1:3001", "request Origin/forwarded host must not choose the recovery URL");
    assert.notEqual(replacement.id, first.id);
    await assert.rejects(f.consume(f.bearer(first.url)), StaffAccountRecoveryError);
    assert.ok((await issue()).replayed); assert.equal((await issue()).url, undefined);
    assert.equal((await db.staffAccountRecovery.findUniqueOrThrow({ where: { id: replacement.id } })).revokedAt, null);
  } finally { await f.cleanup(); }
});

test("staff recovery: tenant mismatch, stale issuer, missing MFA, confirmation and platform targets refuse issuance", opts, async () => {
  const f = await fixture("authority");
  try {
    for (const actor of [{ ...f.issuer, mfaVerified: false }, { ...f.issuer, platformMfaEnabled: false }, { ...f.issuer, sessionVersion: -1 }, { ...f.issuer, platformRole: "USER" }]) {
      await assert.rejects(tx((t) => issueStaffAccountRecovery(t, actor as PlatformContext, f.input)), { status: 403 });
    }
    await assert.rejects(tx((t) => issueStaffAccountRecovery(t, f.issuer, { ...f.input, confirmation: "wrong" })), { status: 422 });
    await assert.rejects(tx((t) => issueStaffAccountRecovery(t, f.issuer, { ...f.input, organizationId: f.owner.organizationId })), StaffAccountRecoveryError);
    await db.user.update({ where: { id: f.subject.id }, data: { platformRole: "SUPER_ADMIN" } });
    await assert.rejects(f.issue(), StaffAccountRecoveryError);
    assert.equal(await db.staffAccountRecovery.count({ where: { userId: f.subject.id } }), 0);
  } finally { await f.cleanup(); }
});

test("staff recovery: changed role/version or suspended exact membership/org/agent refuses verify and consume", opts, async () => {
  const f = await fixture("changed");
  try {
    const issued = await f.issue(); const token = f.bearer(issued.url);
    const changes = [
      [async () => db.membership.update({ where: { id: f.member.membershipId }, data: { status: "SUSPENDED" } }), async () => db.membership.update({ where: { id: f.member.membershipId }, data: { status: "ACTIVE" } })],
      [async () => db.organization.update({ where: { id: f.member.organizationId }, data: { status: "SUSPENDED" } }), async () => db.organization.update({ where: { id: f.member.organizationId }, data: { status: "ACTIVE" } })],
      [async () => db.agent.update({ where: { id: f.member.agentId }, data: { status: "SUSPENDED" } }), async () => db.agent.update({ where: { id: f.member.agentId }, data: { status: "ACTIVE" } })],
      [async () => db.membership.update({ where: { id: f.member.membershipId }, data: { role: "ADMIN" } }), async () => db.membership.update({ where: { id: f.member.membershipId }, data: { role: "FINANCE" } })],
      [async () => db.user.update({ where: { id: f.subject.id }, data: { platformRole: "SUPER_ADMIN" } }), async () => db.user.update({ where: { id: f.subject.id }, data: { platformRole: "USER" } })],
    ];
    for (const [apply, restore] of changes) {
      await apply();
      await assert.rejects(tx((t) => verifyStaffAccountRecovery(t, token)), StaffAccountRecoveryError);
      await assert.rejects(f.consume(token), StaffAccountRecoveryError);
      await restore();
    }
    await db.user.update({ where: { id: f.subject.id }, data: { sessionVersion: { increment: 1 } } });
    await assert.rejects(f.consume(token), StaffAccountRecoveryError);
    assert.equal((await db.staffAccountRecovery.findUniqueOrThrow({ where: { id: issued.id } })).consumedAt, null);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.subject.id } })).passwordHash, oldHash);
  } finally { await f.cleanup(); }
});

test("staff recovery: wrong TOTP and password confirmation refuse; audit failure rolls back consume and credential", opts, async () => {
  const f = await fixture("rollback");
  try {
    const issued = await f.issue(); const token = f.bearer(issued.url);
    const setup = await tx((t) => verifyStaffAccountRecovery(t, token));
    const invalidCode = Array.from({ length: 10 }, (_, n) => String(n).repeat(6)).find((code) => {
      const counter = Math.floor(Date.now() / 30_000); return [-1, 0, 1].every((offset) => code !== totp(setup.secret, counter + offset));
    })!;
    await assert.rejects(f.consume(token, invalidCode), StaffAccountRecoveryError);
    const dependencies = { limiter: async () => null, identityLimiter: async () => null };
    const response = await handleStaffAccountRecovery(makeRequest("/api/agent/auth/staff-recovery", { method: "POST", body: {
      action: "RECOVER", token, password: newPassword, confirmation: "different-password", mfaCode: totp(setup.secret),
    } }), dependencies);
    assert.equal(response.status, 422); assert.equal(response.headers.get("set-cookie"), null);
    await assert.rejects(faults.run(true, () => f.consume(token)), /SYNTHETIC_STAFF_AUDIT_FAILURE/);
    const row = await db.staffAccountRecovery.findUniqueOrThrow({ where: { id: issued.id } });
    assert.equal(row.consumedAt, null);
    const user = await db.user.findUniqueOrThrow({ where: { id: f.subject.id } });
    assert.equal(user.passwordHash, oldHash); assert.equal(user.sessionVersion, f.subject.sessionVersion);
    assert.equal(user.platformMfaSecretEncrypted, f.existingSecret);
    const unknown = "A".repeat(43);
    const bad = await handleStaffAccountRecovery(makeRequest("/api/agent/auth/staff-recovery", { method: "POST", body: { action: "VERIFY", token: unknown } }), dependencies);
    assert.equal(bad.status, 400); assert.equal(bad.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(bad.headers.get("referrer-policy"), "no-referrer");
  } finally { await f.cleanup(); }
});

test("staff recovery: freeze refuses before rate-limit/DB work and does not inherit owner exception", opts, async () => {
  const previous = process.env.RELEASE_WRITE_FREEZE;
  process.env.RELEASE_WRITE_FREEZE = "enabled";
  try {
    const unexpected = async () => { throw new Error("MUST_NOT_RUN"); };
    assert.equal((await handleStaffAccountRecovery(makeRequest("/api/agent/auth/staff-recovery", { method: "POST" }), { limiter: unexpected })).status, 503);
    assert.equal((await handleStaffRecoveryIssuance(makeRequest("/api/platform-admin/staff-recovery", { method: "POST" }), false, unexpected, unexpected)).status, 503);
  } finally { if (previous === undefined) delete process.env.RELEASE_WRITE_FREEZE; else process.env.RELEASE_WRITE_FREEZE = previous; }
});
