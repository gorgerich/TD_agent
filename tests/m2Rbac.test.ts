import assert from "node:assert/strict";
import test from "node:test";
import { hasCapability } from "../lib/operationalAuth";
import { hasPlatformCapability } from "../lib/platformAuth";
import { ADMIN_CONFIRMATION, assertAdminRoleConfirmation } from "../lib/organizationAdmin";
import { sanitizePlatformAuditMetadata } from "../lib/platformAudit";
import {
  generatePlatformActivationToken,
  hashPlatformActivationToken,
  isPlatformActivationTokenShape,
  PlatformActivationError,
  validatePlatformAdminPassword,
} from "../lib/platformActivation";
import { isSessionPayload } from "../lib/session";
import { buildInvitationUrl } from "../lib/invitationLink";
import {
  decryptPlatformMfaSecret,
  encryptPlatformMfaSecret,
  generatePlatformMfaSecret,
  platformMfaUri,
  totp,
  verifyPlatformMfaCode,
} from "../lib/platformMfa";
import { platformActivationFailureResponse } from "../app/api/platform-admin/activation/route";

test("platform capabilities belong only to SUPER_ADMIN, not organization ADMIN", () => {
  assert.equal(hasPlatformCapability("SUPER_ADMIN", "platform:organizations-manage"), true);
  assert.equal(hasPlatformCapability("USER", "platform:organizations-manage"), false);
  assert.equal(hasCapability("ADMIN", "organization:read"), true);
  assert.equal(hasCapability("ADMIN", "membership:manage"), true);
  assert.equal(hasCapability("MANAGER", "membership:manage"), false);
  assert.equal(hasCapability("AGENT", "membership:invite"), false);
});

test("session v2 supports platform-only user and rejects role-only or malformed payloads", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(isSessionPayload({ userId: 7, version: 2, iat: now, exp: now + 60 }), true);
  assert.equal(isSessionPayload({ userId: 7, version: 2, role: "SUPER_ADMIN", iat: now, exp: now + 60 }), true);
  assert.equal(isSessionPayload({ userId: 0, version: 2, iat: now, exp: now + 60 }), false);
  assert.equal(isSessionPayload({ userId: 7, version: 9, iat: now, exp: now + 60 }), false);
  assert.equal(isSessionPayload({ userId: 7, version: 2, activeMembershipId: 42, iat: now, exp: now + 60 }), false);
});

test("organization ADMIN assignment requires exact reinforced confirmation", () => {
  assert.doesNotThrow(() => assertAdminRoleConfirmation("AGENT"));
  assert.doesNotThrow(() => assertAdminRoleConfirmation("MANAGER"));
  assert.throws(() => assertAdminRoleConfirmation("ADMIN"), /НАЗНАЧИТЬ АДМИНИСТРАТОРА/);
  assert.doesNotThrow(() => assertAdminRoleConfirmation("ADMIN", ADMIN_CONFIRMATION));
});

test("platform audit metadata removes secret-bearing keys recursively", () => {
  const sanitized = sanitizePlatformAuditMetadata({
    before: "USER",
    nested: {
      password: "must-not-survive",
      tokenHash: "must-not-survive",
      status: "ACTIVE",
    },
    cookie: "must-not-survive",
  }) as Record<string, unknown>;
  assert.equal("cookie" in sanitized, false);
  assert.deepEqual(sanitized.nested, { status: "ACTIVE" });
});

test("platform activation tokens are high entropy and only their SHA-256 digest is persisted", () => {
  const token = generatePlatformActivationToken();
  const another = generatePlatformActivationToken();
  const digest = hashPlatformActivationToken(token);
  assert.equal(isPlatformActivationTokenShape(token), true);
  assert.equal(token.length, 43);
  assert.notEqual(token, another);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest.includes(token), false);
});

test("platform activation password policy rejects mismatch, short and obvious passwords", () => {
  assert.doesNotThrow(() => validatePlatformAdminPassword("A-long-private-passphrase-2026!", "A-long-private-passphrase-2026!"));
  assert.throws(() => validatePlatformAdminPassword("not-the-same-123!", "different-pass-123!"), PlatformActivationError);
  assert.throws(() => validatePlatformAdminPassword("short", "short"), PlatformActivationError);
  assert.throws(() => validatePlatformAdminPassword("password1234", "password1234"), PlatformActivationError);
});

test("platform MFA secret is encrypted, TOTP-compatible and time-window bounded", () => {
  const secret = generatePlatformMfaSecret();
  const encrypted = encryptPlatformMfaSecret(secret);
  const now = 1_785_000_000_000;
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptPlatformMfaSecret(encrypted), secret);
  assert.equal(verifyPlatformMfaCode(secret, totp(secret, Math.floor(now / 1000 / 30)), now), true);
  assert.equal(verifyPlatformMfaCode(secret, "000000", now), false);
  assert.match(platformMfaUri(secret), /^otpauth:\/\/totp\//);
});

test("organization invitation bearer is transported in URL fragment, never query", () => {
  const token = "A".repeat(43);
  const url = new URL(buildInvitationUrl("https://td-agent.example", token));
  assert.equal(url.pathname, "/agent/login");
  assert.equal(url.search, "");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("invite"), token);
});

test("activation domain errors stay generic while infrastructure failures return retryable 503", async () => {
  const invalid = platformActivationFailureResponse(new PlatformActivationError());
  assert.equal(invalid.status, 400);
  const unavailable = platformActivationFailureResponse(new Error("database unavailable"));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("Retry-After"), "5");
  assert.equal((await unavailable.json() as { error: string }).error, "Сервис временно недоступен. Повторите попытку.");
});
