import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import nodeCrypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { hashPassword, passwordNeedsUpgrade, PASSWORD_ITERATIONS, PASSWORD_MAX_VERIFY_ITERATIONS, verifyPassword, verifyPasswordForLogin } from "../lib/password";

test("password: verifies correct password", () => {
  const h = hashPassword("correct horse battery");
  assert.ok(h.startsWith("pbkdf2$"));
  assert.equal(verifyPassword("correct horse battery", h), true);
});

test("password: rejects wrong password", () => {
  const h = hashPassword("right");
  assert.equal(verifyPassword("wrong", h), false);
});

test("password: rejects null/garbage hash", () => {
  assert.equal(verifyPassword("x", null), false);
  assert.equal(verifyPassword("x", "not-a-hash"), false);
});

test("password: same input → different hash (random salt)", () => {
  assert.notEqual(hashPassword("a"), hashPassword("a"));
});

test("password: bounded parser rejects malformed cost/encoding before deriving", () => {
  const salt = Buffer.alloc(16, 7).toString("base64url");
  const digest = Buffer.alloc(32).toString("base64url");
  for (const rounds of ["0", "-1", "1.5", "1e6", " 600000", "0600000", "NaN", "Infinity", "1200001", "2147483647"]) {
    const encoded = `pbkdf2$${rounds}$${salt}$${digest}`;
    assert.equal(verifyPassword("x", encoded), false, rounds);
    assert.equal(passwordNeedsUpgrade(encoded), false, rounds);
  }
  for (const encoded of [
    `pbkdf2$600000$${salt}$${digest}$extra`,
    `pbkdf2$600000$${salt}$${digest}=`,
    `pbkdf2$600000$short$${digest}`,
    `pbkdf2$600000$${salt}$${"!".repeat(43)}`,
    "x".repeat(10000),
  ]) assert.equal(verifyPassword("x", encoded), false);
});

test("password: retains legacy encoded-salt semantics and upgrades only valid low-cost hashes", () => {
  const salt = Buffer.alloc(16, 9).toString("base64url");
  const digest = pbkdf2Sync("legacy", salt, 210000, 32, "sha256").toString("base64url");
  const legacy = `pbkdf2$210000$${salt}$${digest}`;
  assert.equal(verifyPassword("legacy", legacy), true);
  assert.equal(verifyPasswordForLogin("legacy", legacy), true);
  assert.equal(verifyPasswordForLogin("wrong", legacy), false);
  assert.equal(passwordNeedsUpgrade(legacy), true);
  const current = hashPassword("legacy");
  assert.equal(current.split("$")[1], String(PASSWORD_ITERATIONS));
  assert.equal(passwordNeedsUpgrade(current), false);
  assert.equal(passwordNeedsUpgrade(current.replace("$600000$", "$1200000$")), false);
  assert.equal(verifyPasswordForLogin("legacy", current), true);
  assert.equal(verifyPasswordForLogin("legacy", null), false);
  assert.equal(verifyPasswordForLogin("legacy", "malformed"), false);
});

test("password: all failure paths perform the bounded maximum KDF budget; malformed hashes never control work", () => {
  const iterations: number[] = [];
  const kdf = mock.method(nodeCrypto, "pbkdf2Sync", (_password: unknown, _salt: unknown, count: number) => {
    iterations.push(count);
    return Buffer.alloc(32);
  });
  syncBuiltinESMExports();
  try {
    const salt = Buffer.alloc(16).toString("base64url");
    const digest = Buffer.alloc(32, 1).toString("base64url");
    for (const hash of [null, "bad", `pbkdf2$210000$${salt}$${digest}`, `pbkdf2$600000$${salt}$${digest}`, `pbkdf2$1200000$${salt}$${digest}`]) {
      iterations.length = 0;
      assert.equal(verifyPasswordForLogin("wrong", hash), false);
      assert.equal(iterations.reduce((sum, count) => sum + count, 0), PASSWORD_MAX_VERIFY_ITERATIONS);
    }
    iterations.length = 0;
    assert.equal(verifyPassword("wrong", `pbkdf2$2147483647$${salt}$${digest}`), false);
    assert.deepEqual(iterations, []);
  } finally {
    kdf.mock.restore();
    syncBuiltinESMExports();
  }
});
