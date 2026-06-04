import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptString, decryptString } from "../lib/crypto";

test("crypto: roundtrip preserves content incl. cyrillic", () => {
  const s = JSON.stringify({ attributes: { a: "тест ПДн" }, n: 42 });
  const enc = encryptString(s);
  assert.ok(enc.startsWith("enc1:"));
  assert.notEqual(enc, s);
  assert.equal(decryptString(enc), s);
});

test("crypto: two encryptions differ (random IV)", () => {
  assert.notEqual(encryptString("x"), encryptString("x"));
});

test("crypto: legacy plaintext passes through", () => {
  assert.equal(decryptString('{"plain":true}'), '{"plain":true}');
});

test("crypto: tampered ciphertext throws (GCM auth)", () => {
  const enc = encryptString("secret");
  const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.throws(() => decryptString(tampered));
});
