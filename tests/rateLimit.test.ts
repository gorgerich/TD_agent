import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../lib/rateLimit";

test("rateLimit: allows up to limit then blocks", () => {
  const key = `t-${Math.random()}`;
  for (let i = 0; i < 3; i++) assert.equal(rateLimit(key, 3, 10_000).ok, true);
  const blocked = rateLimit(key, 3, 10_000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0);
});

test("rateLimit: separate keys independent", () => {
  const a = `a-${Math.random()}`;
  const b = `b-${Math.random()}`;
  assert.equal(rateLimit(a, 1, 10_000).ok, true);
  assert.equal(rateLimit(a, 1, 10_000).ok, false);
  assert.equal(rateLimit(b, 1, 10_000).ok, true);
});

test("rateLimit: window reset re-allows", async () => {
  const key = `w-${Math.random()}`;
  assert.equal(rateLimit(key, 1, 30).ok, true);
  assert.equal(rateLimit(key, 1, 30).ok, false);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(rateLimit(key, 1, 30).ok, true);
});
