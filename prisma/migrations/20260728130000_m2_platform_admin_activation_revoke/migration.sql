UPDATE "PlatformAccountActivation"
SET "revokedAt" = CURRENT_TIMESTAMP
WHERE "mfaSecretEncrypted" = ''
  AND "consumedAt" IS NULL
  AND "revokedAt" IS NULL;
