import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCode, hashOtp, verifyOtp, normalizePhone } from "../lib/otp";

test("otp: generateCode is 6 digits", () => {
  for (let i = 0; i < 50; i++) {
    const c = generateCode();
    assert.match(c, /^\d{6}$/);
  }
});

test("otp: normalizePhone canonicalizes 8/7/+7 + strips formatting", () => {
  assert.equal(normalizePhone("8 (916) 123-45-67"), "+79161234567");
  assert.equal(normalizePhone("+7 916 123 45 67"), "+79161234567");
  assert.equal(normalizePhone("79161234567"), "+79161234567");
});

test("otp: verify accepts correct code, rejects wrong", () => {
  const phone = "+79161234567";
  const code = "428193";
  const h = hashOtp(code, phone);
  assert.equal(verifyOtp(code, phone, h), true);
  assert.equal(verifyOtp("000000", phone, h), false);
});

test("otp: hash bound to phone — same code, other phone fails", () => {
  const code = "123456";
  const h = hashOtp(code, "+79160000001");
  assert.equal(verifyOtp(code, "+79160000002", h), false);
});

test("otp: phone formatting variations still verify (normalized)", () => {
  const h = hashOtp("654321", "+79161234567");
  assert.equal(verifyOtp("654321", "8 916 123 45 67", h), true);
});

test("otp: rejects null/garbage stored hash", () => {
  assert.equal(verifyOtp("123456", "+79161234567", null), false);
  assert.equal(verifyOtp("123456", "+79161234567", "deadbeef"), false);
});
