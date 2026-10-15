import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { NextResponse } from "next/server";
import { createCipheriv, createHash } from "node:crypto";
import { signSession, verifySession, requireAppEncryptionKey, ApplicationSecurityKeyUnavailableError } from "../lib/session";
import { hashOtp, verifyOtp } from "../lib/otp";
import { decryptStringStrict, encryptString, EncryptedDataUnavailableError } from "../lib/crypto";
import { decryptPlatformMfaSecret, encryptPlatformMfaSecret, generatePlatformMfaSecret } from "../lib/platformMfa";
import { setAgentSessionCookie } from "../lib/agentAuth";
import { getSessionFromRequest } from "../lib/auth";
import { readCoState, mergeCoAttributes, writeCoState } from "../lib/coSession";
import { prisma } from "../lib/prisma";

const TEST_KEY = "synthetic-auth-crypto-unit-key-not-a-deployment-key";
beforeEach(() => { process.env.APP_ENCRYPTION_KEY = TEST_KEY; });

test("auth crypto: missing and blank keys fail closed across all NODE_ENV values", async () => {
  const token = await signSession({ userId: 1 });
  const previous = process.env.NODE_ENV;
  try {
    for (const mode of [undefined, "development", "test", "preview", "production"]) {
      if (mode === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      else (process.env as Record<string, string | undefined>).NODE_ENV = mode;
      for (const key of [undefined, "", " \t "]) {
        if (key === undefined) delete process.env.APP_ENCRYPTION_KEY;
        else process.env.APP_ENCRYPTION_KEY = key;
        assert.throws(requireAppEncryptionKey, ApplicationSecurityKeyUnavailableError);
        await assert.rejects(signSession({ userId: 1 }), ApplicationSecurityKeyUnavailableError);
        await assert.rejects(verifySession(token), ApplicationSecurityKeyUnavailableError);
        assert.throws(() => hashOtp("123456", "+79161234567"), ApplicationSecurityKeyUnavailableError);
      }
    }
  } finally {
    if (previous === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = previous;
  }
});

test("auth crypto: existing key bytes, enc1 derivation and OTP hashes remain compatible", () => {
  process.env.APP_ENCRYPTION_KEY = ` ${TEST_KEY} `;
  const iv = Buffer.alloc(12, 4);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.APP_ENCRYPTION_KEY).digest(), iv);
  const ct = Buffer.concat([cipher.update("synthetic-legacy-data"), cipher.final()]);
  const stored = `enc1:${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${ct.toString("base64")}`;
  assert.equal(decryptStringStrict(stored), "synthetic-legacy-data");
  const expected = createHash("sha256").update(`123456:+79161234567:${process.env.APP_ENCRYPTION_KEY}`).digest("hex");
  assert.equal(hashOtp("123456", "+79161234567"), expected);
  assert.equal(verifyOtp("123456", "+79161234567", expected), true);
});

test("auth crypto: signatures are tamper-resistant and key-bound", async () => {
  const token = await signSession({ userId: 42, sessionVersion: 7, mfaVerified: true });
  assert.equal((await verifySession(token))?.sessionVersion, 7);
  const [payload, signature] = token.split(".");
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), userId: 43 })).toString("base64url");
  assert.equal(await verifySession(`${changed}.${signature}`), null);
  process.env.APP_ENCRYPTION_KEY = "synthetic-different-key";
  assert.equal(await verifySession(token), null);
});

test("auth crypto: MFA key corruption is unavailable, not an invalid TOTP secret", () => {
  const encrypted = encryptPlatformMfaSecret(generatePlatformMfaSecret());
  process.env.APP_ENCRYPTION_KEY = "synthetic-wrong-mfa-key";
  assert.throws(() => decryptPlatformMfaSecret(encrypted), EncryptedDataUnavailableError);
  assert.throws(() => decryptPlatformMfaSecret(""), EncryptedDataUnavailableError);
  assert.throws(() => decryptPlatformMfaSecret("enc1:damaged"), EncryptedDataUnavailableError);
});

test("auth crypto: all session cookies use the shared production protections", () => {
  const previous = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  try {
    const response = setAgentSessionCookie(NextResponse.json({ ok: true }), "synthetic-token");
    const cookie = response.headers.get("set-cookie")!;
    for (const flag of [/HttpOnly/i, /Secure/i, /SameSite=lax/i, /Path=\//i, /Max-Age=28800/i]) assert.match(cookie, flag);
  } finally {
    if (previous === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = previous;
  }
});

test("auth crypto: development has no anonymous operational fallback", async () => {
  const previous = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";
  try { assert.equal(await getSessionFromRequest(new Request("http://localhost")), null); }
  finally {
    if (previous === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else (process.env as Record<string, string | undefined>).NODE_ENV = previous;
  }
});

test("co-session: absence differs from damaged ciphertext; merge never overwrites unreadable data", async () => {
  let row: { state: string } | null = null;
  let writes = 0;
  const db = { agentSession: {
    findUnique: async () => row,
    upsert: async () => { writes++; throw new Error("unexpected write"); },
  } } as unknown as typeof prisma;
    assert.equal(await readCoState(1, db), null);
    row = { state: "enc1:damaged" };
    await assert.rejects(readCoState(1, db), EncryptedDataUnavailableError);
    await assert.rejects(mergeCoAttributes(1, {}, db), EncryptedDataUnavailableError);
    assert.equal(writes, 0);
    const encrypted = encryptString(JSON.stringify({ form: { name: "synthetic" }, _ts: 4 }));
    row = { state: encrypted };
    assert.deepEqual(await readCoState(1, db), { state: { form: { name: "synthetic" }, _ts: 4 }, updatedAt: 4 });
    process.env.APP_ENCRYPTION_KEY = "synthetic-wrong-key";
    await assert.rejects(readCoState(1, db), EncryptedDataUnavailableError);
    await assert.rejects(mergeCoAttributes(1, {}, db), EncryptedDataUnavailableError);
    assert.equal(writes, 0);
    delete process.env.APP_ENCRYPTION_KEY;
    await assert.rejects(writeCoState(1, {}, db), EncryptedDataUnavailableError);
    assert.equal(writes, 0);
});
