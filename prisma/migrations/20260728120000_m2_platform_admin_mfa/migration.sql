ALTER TABLE "User"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "platformMfaSecretEncrypted" TEXT,
  ADD COLUMN "platformMfaEnabledAt" TIMESTAMP(3);

ALTER TABLE "PlatformAccountActivation"
  ADD COLUMN "mfaSecretEncrypted" TEXT;

UPDATE "PlatformAccountActivation"
SET "mfaSecretEncrypted" = ''
WHERE "mfaSecretEncrypted" IS NULL;

ALTER TABLE "PlatformAccountActivation"
  ALTER COLUMN "mfaSecretEncrypted" SET NOT NULL;

CREATE TABLE "SecurityRateLimitBucket" (
  "keyHash" TEXT NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SecurityRateLimitBucket_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "SecurityRateLimitBucket_resetAt_idx"
  ON "SecurityRateLimitBucket"("resetAt");
