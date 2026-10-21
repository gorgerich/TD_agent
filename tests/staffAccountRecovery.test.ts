import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildStaffRecoveryUrl, hashStaffRecoveryToken, isStaffRecoveryToken, staffRecoveryOrigin, StaffAccountRecoveryError, STAFF_RECOVERY_INVALID_MESSAGE, STAFF_RECOVERY_TTL_MS } from "../lib/staffAccountRecovery";
import { PlatformActivationError, validatePlatformAdminPassword } from "../lib/platformActivation";
import { evaluateReleaseWriteFreeze } from "../lib/releaseWriteFreeze";

const require = createRequire(import.meta.url);
function publicRoute() {
  const source = readFileSync(new URL("../app/api/agent/auth/staff-recovery/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls: string[] = [];
  const faults: { verify?: Error; consume?: Error; limiter?: Response; identityLimiter?: Response; infrastructure?: boolean } = {};
  let frozen = false;
  const exports: { POST?: (req: Request) => Promise<Response> } = {};
  const mocks: Record<string, unknown> = {
    "next/server": require("next/server"), zod: require("zod"),
    "@/lib/agentAuth": {
      createVersionBoundUserSession: async (p: { userId: number; sessionVersion: number; activeMembershipId: string; mfaVerified: boolean }) => {
        assert.deepEqual(JSON.parse(JSON.stringify(p)), { userId: 4, sessionVersion: 9, activeMembershipId: "staff-member", mfaVerified: true });
        calls.push("sign"); return "synthetic-session";
      },
      setAgentSessionCookie: (response: Response) => { response.headers.set("set-cookie", "synthetic-session"); return response; },
    },
    "@/lib/password": { hashPassword: (password: string) => { assert.equal(password, "Synthetic recovered staff 2026!"); calls.push("hash"); return "synthetic-hash"; } },
    "@/lib/platformActivation": { PlatformActivationError, validatePlatformAdminPassword },
    "@/lib/persistentRateLimit": {
      enforcePersistentRateLimit: async (_request: Request, bucket: string, limit: number) => {
        calls.push("ip-limit"); assert.equal(bucket, "staff-recovery-ip"); assert.equal(limit, 12); return faults.limiter ?? null;
      },
      enforcePersistentIdentityRateLimit: async (bucket: string, identity: string, limit: number, windowMs: number) => {
        calls.push("identity-limit"); assert.match(bucket, /^staff-recovery-(verify|consume)$/);
        assert.match(identity, /^[a-f0-9]{64}$/); assert.equal(windowMs, STAFF_RECOVERY_TTL_MS);
        assert.equal(limit, bucket.endsWith("verify") ? 8 : 5); return faults.identityLimiter ?? null;
      },
    },
    "@/lib/operationalAuth": { operationalLanding: () => "/agent/finance" },
    "@/lib/operationalTransaction": { runOperationalTransaction: async (work: (tx: object) => Promise<unknown>) => {
      if (faults.infrastructure) throw new Error("synthetic private database detail"); return work({});
    } },
    "@/lib/releaseWriteFreeze": { isReleaseWriteFreezeActive: () => frozen },
    "@/lib/staffAccountRecovery": {
      StaffAccountRecoveryError, STAFF_RECOVERY_INVALID_MESSAGE, hashStaffRecoveryToken,
      verifyStaffAccountRecovery: async () => { calls.push("verify"); if (faults.verify) throw faults.verify; return { secret: "SYNTHETIC", uri: "otpauth://synthetic", resetMfa: true }; },
      consumeStaffAccountRecovery: async (_tx: object, input: { passwordHash: string; mfaCode: string }) => {
        calls.push("consume"); assert.equal(input.passwordHash, "synthetic-hash"); assert.equal(input.mfaCode, "123456");
        if (faults.consume) throw faults.consume;
        return { userId: 4, membershipId: "staff-member", role: "FINANCE", sessionVersion: 9, mfaVerified: true };
      },
    },
  };
  vm.runInNewContext(compiled, { exports, module: { exports }, require: (name: string) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`); return mocks[name];
  } });
  const recover = { action: "RECOVER", token: "A".repeat(43), password: "Synthetic recovered staff 2026!", confirmation: "Synthetic recovered staff 2026!", mfaCode: "123456" };
  const request = (body: unknown) => exports.POST!(new Request("http://localhost/api/agent/auth/staff-recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { request, recover, calls, faults, freeze: () => { frozen = true; } };
}

test("staff bearer is 256-bit CSPRNG-compatible, hash-only and transported in an exact fragment URL", () => {
  const token = randomBytes(32).toString("base64url");
  assert.equal(isStaffRecoveryToken(token), true);
  assert.match(hashStaffRecoveryToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashStaffRecoveryToken(token), token);
  const url = new URL(buildStaffRecoveryUrl(token, { VERCEL: "1", VERCEL_ENV: "production" }));
  assert.equal(url.origin, "https://td-agent.vercel.app"); assert.equal(url.pathname, "/setup/staff-recovery");
  assert.equal(url.search, ""); assert.equal(new URLSearchParams(url.hash.slice(1)).get("token"), token);
  for (const value of ["", "A".repeat(42), "A".repeat(44), "?".repeat(43)]) {
    assert.equal(isStaffRecoveryToken(value), false); assert.throws(() => buildStaffRecoveryUrl(value), StaffAccountRecoveryError);
  }
});

test("Preview recovery links bind exact trusted deployment host and never fall back to Production or caller origin", () => {
  const env = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "fix/m3-cpo-audit-repair", VERCEL_URL: "td-agent-synthetic-preview.vercel.app" };
  const url = new URL(buildStaffRecoveryUrl("A".repeat(43), env));
  assert.equal(url.origin, "https://td-agent-synthetic-preview.vercel.app");
  assert.notEqual(url.origin, "https://td-agent.vercel.app"); assert.equal(url.search, "");
  for (const host of ["td-agent.vercel.app", "https://td-agent-safe.vercel.app", "evil.example", "td-agent-safe.vercel.app.evil.example", "user@td-agent-safe.vercel.app", "td-agent-safe.vercel.app/path", "td-agent-safe.vercel.app?next=evil", "td-agent-safe.vercel.app:8443", ""]) {
    assert.throws(() => staffRecoveryOrigin({ ...env, VERCEL_URL: host }), { status: 503 });
  }
  assert.throws(() => staffRecoveryOrigin({ ...env, VERCEL_GIT_COMMIT_REF: "unapproved-branch" }), { status: 503 });
  assert.throws(() => staffRecoveryOrigin({ ...env, VERCEL: undefined }), { status: 503 });
  assert.equal(staffRecoveryOrigin({ ...env, VERCEL_ENV: "production", VERCEL_URL: "attacker.example" }), "https://td-agent.vercel.app");
});

test("local recovery URL requires explicit loopback origin plus exact isolated local database, never a Production test flag", () => {
  const local = "postgresql://synthetic@127.0.0.1:5432/td_agent_test?schema=it_synthetic";
  const env = { ALLOW_DB_TESTS: "1", STAFF_RECOVERY_LOCAL_ORIGIN: "http://127.0.0.1:3001", TEST_DATABASE_URL: local, DATABASE_URL: local, DATABASE_URL_UNPOOLED: local };
  assert.equal(staffRecoveryOrigin(env), "http://127.0.0.1:3001");
  for (const origin of ["https://evil.example", "http://user@127.0.0.1:3001", "http://127.0.0.1:3001/path", "http://127.0.0.1:3001?x=y", "http://127.0.0.1:3001#token=x", ""]) {
    assert.throws(() => staffRecoveryOrigin({ ...env, STAFF_RECOVERY_LOCAL_ORIGIN: origin }), { status: 503 });
  }
  assert.throws(() => staffRecoveryOrigin({ ...env, DATABASE_URL: "postgresql://synthetic@remote.invalid/td_agent_test" }), { status: 503 });
  assert.throws(() => staffRecoveryOrigin({ ...env, VERCEL_ENV: "production" }), { status: 503 });
  assert.throws(() => staffRecoveryOrigin({ ...env, ALLOW_DB_TESTS: undefined }), { status: 503 });
});

test("staff recovery validates password confirmation before hashing and consumes only after verification", async () => {
  const h = publicRoute();
  assert.equal((await h.request({ ...h.recover, confirmation: "not-matching" })).status, 422);
  assert.deepEqual(h.calls, ["ip-limit", "identity-limit", "verify"]);
  h.calls.length = 0;
  const response = await h.request(h.recover);
  assert.equal(response.status, 200);
  assert.deepEqual(h.calls, ["ip-limit", "identity-limit", "verify", "hash", "consume", "sign"]);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("invalid/expired/replayed and incorrect MFA have the same generic response and no replacement session", async () => {
  for (const stage of ["verify", "consume"] as const) {
    const h = publicRoute(); h.faults[stage] = new StaffAccountRecoveryError();
    const response = await h.request(h.recover);
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: STAFF_RECOVERY_INVALID_MESSAGE });
    assert.equal(response.headers.get("set-cookie"), null); assert.equal(h.calls.includes("sign"), false);
    if (stage === "verify") assert.equal(h.calls.includes("hash"), false);
  }
});

test("both persistent limits stop staff recovery before credentials or DB; failures disclose no raw diagnostics", async () => {
  for (const key of ["limiter", "identityLimiter"] as const) {
    const h = publicRoute(); h.faults[key] = Response.json({ error: "Limited" }, { status: 429 });
    assert.equal((await h.request(h.recover)).status, 429); assert.equal(h.calls.includes("verify"), false);
  }
  const h = publicRoute(); h.faults.infrastructure = true;
  const response = await h.request(h.recover);
  assert.equal(response.status, 503); assert.equal((await response.text()).includes("database detail"), false);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("new staff endpoints remain frozen and never inherit the owner recovery exception", async () => {
  for (const pathname of ["/api/agent/auth/staff-recovery", "/api/platform-admin/staff-recovery"]) {
    assert.equal(evaluateReleaseWriteFreeze({ method: "POST", pathname }, "enabled").blocked, true);
  }
  const h = publicRoute(); h.freeze();
  assert.equal((await h.request(h.recover)).status, 503); assert.deepEqual(h.calls, []);
});

test("staff UI handles only fragment bearer in memory, removes URL before verification, and marks sensitive output", () => {
  const client = readFileSync(new URL("../app/setup/staff-recovery/StaffRecoveryClient.tsx", import.meta.url), "utf8");
  const issuer = readFileSync(new URL("../app/platform-admin/users/[userId]/StaffRecoveryControl.tsx", import.meta.url), "utf8");
  assert.ok(client.indexOf("window.history.replaceState") < client.indexOf("void verify(bearer)"));
  assert.ok(client.includes("window.location.hash.slice(1)"));
  assert.ok(client.includes('data-sensitive="staff-recovery-mfa"'));
  assert.ok(issuer.includes('data-sensitive="staff-recovery-url"'));
  for (const source of [client, issuer]) assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|sendBeacon/);
  assert.ok(client.includes('setToken(null); setSetup(null); setPassword(""); setConfirmation(""); setCode("");'));
});
