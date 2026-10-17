import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { pbkdf2Sync } from "node:crypto";
import { NextRequest } from "next/server";
import { handleLogin } from "../app/api/agent/auth/login/route";
import { handleRequestOtp } from "../app/api/agent/auth/request-otp/route";
import { handleVerifyOtp } from "../app/api/agent/auth/verify-otp/route";
import { handleMfaEnrollment } from "../app/api/platform-admin/mfa/route";
import { POST as logout } from "../app/api/agent/auth/logout/route";
import { GET as readLeads } from "../app/api/agent/leads/route";
import { GET as readLead } from "../app/api/agent/leads/[leadId]/route";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { hashOtp } from "../lib/otp";
import { encryptPlatformMfaSecret, generatePlatformMfaSecret, totp } from "../lib/platformMfa";
import { SESSION_COOKIE, verifySession } from "../lib/session";
import type { AuthenticatedUserSession } from "../lib/auth";

const phone = "+79161234567";
const password = "synthetic-auth-password";
const currentHash = hashPassword(password);
const noLimit = async () => null;
beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = "synthetic-auth-route-unit-key-not-a-deployment-key";
  process.env.DEMO_MODE = "0";
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
});
function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function fakeDb(value: object) { return value as unknown as typeof prisma; }
function legacyHash() {
  const salt = Buffer.alloc(16, 5).toString("base64url");
  return `pbkdf2$210000$${salt}$${pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64url")}`;
}
function user(hash = currentHash) {
  return { id: 1, name: "Synthetic", passwordHash: hash, sessionVersion: 8, platformRole: "USER", platformMfaSecretEncrypted: null, platformMfaEnabledAt: null, memberships: [{ id: "member-1", role: "AGENT" }] };
}
async function cookieClaims(response: Response) {
  const token = response.headers.get("set-cookie")!.split(";")[0]!.slice(`${SESSION_COOKIE}=`.length);
  return verifySession(token);
}

test("login: unknown, passwordless and malformed-hash accounts all run the verifier and return identical 401", async () => {
  const calls: unknown[] = [];
  let selected: object | null = null;
  const deps = {
    db: fakeDb({ user: { findUnique: async () => selected } }),
    rateLimit: noLimit, identityRateLimit: noLimit,
    verifyPassword: (_password: string, hash: string | null | undefined) => { calls.push(hash); return false; },
  };
  const bodies: string[] = [];
  for (const candidate of [null, { ...user(), passwordHash: null }, { ...user(), passwordHash: "bad" }]) {
    selected = candidate;
    const response = await handleLogin(request("/login", { email: "synthetic@test.invalid", password }), deps);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    bodies.push(await response.text());
  }
  assert.deepEqual(calls, [undefined, null, "bad"]);
  assert.equal(new Set(bodies).size, 1);
});

test("login: successful legacy upgrade atomically matches old hash/version and preserves session version", async () => {
  const existing = user(legacyHash());
  let update: { where: object; data: { passwordHash: string } } | undefined;
  const response = await handleLogin(request("/login", { email: "synthetic@test.invalid", password }), {
    db: fakeDb({ user: {
      findUnique: async () => existing,
      updateMany: async (input: typeof update) => { update = input; return { count: 1 }; },
    } }), rateLimit: noLimit, identityRateLimit: noLimit,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(update!.where, { id: 1, passwordHash: existing.passwordHash, sessionVersion: 8 });
  assert.deepEqual(Object.keys(update!.data), ["passwordHash"]);
  assert.equal(update!.data.passwordHash.split("$")[1], "600000");
  assert.equal(verifyPassword(password, update!.data.passwordHash), true);
  assert.equal((await cookieClaims(response))?.sessionVersion, 8);
  assert.match(response.headers.get("set-cookie")!, /Secure/);
});

test("login: CAS conflict never overwrites reset/revocation and never issues a cookie", async () => {
  const response = await handleLogin(request("/login", { email: "synthetic@test.invalid", password }), {
    db: fakeDb({ user: { findUnique: async () => user(legacyHash()), updateMany: async () => ({ count: 0 }) } }),
    rateLimit: noLimit, identityRateLimit: noLimit,
    createSession: async () => { throw new Error("must not sign after a conflict"); },
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("login: a 201-character legacy password still verifies and upgrades", async () => {
  const longPassword = "x".repeat(201);
  const salt = Buffer.alloc(16, 5).toString("base64url");
  const passwordHash = `pbkdf2$210000$${salt}$${pbkdf2Sync(longPassword, salt, 210000, 32, "sha256").toString("base64url")}`;
  let upgradedHash = "";
  const response = await handleLogin(request("/login", { email: "synthetic@test.invalid", password: longPassword }), {
    db: fakeDb({ user: {
      findUnique: async () => user(passwordHash),
      updateMany: async (input: { where: object; data: { passwordHash: string } }) => {
        assert.deepEqual(input.where, { id: 1, passwordHash, sessionVersion: 8 });
        upgradedHash = input.data.passwordHash;
        return { count: 1 };
      },
    } }), rateLimit: noLimit, identityRateLimit: noLimit,
  });
  assert.equal(response.status, 200);
  assert.equal(verifyPassword(longPassword, upgradedHash), true);
  assert.equal((await cookieClaims(response))?.sessionVersion, 8);
});

test("login: wrong password, missing/incorrect MFA and current hashes never trigger upgrades", async () => {
  let updates = 0;
  const secret = generatePlatformMfaSecret();
  const current = user();
  const existing = { ...user(legacyHash()), platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date(), platformMfaSecretEncrypted: encryptPlatformMfaSecret(secret) };
  let selected: ReturnType<typeof user> | typeof existing = existing;
  const deps = {
    db: fakeDb({ user: { findUnique: async () => selected, updateMany: async () => { updates++; return { count: 1 }; } } }),
    rateLimit: noLimit, identityRateLimit: noLimit,
  };
  const wrong = await handleLogin(request("/login", { email: "synthetic@test.invalid", password: "wrong" }), deps);
  assert.equal(wrong.status, 401);
  const challenge = await handleLogin(request("/login", { email: "synthetic@test.invalid", password }), deps);
  assert.equal((await challenge.json()).mfaRequired, true);
  assert.equal(challenge.headers.get("set-cookie"), null);
  const counter = Math.floor(Date.now() / 30000);
  const validCodes = new Set([-1, 0, 1].map((offset) => totp(secret, counter + offset)));
  let wrongCode = "000000";
  while (validCodes.has(wrongCode)) wrongCode = String(Number(wrongCode) + 1).padStart(6, "0");
  const invalid = await handleLogin(request("/login", { email: "synthetic@test.invalid", password, mfaCode: wrongCode }), deps);
  assert.equal(invalid.status, 401);
  selected = current;
  assert.equal((await handleLogin(request("/login", { email: "synthetic@test.invalid", password }), deps)).status, 200);
  assert.equal(updates, 0);
});

test("login: corrupt MFA returns retryable safe 503, not bad-code 401 or a session", async () => {
  const existing = { ...user(), platformRole: "SUPER_ADMIN", platformMfaEnabledAt: new Date(), platformMfaSecretEncrypted: "enc1:damaged" };
  const response = await handleLogin(request("/login", { email: "synthetic@test.invalid", password, mfaCode: "123456" }), {
    db: fakeDb({ user: { findUnique: async () => existing } }), rateLimit: noLimit, identityRateLimit: noLimit,
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "5");
  assert.equal((await response.json()).code, "PII_DECRYPTION_UNAVAILABLE");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("MFA enrollment: unreadable persisted secret returns safe retryable 503 before mutation", async () => {
  const session = { userId: 1, platformRole: "SUPER_ADMIN", platformMfaEnabled: false, sessionVersion: 8 } as AuthenticatedUserSession;
  const response = await handleMfaEnrollment(request("/mfa", { action: "CONFIRM", code: "123456" }), {
    db: fakeDb({ user: { findUnique: async () => ({ platformMfaSecretEncrypted: "enc1:damaged", platformMfaEnabledAt: null }) } }),
    rateLimit: noLimit, getSession: async () => session,
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "5");
  assert.equal((await response.json()).code, "PII_DECRYPTION_UNAVAILABLE");
  assert.equal(response.headers.get("set-cookie"), null);
});

function mfaEnrollmentHarness() {
  const secret = generatePlatformMfaSecret();
  const initialSecret = encryptPlatformMfaSecret(secret);
  const row = { id: 1, sessionVersion: 8, platformMfaSecretEncrypted: initialSecret as string | null, platformMfaEnabledAt: null as Date | null };
  const session = { userId: 1, platformRole: "SUPER_ADMIN", platformMfaEnabled: false, sessionVersion: 8 } as AuthenticatedUserSession;
  const hooks = { afterRead: async () => {}, beforeWrite: () => {}, afterAudit: () => {} };
  let audits = 0;
  let writes = 0;
  type Mutation = {
    where: typeof row;
    data: { platformMfaSecretEncrypted?: string; platformMfaEnabledAt?: Date; sessionVersion?: { increment: number } };
  };
  const users = {
    findUnique: async () => {
      const snapshot = { platformMfaSecretEncrypted: row.platformMfaSecretEncrypted, platformMfaEnabledAt: row.platformMfaEnabledAt };
      await hooks.afterRead();
      return snapshot;
    },
    updateMany: async ({ where, data }: Mutation) => {
      assert.equal(where.id, 1);
      assert.equal(where.sessionVersion, 8);
      assert.equal(where.platformMfaEnabledAt, null);
      assert.ok(Object.hasOwn(where, "platformMfaSecretEncrypted"));
      hooks.beforeWrite();
      if (where.id !== row.id || where.sessionVersion !== row.sessionVersion
        || where.platformMfaEnabledAt !== row.platformMfaEnabledAt
        || where.platformMfaSecretEncrypted !== row.platformMfaSecretEncrypted) return { count: 0 };
      writes++;
      if (data.platformMfaSecretEncrypted !== undefined) row.platformMfaSecretEncrypted = data.platformMfaSecretEncrypted;
      if (data.platformMfaEnabledAt !== undefined) row.platformMfaEnabledAt = data.platformMfaEnabledAt;
      if (data.sessionVersion) row.sessionVersion += data.sessionVersion.increment;
      return { count: 1 };
    },
  };
  const tx = { user: users, platformAuditEvent: { create: async () => { audits++; hooks.afterAudit(); return {}; } } };
  return {
    secret, initialSecret, row, hooks,
    counts: () => ({ audits, writes }),
    deps: {
      db: fakeDb({ user: users, $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx) }),
      rateLimit: noLimit, getSession: async () => session,
    },
  };
}

for (const action of ["BEGIN", "CONFIRM"] as const) {
  for (const race of ["revocation", "enablement", "secret replacement"] as const) {
    test(`MFA enrollment: ${action} loses CAS after concurrent ${race}, without cookie or audit`, async () => {
      const h = mfaEnrollmentHarness();
      h.hooks.beforeWrite = () => {
        if (race === "revocation") h.row.sessionVersion++;
        if (race === "enablement") h.row.platformMfaEnabledAt = new Date(1);
        if (race === "secret replacement") h.row.platformMfaSecretEncrypted = "concurrently-replaced-secret";
      };
      const response = await handleMfaEnrollment(request("/mfa", { action, ...(action === "CONFIRM" ? { code: totp(h.secret) } : {}) }), h.deps);
      assert.equal(response.status, 409);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
      assert.doesNotMatch(await response.text(), /secret|otpauth|enc1:/);
      assert.deepEqual(h.counts(), { audits: 0, writes: 0 });
      assert.equal(h.row.platformMfaSecretEncrypted, race === "secret replacement" ? "concurrently-replaced-secret" : h.initialSecret);
      assert.equal(h.row.sessionVersion, race === "revocation" ? 9 : 8);
      assert.equal(h.row.platformMfaEnabledAt?.getTime() ?? null, race === "enablement" ? 1 : null);
    });
  }
}

test("MFA enrollment: BEGIN handles an initially absent secret with a null CAS guard", async () => {
  const h = mfaEnrollmentHarness();
  h.row.platformMfaSecretEncrypted = null;
  const response = await handleMfaEnrollment(request("/mfa", { action: "BEGIN" }), h.deps);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.secret, /^[A-Z2-7]{32}$/);
  assert.match(body.uri, /^otpauth:\/\/totp\//);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(h.row.sessionVersion, 8);
  assert.equal(h.row.platformMfaEnabledAt, null);
  assert.deepEqual(h.counts(), { audits: 0, writes: 1 });
});

test("MFA enrollment: two confirmations of the same snapshot have exactly one winner", async () => {
  const h = mfaEnrollmentHarness();
  let reads = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => { release = resolve; });
  h.hooks.afterRead = async () => {
    if (++reads === 2) release();
    await bothRead;
  };
  const responses = await Promise.all([1, 2].map(() => handleMfaEnrollment(request("/mfa", { action: "CONFIRM", code: totp(h.secret) }), h.deps)));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const success = responses.find((response) => response.status === 200)!;
  const claims = await cookieClaims(success);
  assert.equal(claims?.sessionVersion, 9);
  assert.equal(claims?.mfaVerified, true);
  assert.equal(responses.find((response) => response.status === 409)!.headers.get("set-cookie"), null);
  assert.equal(h.row.sessionVersion, 9);
  assert.ok(h.row.platformMfaEnabledAt instanceof Date);
  assert.deepEqual(h.counts(), { audits: 1, writes: 1 });
});

test("MFA enrollment: revocation after a successful claim is not adopted by the issued cookie", async () => {
  const h = mfaEnrollmentHarness();
  h.hooks.afterAudit = () => { h.row.sessionVersion++; };
  const response = await handleMfaEnrollment(request("/mfa", { action: "CONFIRM", code: totp(h.secret) }), h.deps);
  assert.equal(response.status, 200);
  assert.equal(h.row.sessionVersion, 10);
  assert.equal((await cookieClaims(response))?.sessionVersion, 9);
  assert.deepEqual(h.counts(), { audits: 1, writes: 1 });
});

test("login: account and client throttles remain enforced without sessions or upgrades", async () => {
  const blocked = () => Promise.resolve(new Response("limited", { status: 429 }) as never);
  const deps = { db: fakeDb({}), rateLimit: noLimit, identityRateLimit: noLimit };
  for (const override of [{ rateLimit: blocked }, { identityRateLimit: blocked }]) {
    const response = await handleLogin(request("/login", { email: "synthetic@test.invalid", password }), { ...deps, ...override });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("request OTP: recipient lookup/delivery happen only after identical responses; no unknown-recipient SMS", async () => {
  const tasks: Array<() => Promise<void>> = [];
  let selected: object | null = null;
  let lookups = 0;
  const sent: string[] = [];
  const cleanup: unknown[] = [];
  const deps = {
    db: fakeDb({
      user: { findUnique: async () => { lookups++; return selected; } },
      otpToken: { deleteMany: async (args: unknown) => { cleanup.push(args); return { count: 1 }; }, create: async () => ({}) },
      $transaction: async (callback: (tx: object) => Promise<void>, options: { isolationLevel: string }) => {
        assert.equal(options.isolationLevel, "Serializable");
        await callback({ otpToken: {
          deleteMany: async (args: unknown) => { cleanup.push(args); return { count: 1 }; },
          create: async () => ({}),
        } });
      },
    }), rateLimit: noLimit, identityRateLimit: noLimit, configured: () => true,
    schedule: (task: () => Promise<void>) => { tasks.push(task); },
    sendSms: async (recipient: string) => { sent.push(recipient); throw new Error("synthetic provider failure with private details"); },
  };
  const registered = await handleRequestOtp(request("/request-otp", { phone }), deps);
  const unknown = await handleRequestOtp(request("/request-otp", { phone: "+79160000000" }), deps);
  assert.equal(registered.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(await registered.text(), await unknown.text());
  assert.equal(lookups, 0);
  assert.deepEqual(sent, []);
  selected = { agent: { id: 1, status: "ACTIVE" } };
  const originalLog = console.error;
  const logs: string[] = [];
  console.error = (...parts) => logs.push(parts.map(String).join(" "));
  try { await tasks[0]!(); } finally { console.error = originalLog; }
  selected = null;
  await tasks[1]!();
  assert.deepEqual(sent, [phone]);
  assert.match(logs.join(" "), /OTP_DELIVERY_UNAVAILABLE/);
  assert.doesNotMatch(logs.join(" "), /private details|7916/);
  assert.equal(cleanup.length, 2);
  assert.ok((cleanup[1] as { where: { codeHash?: string } }).where.codeHash);
});

test("OTP: configuration failures return 503 before DB/SMS; no development bypass", async () => {
  delete process.env.APP_ENCRYPTION_KEY;
  const deps = { db: fakeDb({}), rateLimit: noLimit, identityRateLimit: noLimit };
  for (const response of [
    await handleRequestOtp(request("/request-otp", { phone }), { ...deps, configured: () => true }),
    await handleVerifyOtp(request("/verify-otp", { phone, code: "123456" }), deps),
    await handleLogin(request("/login", { email: "synthetic@test.invalid", password }), deps),
  ]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "5");
    assert.equal(response.headers.get("set-cookie"), null);
  }
  process.env.APP_ENCRYPTION_KEY = "synthetic-explicit-development-key";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  const response = await handleVerifyOtp(request("/verify-otp", { phone, code: "0000" }), deps);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("request OTP: provider-wide misconfiguration is recipient-independent and never schedules", async () => {
  for (const recipient of [phone, "+79160000000"]) {
    const response = await handleRequestOtp(request("/request-otp", { phone: recipient }), {
      db: fakeDb({}), rateLimit: noLimit, identityRateLimit: noLimit, configured: () => false,
      schedule: () => { throw new Error("must not schedule without provider configuration"); },
    });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "5");
    assert.deepEqual(await response.json(), { error: "Сервис временно недоступен" });
  }
});

test("verify OTP: invalid/absent codes stay generic and never issue cookies", async () => {
  for (const otp of [null, { id: "synthetic", codeHash: hashOtp("654321", phone) }]) {
    const response = await handleVerifyOtp(request("/verify-otp", { phone, code: "123456" }), {
      db: fakeDb({ otpToken: { findFirst: async () => otp } }), rateLimit: noLimit, identityRateLimit: noLimit,
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { error: "Неверный или просроченный код" });
  }
});

test("verify OTP: concurrent valid attempts consume once and sign the observed session version", async () => {
  let consumed = false;
  const storedHash = hashOtp("123456", phone);
  const deps = {
    db: fakeDb({
      otpToken: {
        findFirst: async () => ({ id: 99, phone, codeHash: storedHash }),
        deleteMany: async (input: { where: { id: number; phone: string; codeHash: string; expiresAt: object } }) => {
          assert.equal(input.where.id, 99);
          assert.equal(input.where.phone, phone);
          assert.equal(input.where.codeHash, storedHash);
          assert.ok(input.where.expiresAt);
          if (consumed) return { count: 0 };
          consumed = true;
          return { count: 1 };
        },
      },
      user: { findUnique: async () => ({ id: 1, name: "Synthetic", sessionVersion: 8, agent: { id: 2, status: "ACTIVE" }, memberships: [{ id: "member-1", agentId: 2 }] }) },
    }), rateLimit: noLimit, identityRateLimit: noLimit,
  };
  const responses = await Promise.all([1, 2].map(() => handleVerifyOtp(request("/verify-otp", { phone, code: "123456" }), deps)));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
  const success = responses.find((response) => response.status === 200)!;
  assert.equal((await cookieClaims(success))?.sessionVersion, 8);
  assert.equal((await cookieClaims(success))?.mfaVerified, undefined);
  for (const flag of [/Secure/i, /HttpOnly/i, /SameSite=lax/i]) assert.match(success.headers.get("set-cookie")!, flag);
  assert.equal(responses.find((response) => response.status === 401)!.headers.get("set-cookie"), null);
});

test("legacy demo OTP: explicit demo gate uses shared secure, version-bound cookies", async () => {
  process.env.DEMO_MODE = "1";
  let claimed = false;
  const response = await handleVerifyOtp(request("/verify-otp", { phone: "+79990000000", code: "0000" }), {
    db: fakeDb({}), rateLimit: noLimit, identityRateLimit: noLimit,
    demo: async () => ({ userId: 1, agentId: 2, name: "Synthetic Demo" }),
    createDemoSession: async (input) => { claimed = true; assert.equal(input.userId, 1); return "synthetic-demo-token"; },
  });
  assert.equal(response.status, 200);
  assert.equal(claimed, true);
  assert.match(response.headers.get("set-cookie")!, /Secure/);
});

test("logout: clears the same cookie scope with full production flags and no caching", async () => {
  const response = await logout();
  const cookie = response.headers.get("set-cookie")!;
  for (const flag of [/Secure/i, /HttpOnly/i, /SameSite=lax/i, /Path=\//i, /Max-Age=0/i]) assert.match(cookie, flag);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("legacy lead reads: missing key is a retryable 503 before authentication or DB reads", async () => {
  delete process.env.APP_ENCRYPTION_KEY;
  for (const response of [
    await readLeads(new NextRequest("http://localhost/leads")),
    await readLead(new NextRequest("http://localhost/leads/1"), { params: Promise.resolve({ leadId: "1" }) }),
  ]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "5");
    assert.equal((await response.json()).code, "AUTH_CRYPTO_UNAVAILABLE");
  }
});
