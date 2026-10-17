import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { NextRequest } from "next/server";
import * as sessions from "../lib/session";
import { handleApiError } from "../lib/apiAuth";
import { AuthenticationError, getAgentSession, getCurrentUserSession } from "../lib/auth";

const require = createRequire(import.meta.url);
const savedKey = process.env.APP_ENCRYPTION_KEY;
beforeEach(() => { process.env.APP_ENCRYPTION_KEY = "isolated-auth-infrastructure-test-key"; });
afterEach(() => {
  if (savedKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = savedKey;
});

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)((key: string) => (
    Object.hasOwn(dependencies, key) ? dependencies[key] : require(key)
  ), loaded, loaded.exports);
  return loaded.exports as T;
}

function harness() {
  const state = {
    token: undefined as string | undefined,
    cookieError: null as Error | null,
    databaseError: null as Error | null,
    reads: 0,
    row: { id: 1, name: "Synthetic", email: null, platformRole: "USER", sessionVersion: 8,
      platformMfaEnabledAt: null, memberships: [{ id: "member", agentId: 2, role: "AGENT" }] } as object | null,
  };
  const auth = load<typeof import("../lib/auth")>("lib/auth.ts", {
    "next/headers": { cookies: async () => {
      if (state.cookieError) throw state.cookieError;
      return { get: () => state.token ? { value: state.token } : undefined };
    } },
    "./session": sessions,
    "./prisma": { prisma: { user: { findUnique: async () => {
      state.reads++;
      if (state.databaseError) throw state.databaseError;
      return state.row;
    } } } },
    "./operationalAuth": { resolveOperationalContextForUser: async () => ({
      userId: 1, agentId: 2, membershipId: "member", organizationId: "org", role: "AGENT",
    }) },
  });
  const request = () => new NextRequest("http://localhost/synthetic", {
    method: "POST", headers: state.token ? { cookie: sessions.SESSION_COOKIE + "=" + state.token } : {},
  });
  return { state, auth, request };
}

test("auth infrastructure: no cookie remains anonymous even without keys or DB", async () => {
  const h = harness();
  delete process.env.APP_ENCRYPTION_KEY;
  h.state.databaseError = new Error("must not access database");
  assert.equal(await h.auth.getCurrentUserSession(), null);
  assert.equal(await h.auth.getAgentSession(), null);
  assert.equal(await h.auth.getCurrentUserSessionFromRequest(h.request()), null);
  assert.equal(await h.auth.getSessionFromRequest(h.request()), null);
  assert.equal(h.state.reads, 0);
});

test("auth infrastructure: malformed, tampered and expired cookies remain anonymous with configured keys", async (t) => {
  const h = harness();
  const valid = await sessions.signSession({ userId: 1, sessionVersion: 8 });
  const now = Date.now();
  t.mock.method(Date, "now", () => now - 9 * 60 * 60 * 1000);
  const expired = await sessions.signSession({ userId: 1, sessionVersion: 8 });
  t.mock.restoreAll();
  for (const token of ["malformed", valid.slice(0, -1), expired]) {
    h.state.token = token;
    assert.equal(await h.auth.getCurrentUserSession(), null);
    assert.equal(await h.auth.getSessionFromRequest(h.request()), null);
  }
  assert.equal(h.state.reads, 0);
});

test("auth infrastructure: missing user and revoked version remain anonymous", async () => {
  const h = harness();
  h.state.token = await sessions.signSession({ userId: 1, sessionVersion: 7 });
  assert.equal(await h.auth.getCurrentUserSession(), null);
  h.state.row = null;
  assert.equal(await h.auth.getSessionFromRequest(h.request()), null);
});

test("auth infrastructure: verified sessions retain their hydrated membership and MFA state", async () => {
  const h = harness();
  h.state.token = await sessions.signSession({ userId: 1, sessionVersion: 8, activeMembershipId: "member" });
  const user = await h.auth.getCurrentUserSession();
  assert.equal(user?.userId, 1);
  assert.equal(user?.sessionVersion, 8);
  assert.equal(user?.activeMembershipId, "member");
  assert.equal(user?.mfaVerified, false);
  const operational = await h.auth.getSessionFromRequest(h.request());
  assert.equal(operational?.membershipId, "member");
  assert.equal(operational?.mfaVerified, false);
});

test("auth infrastructure: real Next cookie access outside request scope is not swallowed", async () => {
  await assert.rejects(getCurrentUserSession(), /outside a request scope/);
  await assert.rejects(getAgentSession(), /outside a request scope/);
});

test("auth infrastructure: a present cookie with missing keys rejects before hydration", async () => {
  const h = harness();
  h.state.token = await sessions.signSession({ userId: 1, sessionVersion: 8 });
  delete process.env.APP_ENCRYPTION_KEY;
  await assert.rejects(h.auth.getCurrentUserSession(), sessions.ApplicationSecurityKeyUnavailableError);
  await assert.rejects(h.auth.getAgentSession(), sessions.ApplicationSecurityKeyUnavailableError);
  await assert.rejects(h.auth.getSessionFromRequest(h.request()), sessions.ApplicationSecurityKeyUnavailableError);
  assert.equal(h.state.reads, 0);
});

test("auth infrastructure: hydration failures and Next control errors propagate unchanged", async () => {
  const h = harness();
  h.state.token = await sessions.signSession({ userId: 1, sessionVersion: 8 });
  const unavailable = new Error("ECONNREFUSED synthetic-private-canary");
  h.state.databaseError = unavailable;
  await assert.rejects(h.auth.getCurrentUserSession(), (error: unknown) => error === unavailable);
  await assert.rejects(h.auth.getAgentSession(), (error: unknown) => error === unavailable);
  await assert.rejects(h.auth.getSessionFromRequest(h.request()), (error: unknown) => error === unavailable);
  const control = Object.assign(new Error("synthetic Next request control"), { digest: "DYNAMIC_SERVER_USAGE" });
  h.state.cookieError = control;
  await assert.rejects(h.auth.getCurrentUserSession(), (error: unknown) => error === control);
  await assert.rejects(h.auth.getAgentSession(), (error: unknown) => error === control);
});

type Handler = (request: NextRequest, options: { params: Promise<{ leadId: string }> }) => Promise<Response>;
const callers = [
  ["app/api/agent/leads/route.ts", "GET"], ["app/api/agent/leads/route.ts", "POST"],
  ["app/api/agent/leads/[leadId]/route.ts", "GET"], ["app/api/agent/onboarding/route.ts", "POST"],
  ["app/api/agent/settings/password/route.ts", "POST"], ["app/api/agent/settings/notify/route.ts", "POST"],
  ["app/api/agent/commissions/route.ts", "GET"], ["app/api/agent/cases/reconciliation/route.ts", "GET"],
] as const;

test("auth infrastructure: every affected API maps auth key/DB failures safely and preserves 401/403", async () => {
  const originalLog = console.error;
  const logs: string[] = [];
  console.error = (...parts: unknown[]) => { logs.push(parts.map(String).join(" ")); };
  let downstreamCalls = 0;
  try {
    for (const [file, method] of callers) {
      for (const failure of [null, new AuthenticationError(403, "Forbidden"), new sessions.ApplicationSecurityKeyUnavailableError(), new Error("ECONNREFUSED synthetic-private-canary")]) {
        const route = load<Record<string, Handler>>(file, {
          "@/lib/auth": { getSessionFromRequest: async () => { if (failure) throw failure; return null; } },
          "@/lib/prisma": { prisma: new Proxy({}, { get: () => { downstreamCalls++; throw new Error("unexpected downstream access"); } }) },
          "@/lib/apiAuth": { handleApiError },
        });
        const response = await route[method]!(new NextRequest("http://localhost/synthetic", { method }),
          { params: Promise.resolve({ leadId: "1" }) });
        const expectedStatus = failure instanceof AuthenticationError ? 403 : failure ? 503 : 401;
        assert.equal(response.status, expectedStatus, file + ":" + method);
        assert.equal(response.headers.get("set-cookie"), null);
        if (expectedStatus === 503) assert.equal(response.headers.get("Retry-After"), "5");
        assert.doesNotMatch(await response.text(), /synthetic-private-canary|ECONNREFUSED|detail/);
      }
    }
    assert.equal(downstreamCalls, 0);
    assert.doesNotMatch(logs.join(" "), /synthetic-private-canary|ECONNREFUSED/);
  } finally { console.error = originalLog; }
});
