import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, handleApiError, parseId } from "../lib/apiAuth";
import { ApplicationSecurityKeyUnavailableError } from "../lib/session";
import { EncryptedDataUnavailableError } from "../lib/crypto";

test("parseId: accepts positive integers", () => {
  assert.equal(parseId("42"), 42);
  assert.equal(parseId("2147483647"), 2147483647);
});

test("parseId: rejects Prisma Int overflow, unsafe integers and fractions", () => {
  for (const raw of ["2147483648", "9007199254740991", "9007199254740992", "Infinity", "NaN", "1.5"]) {
    assert.throws(() => parseId(raw), (error: unknown) => error instanceof ApiError && error.status === 400);
  }
});

test("API crypto/config failures are retryable and fallback logs contain no raw error", async () => {
  const previous = console.error;
  const logged: string[] = [];
  console.error = (...parts) => logged.push(parts.map(String).join(" "));
  try {
    for (const error of [new EncryptedDataUnavailableError(), new ApplicationSecurityKeyUnavailableError()]) {
      const response = handleApiError(error, "auth-test");
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Retry-After"), "5");
    }
    const response = handleApiError(new Error("synthetic://private-dsn pii-person otp-secret"), "auth-test");
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /private-dsn|pii-person|otp-secret|detail/);
    assert.doesNotMatch(logged.join(" "), /private-dsn|pii-person|otp-secret|synthetic:\/\//);
    assert.match(logged.join(" "), /INTERNAL_ERROR/);
  } finally { console.error = previous; }
});

test("parseId: rejects zero/negative/non-numeric", () => {
  assert.throws(() => parseId("0"), ApiError);
  assert.throws(() => parseId("-1"), ApiError);
  assert.throws(() => parseId("abc"), ApiError);
});

test("parseId: error carries 400 status + label", () => {
  try {
    parseId("x", "номер встречи");
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 400);
    assert.match(e.message, /номер встречи/);
  }
});
