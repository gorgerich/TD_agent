-- M2 platform administration and completed organization RBAC.
-- Additive only: existing users and organizations retain access through defaults.

CREATE TYPE "PlatformRole" AS ENUM ('USER', 'SUPER_ADMIN');
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "User"
ADD COLUMN "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER';

ALTER TABLE "Organization"
ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "PlatformAuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Organization_status_createdAt_idx"
ON "Organization"("status", "createdAt");

CREATE INDEX "PlatformAuditEvent_createdAt_idx"
ON "PlatformAuditEvent"("createdAt");

CREATE INDEX "PlatformAuditEvent_actorUserId_createdAt_idx"
ON "PlatformAuditEvent"("actorUserId", "createdAt");

CREATE INDEX "PlatformAuditEvent_targetType_targetId_createdAt_idx"
ON "PlatformAuditEvent"("targetType", "targetId", "createdAt");

ALTER TABLE "PlatformAuditEvent"
ADD CONSTRAINT "PlatformAuditEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
