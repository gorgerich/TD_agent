import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../lib/password";

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
