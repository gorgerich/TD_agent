import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  decryptField,
  decryptString,
  decryptStringStrict,
  EncryptedDataUnavailableError,
  encryptField,
  encryptString,
} from "../lib/crypto";
import { handleApiError } from "../lib/apiAuth";

beforeEach(() => { process.env.APP_ENCRYPTION_KEY = "synthetic-unit-crypto-key-not-a-deployment-key"; });

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

test("crypto: tampered ciphertext is never exposed and does not crash a read", () => {
  const enc = encryptString("secret");
  const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
  assert.equal(decryptString(tampered), "");
  assert.throws(() => decryptStringStrict(tampered), EncryptedDataUnavailableError);
});

test("crypto: strict PII reads fail explicitly on wrong key and API emits a safe operational signal", async () => {
  const encrypted = encryptString("synthetic-sensitive-value");
  const previousKey = process.env.APP_ENCRYPTION_KEY;
  process.env.APP_ENCRYPTION_KEY = "synthetic-wrong-key-for-strict-read";
  try {
    assert.throws(() => decryptStringStrict(encrypted), (error: unknown) => {
      assert.equal(error instanceof EncryptedDataUnavailableError, true);
      assert.doesNotMatch((error as Error).message, /synthetic-sensitive-value|enc1:/);
      return true;
    });
  } finally {
    if (previousKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = previousKey;
  }

  const originalConsoleError = console.error;
  const signals: string[] = [];
  console.error = (...parts: unknown[]) => signals.push(parts.map(String).join(" "));
  try {
    const response = handleApiError(new EncryptedDataUnavailableError(), "m3/parties/list");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Зашифрованные данные временно недоступны",
      code: "PII_DECRYPTION_UNAVAILABLE",
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(signals.length, 1);
  assert.match(signals[0]!, /PII_DECRYPTION_UNAVAILABLE/);
  assert.doesNotMatch(signals[0]!, /synthetic-sensitive-value|enc1:/);
});

test("crypto: field helpers pass null/empty through, roundtrip non-empty", () => {
  assert.equal(encryptField(null), null);
  assert.equal(encryptField(undefined), undefined);
  assert.equal(encryptField(""), "");
  assert.equal(decryptField(null), null);
  const enc = encryptField("Отец, 78 лет");
  assert.ok(enc!.startsWith("enc1:"));
  assert.equal(decryptField(enc), "Отец, 78 лет");
});

test("crypto: missing/blank key never encrypts or strictly decrypts in any environment", () => {
  const encrypted = encryptString("synthetic-key-check");
  const originalEnv = process.env.NODE_ENV;
  try {
    for (const nodeEnv of [undefined, "development", "test", "staging", "production"]) {
      if (nodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
      for (const key of [undefined, "", "   "]) {
        if (key === undefined) delete process.env.APP_ENCRYPTION_KEY;
        else process.env.APP_ENCRYPTION_KEY = key;
        assert.throws(() => encryptString("x"), EncryptedDataUnavailableError);
        assert.throws(() => decryptStringStrict(encrypted), EncryptedDataUnavailableError);
      }
    }
  } finally {
    if (originalEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
  }
});

test("crypto: strict parsing rejects extra segments and noncanonical GCM encodings", () => {
  const encrypted = encryptString("synthetic");
  assert.equal(decryptStringStrict(encryptString("")), "");
  assert.equal(decryptStringStrict("legacy plaintext"), "legacy plaintext");
  const [iv, tag, ct] = encrypted.slice(5).split(".");
  for (const value of [`${encrypted}.extra`, "enc1:bad", `enc1:${iv}.${tag!.slice(0, 4)}.${ct}`, `enc1:${iv}.${tag}.${ct}!`]) {
    assert.throws(() => decryptStringStrict(value), EncryptedDataUnavailableError);
  }
});
