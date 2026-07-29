-- M1 RBAC Hardening: audited one-time Platform Owner credential recovery.
-- Additive only. Existing activation rows retain FIRST_ACCESS semantics.

CREATE TYPE "PlatformAccountActivationPurpose" AS ENUM (
  'FIRST_ACCESS',
  'OWNER_RECOVERY'
);

ALTER TABLE "PlatformAccountActivation"
  ADD COLUMN "purpose" "PlatformAccountActivationPurpose" NOT NULL DEFAULT 'FIRST_ACCESS';

CREATE INDEX "PlatformAccountActivation_userId_purpose_createdAt_idx"
  ON "PlatformAccountActivation"("userId", "purpose", "createdAt");
