import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import {
  assertReleaseWritesAllowed,
  evaluateReleaseWriteFreeze,
  isReleaseWriteFreezeActive,
} from "../lib/releaseWriteFreeze";

test("release write freeze is off only when unset or explicitly disabled", () => {
  assert.equal(isReleaseWriteFreezeActive(undefined), false);
  assert.equal(isReleaseWriteFreezeActive("disabled"), false);
  assert.equal(isReleaseWriteFreezeActive("DISABLED"), false);
  assert.equal(isReleaseWriteFreezeActive("enabled"), true);
  assert.equal(isReleaseWriteFreezeActive(""), true);
  assert.equal(isReleaseWriteFreezeActive("typo"), true);
});

test("freeze allows password login and ordinary reads", () => {
  assert.deepEqual(
    evaluateReleaseWriteFreeze({ method: "POST", pathname: "/api/agent/auth/login" }, "enabled"),
    { active: true, blocked: false, reason: "auth-session" },
  );
  assert.equal(evaluateReleaseWriteFreeze({ method: "POST", pathname: "/api/agent/auth/logout" }, "enabled").blocked, false);
  assert.equal(
    evaluateReleaseWriteFreeze({ method: "POST", pathname: "/api/platform-admin/owner-recovery" }, "enabled").blocked,
    false,
  );
  assert.equal(evaluateReleaseWriteFreeze({ method: "GET", pathname: "/agent/cases" }, "enabled").blocked, false);
  assert.equal(evaluateReleaseWriteFreeze({ method: "GET", pathname: "/agent/login" }, "enabled").blocked, false);
  assert.equal(evaluateReleaseWriteFreeze({ method: "GET", pathname: "/api/health" }, "enabled").blocked, false);
});

test("freeze blocks mutations, server actions, webhooks, demo auth and write-on-GET co-view", () => {
  const blocked = [
    { method: "POST", pathname: "/api/agent/auth/demo" },
    { method: "POST", pathname: "/api/agent/auth/register" },
    { method: "POST", pathname: "/api/agent/auth/request-otp" },
    { method: "POST", pathname: "/api/agent/auth/verify-otp" },
    { method: "DELETE", pathname: "/api/agent/cases/1/documents/1" },
    { method: "POST", pathname: "/api/agent/cases/1/documents" },
    { method: "PATCH", pathname: "/api/agent/cases/1/intake" },
    { method: "DELETE", pathname: "/api/agent/cases/1/notes/1" },
    { method: "POST", pathname: "/api/agent/cases/1/notes" },
    { method: "POST", pathname: "/api/agent/cases/1/payments" },
    { method: "DELETE", pathname: "/api/agent/cases/1/payments" },
    { method: "PATCH", pathname: "/api/agent/cases/1/tasks/1" },
    { method: "DELETE", pathname: "/api/agent/cases/1/tasks/1" },
    { method: "POST", pathname: "/api/agent/cases/1/tasks" },
    { method: "DELETE", pathname: "/api/agent/catalog/1" },
    { method: "POST", pathname: "/api/agent/catalog" },
    { method: "POST", pathname: "/api/agent/leads" },
    { method: "POST", pathname: "/api/agent/meeting/1/quote" },
    { method: "PUT", pathname: "/api/agent/meeting/1/session" },
    { method: "PATCH", pathname: "/api/agent/meetings/1" },
    { method: "POST", pathname: "/api/agent/meetings" },
    { method: "POST", pathname: "/api/agent/onboarding" },
    { method: "POST", pathname: "/api/agent/settings/notify" },
    { method: "POST", pathname: "/api/agent/settings/password" },
    { method: "POST", pathname: "/api/platform-admin/mfa" },
    { method: "POST", pathname: "/api/platform-admin/activation" },
    { method: "POST", pathname: "/api/co/synthetic-code/agree" },
    { method: "PATCH", pathname: "/api/co/synthetic-code" },
    { method: "POST", pathname: "/agent/cases", label: "server action" },
    { method: "POST", pathname: "/api/webhooks/order-complete" },
    { method: "GET", pathname: "/api/co/synthetic-code" },
    { method: "GET", pathname: "/co/synthetic-code" },
  ];
  for (const request of blocked) {
    assert.equal(evaluateReleaseWriteFreeze(request, "enabled").blocked, true, request.label ?? request.pathname);
  }
});

test("direct seed guards fail before database access", () => {
  assert.throws(() => assertReleaseWritesAllowed("test", "enabled"), /refused before database access/);
  assert.doesNotThrow(() => assertReleaseWritesAllowed("test", "disabled"));
});

test("proxy returns controlled 503 before a frozen mutation reaches a route", () => {
  const previous = process.env.RELEASE_WRITE_FREEZE;
  process.env.RELEASE_WRITE_FREEZE = "enabled";
  try {
    const blocked = proxy(new NextRequest("http://localhost/api/agent/leads", { method: "POST" }));
    assert.equal(blocked.status, 503);
    assert.equal(blocked.headers.get("x-release-write-freeze"), "active");
    assert.equal(blocked.headers.get("retry-after"), "60");

    const login = proxy(new NextRequest("http://localhost/api/agent/auth/login", { method: "POST" }));
    assert.notEqual(login.status, 503);
  } finally {
    if (previous === undefined) delete process.env.RELEASE_WRITE_FREEZE;
    else process.env.RELEASE_WRITE_FREEZE = previous;
  }
});
