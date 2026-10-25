import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { NextRequest } from "next/server";
import { hashPassword, verifyPassword } from "../lib/password";

const require = createRequire(import.meta.url);
type Payload = { userId: number; sessionVersion: number; activeMembershipId: string; mfaVerified: boolean; name?: string };
type Credential = { passwordHash: string | null; sessionVersion: number };
const currentPassword = "synthetic-current-password";
const nextPassword = "synthetic-next-password";
const initialHash = hashPassword(currentPassword);

function load<T>(file: string, mocks: Record<string, unknown>): T {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, module: { exports }, process: { env: { NODE_ENV: "production" } }, require: (name: string) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
    return mocks[name];
  } });
  return exports as T;
}

function harness() {
  const credential: Credential = { passwordHash: initialHash, sessionVersion: 7 };
  const membership = { id: "member-1", agentId: 2, role: "FINANCE" };
  const tokens = new Map<string, Payload>();
  tokens.set("original", { userId: 1, sessionVersion: 7, activeMembershipId: membership.id, mfaVerified: true });
  tokens.set("other-device", { ...tokens.get("original")! });
  const signed: Payload[] = [];
  const hooks: {
    beforeCredentialRead?: () => void;
    beforeCas?: () => Promise<void>;
    beforeSign?: () => void;
  } = {};
  let casAttempts = 0;
  let writes = 0;
  const prisma = { user: {
    findUnique: async ({ select }: { select: Record<string, unknown> }) => {
      if (select.passwordHash) hooks.beforeCredentialRead?.();
      return { id: 1, ...credential, name: "Synthetic staff", email: "staff@test.invalid", platformRole: "USER",
        platformMfaEnabledAt: new Date(0), memberships: [membership] };
    },
    updateMany: async ({ where, data }: {
      where: { id: number; passwordHash: string; sessionVersion: number };
      data: { passwordHash: string; sessionVersion: { increment: number } };
    }) => {
      casAttempts++;
      await hooks.beforeCas?.();
      assert.equal(where.id, 1);
      assert.equal(data.sessionVersion.increment, 1);
      if (where.passwordHash !== credential.passwordHash || where.sessionVersion !== credential.sessionVersion) return { count: 0 };
      credential.passwordHash = data.passwordHash;
      credential.sessionVersion += data.sessionVersion.increment;
      writes++;
      return { count: 1 };
    },
  } };
  const sessions = {
    SESSION_COOKIE: "test-session",
    verifySession: async (token: string) => tokens.get(token) ?? null,
    signSession: async (payload: Payload) => {
      hooks.beforeSign?.();
      signed.push(payload);
      const token = `replacement-${signed.length}`;
      tokens.set(token, payload);
      return token;
    },
  };
  const auth = load<typeof import("../lib/auth")>("../lib/auth.ts", {
    "next/headers": { cookies: () => { throw new Error("Request cookies required"); } },
    "./session": sessions,
    "./prisma": { prisma },
    "./operationalAuth": { resolveOperationalContextForUser: async () => ({
      userId: 1, agentId: 2, membershipId: membership.id, organizationId: "org-1", role: "FINANCE", platformRole: "USER",
    }) },
  });
  const agentAuth = load<typeof import("../lib/agentAuth")>("../lib/agentAuth.ts", {
    "@/lib/prisma": { prisma }, "@/lib/session": sessions,
  });
  const route = load<typeof import("../app/api/agent/settings/password/route")>("../app/api/agent/settings/password/route.ts", {
    "next/server": require("next/server"), zod: require("zod"),
    "@/lib/auth": auth, "@/lib/agentAuth": agentAuth, "@/lib/prisma": { prisma },
    "@/lib/password": { hashPassword, verifyPassword },
    "@/lib/apiAuth": { handleApiError: () => Response.json({ error: "Unavailable" }, { status: 503 }) },
  });
  const request = (token = "original", current = currentPassword, next = nextPassword) => new Request("http://localhost/api/agent/settings/password", {
    method: "POST", headers: { cookie: `test-session=${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ current, next }),
  }) as NextRequest;
  return { credential, tokens, signed, hooks, auth, route, request, counts: () => ({ casAttempts, writes }) };
}

test("password change atomically replaces the credential, revokes old sessions and preserves caller membership/MFA", async () => {
  const h = harness();
  const response = await h.route.POST(h.request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(h.credential.sessionVersion, 8);
  assert.equal(verifyPassword(nextPassword, h.credential.passwordHash), true);
  assert.equal(verifyPassword(currentPassword, h.credential.passwordHash), false);
  assert.deepEqual(h.counts(), { casAttempts: 1, writes: 1 });
  assert.equal(h.signed[0].sessionVersion, 8);
  assert.equal(h.signed[0].activeMembershipId, "member-1");
  assert.equal(h.signed[0].mfaVerified, true);
  assert.match(response.headers.get("set-cookie")!, /test-session=replacement-1/);
  assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
  assert.match(response.headers.get("set-cookie")!, /Secure/i);
  assert.match(response.headers.get("set-cookie")!, /SameSite=lax/i);
  assert.equal(response.headers.get("cache-control"), "no-store");
  for (const token of ["original", "other-device"]) {
    assert.equal(await h.auth.getCurrentUserSessionFromRequest(h.request(token)), null);
    assert.equal((await h.route.POST(h.request(token))).status, 401);
  }
  const replacement = await h.auth.getCurrentUserSessionFromRequest(h.request("replacement-1"));
  assert.equal(replacement?.sessionVersion, 8);
  assert.deepEqual(h.counts(), { casAttempts: 1, writes: 1 });
});

test("wrong current password or invalid next password preserves the credential and sessions", async () => {
  for (const [current, next] of [["wrong-password", nextPassword], [currentPassword, "short"]]) {
    const h = harness();
    assert.equal((await h.route.POST(h.request("original", current, next))).status, 400);
    assert.deepEqual(h.credential, { passwordHash: initialHash, sessionVersion: 7 });
    assert.deepEqual(h.counts(), { casAttempts: 0, writes: 0 });
    assert.equal(h.signed.length, 0);
    assert.ok(await h.auth.getCurrentUserSessionFromRequest(h.request()));
  }
});

test("missing password and unknown or stale session never write credentials", async () => {
  const h = harness();
  for (const token of ["unknown", "stale"]) {
    h.tokens.set("stale", { ...h.tokens.get("original")!, sessionVersion: 6 });
    assert.equal((await h.route.POST(h.request(token))).status, 401);
  }
  h.credential.passwordHash = null;
  assert.equal((await h.route.POST(h.request())).status, 400);
  assert.deepEqual(h.counts(), { casAttempts: 0, writes: 0 });
  assert.equal(h.signed.length, 0);
});

test("revocation between authentication and credential read is rejected", async () => {
  const h = harness();
  h.hooks.beforeCredentialRead = () => { h.credential.sessionVersion++; };
  assert.equal((await h.route.POST(h.request())).status, 401);
  assert.equal(h.credential.passwordHash, initialHash);
  assert.deepEqual(h.counts(), { casAttempts: 0, writes: 0 });
});

test("CAS preserves a concurrent password change even if it did not increment the version", async () => {
  const h = harness();
  const competingHash = hashPassword("synthetic-competing-password");
  h.hooks.beforeCas = async () => { h.credential.passwordHash = competingHash; };
  const response = await h.route.POST(h.request());
  assert.equal(response.status, 409);
  assert.equal(h.credential.passwordHash, competingHash);
  assert.equal(h.credential.sessionVersion, 7);
  assert.equal(h.signed.length, 0);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("CAS preserves a concurrent session revocation without overwriting the password", async () => {
  const h = harness();
  h.hooks.beforeCas = async () => { h.credential.sessionVersion++; };
  assert.equal((await h.route.POST(h.request())).status, 409);
  assert.deepEqual(h.credential, { passwordHash: initialHash, sessionVersion: 8 });
  assert.deepEqual(h.counts(), { casAttempts: 1, writes: 0 });
  assert.equal(h.signed.length, 0);
});

test("two simultaneous changes of the same credential have exactly one winner", async () => {
  const h = harness();
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let arrivals = 0;
  h.hooks.beforeCas = async () => { if (++arrivals === 2) release(); await barrier; };
  const responses = await Promise.all([
    h.route.POST(h.request("original", currentPassword, "synthetic-first-password")),
    h.route.POST(h.request("original", currentPassword, "synthetic-second-password")),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const winner = responses[0].status === 200 ? "synthetic-first-password" : "synthetic-second-password";
  assert.equal(verifyPassword(winner, h.credential.passwordHash), true);
  assert.equal(h.credential.sessionVersion, 8);
  assert.deepEqual(h.counts(), { casAttempts: 2, writes: 1 });
  assert.equal(h.signed.length, 1);
});

test("replacement session cannot adopt a revocation after the successful CAS", async () => {
  const h = harness();
  h.hooks.beforeSign = () => { h.credential.sessionVersion++; };
  assert.equal((await h.route.POST(h.request())).status, 200);
  assert.equal(h.credential.sessionVersion, 9);
  assert.equal(h.signed[0].sessionVersion, 8);
  assert.equal(await h.auth.getCurrentUserSessionFromRequest(h.request("replacement-1")), null);
});
