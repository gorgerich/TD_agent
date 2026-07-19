-- Mission 1: organization/membership, canonical task/meeting lifecycle and audit.
-- Additive rollout: legacy identity and relation columns remain intact.

CREATE TYPE "MembershipRole" AS ENUM ('AGENT', 'MANAGER', 'ADMIN');
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED', 'SUPERSEDED');
CREATE TYPE "TaskType" AS ENUM ('MANUAL', 'PREPARATION', 'FOLLOW_UP', 'MEETING_ESCALATION', 'QUOTE_SEND');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "OperationalMeetingStatus" AS ENUM ('TENTATIVE', 'SCHEDULED', 'CONFIRMED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');
CREATE TYPE "OperationalMeetingType" AS ENUM ('CONSULTATION', 'FOLLOW_UP', 'DOCUMENT_REVIEW', 'CEREMONY_COORDINATION', 'OTHER');
CREATE TYPE "MeetingChannel" AS ENUM ('IN_PERSON', 'PHONE', 'VIDEO', 'OTHER');
CREATE TYPE "SavedViewScope" AS ENUM ('MY', 'TEAM');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "agentId" INTEGER,
    "role" "MembershipRole" NOT NULL DEFAULT 'AGENT',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'AGENT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperationalAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorMembershipId" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'member',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "reason" TEXT,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationalAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedOperationalView" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "SavedViewScope" NOT NULL DEFAULT 'MY',
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedOperationalView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectionReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projector" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectionReceipt_pkey" PRIMARY KEY ("id")
);

-- Preserve the exact Week 2 tenant key. One legacy Agent becomes one isolated org.
INSERT INTO "Organization" ("id", "name", "slug", "timezone", "createdAt", "updatedAt")
SELECT
  'agent:' || a."id"::text,
  'Рабочая организация ' || a."id"::text,
  'legacy-agent-' || a."id"::text,
  'Europe/Moscow',
  a."createdAt",
  CURRENT_TIMESTAMP
FROM "Agent" a
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Membership" (
  "id", "organizationId", "userId", "agentId", "role", "status", "createdAt", "updatedAt"
)
SELECT
  'membership:agent:' || a."id"::text,
  'agent:' || a."id"::text,
  a."userId",
  a."id",
  'AGENT'::"MembershipRole",
  CASE WHEN a."status" = 'ACTIVE' THEN 'ACTIVE'::"MembershipStatus" ELSE 'SUSPENDED'::"MembershipStatus" END,
  a."createdAt",
  CURRENT_TIMESTAMP
FROM "Agent" a
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Task"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "caseId" TEXT,
  ADD COLUMN "assigneeMembershipId" TEXT,
  ADD COLUMN "createdByMembershipId" TEXT,
  ADD COLUMN "type" "TaskType" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "sourceEventId" TEXT,
  ADD COLUMN "expectedOutcome" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "waitingReason" TEXT,
  ADD COLUMN "supersededById" INTEGER,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

UPDATE "Task" t
SET
  "organizationId" = 'agent:' || t."agentId"::text,
  "caseId" = c."id",
  "assigneeMembershipId" = 'membership:agent:' || t."agentId"::text,
  "createdByMembershipId" = 'membership:agent:' || t."agentId"::text,
  "status" = CASE WHEN t."completedAt" IS NULL THEN 'OPEN'::"TaskStatus" ELSE 'COMPLETED'::"TaskStatus" END,
  "idempotencyKey" = 'legacy:task:' || t."id"::text
FROM "Case" c
WHERE c."leadId" = t."leadId";

ALTER TABLE "Task"
  ALTER COLUMN "organizationId" SET NOT NULL,
  ALTER COLUMN "caseId" SET NOT NULL,
  ALTER COLUMN "createdByMembershipId" SET NOT NULL,
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

ALTER TABLE "Meeting"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "caseId" TEXT,
  ADD COLUMN "ownerMembershipId" TEXT,
  ADD COLUMN "type" "OperationalMeetingType" NOT NULL DEFAULT 'CONSULTATION',
  ADD COLUMN "operationalStatus" "OperationalMeetingStatus" NOT NULL DEFAULT 'TENTATIVE',
  ADD COLUMN "attendees" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "channel" "MeetingChannel" NOT NULL DEFAULT 'IN_PERSON',
  ADD COLUMN "location" TEXT,
  ADD COLUMN "durationMinutes" INTEGER,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
  ADD COLUMN "reminderAt" TIMESTAMP(3),
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "outcomeRecordedAt" TIMESTAMP(3),
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "Meeting" m
SET
  "organizationId" = 'agent:' || m."agentId"::text,
  "caseId" = c."id",
  "ownerMembershipId" = 'membership:agent:' || m."agentId"::text,
  "operationalStatus" = CASE
    WHEN m."status" = 'COMPLETED' THEN 'COMPLETED'::"OperationalMeetingStatus"
    WHEN m."status" = 'CANCELLED' THEN 'CANCELLED'::"OperationalMeetingStatus"
    WHEN m."status" = 'IN_PROGRESS' THEN 'CONFIRMED'::"OperationalMeetingStatus"
    WHEN m."scheduledAt" IS NULL THEN 'TENTATIVE'::"OperationalMeetingStatus"
    ELSE 'SCHEDULED'::"OperationalMeetingStatus"
  END,
  "outcome" = CASE
    WHEN m."status" = 'COMPLETED' THEN 'Перенесено из legacy: встреча была отмечена завершённой без отдельного итога'
    WHEN m."status" = 'CANCELLED' THEN 'Перенесено из legacy: встреча была отмечена отменённой без отдельной причины'
    ELSE NULL
  END,
  "outcomeRecordedAt" = CASE
    WHEN m."status" IN ('COMPLETED', 'CANCELLED') THEN COALESCE(m."endedAt", m."scheduledAt", CURRENT_TIMESTAMP)
    ELSE NULL
  END,
  "idempotencyKey" = 'legacy:meeting:' || m."id"::text
FROM "Case" c
WHERE c."leadId" = m."leadId";

ALTER TABLE "Meeting"
  ALTER COLUMN "organizationId" SET NOT NULL,
  ALTER COLUMN "caseId" SET NOT NULL,
  ALTER COLUMN "ownerMembershipId" SET NOT NULL,
  ALTER COLUMN "idempotencyKey" SET NOT NULL;

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Membership_agentId_key" ON "Membership"("agentId");
CREATE INDEX "Membership_organizationId_role_status_idx" ON "Membership"("organizationId", "role", "status");
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");
CREATE UNIQUE INDEX "OrganizationInvite_tokenHash_key" ON "OrganizationInvite"("tokenHash");
CREATE INDEX "OrganizationInvite_organizationId_emailNormalized_idx" ON "OrganizationInvite"("organizationId", "emailNormalized");
CREATE INDEX "OrganizationInvite_expiresAt_idx" ON "OrganizationInvite"("expiresAt");
CREATE UNIQUE INDEX "OperationalAuditEvent_organizationId_idempotencyKey_key" ON "OperationalAuditEvent"("organizationId", "idempotencyKey");
CREATE INDEX "OperationalAuditEvent_organizationId_entityType_entityId_cr_idx" ON "OperationalAuditEvent"("organizationId", "entityType", "entityId", "createdAt");
CREATE INDEX "OperationalAuditEvent_organizationId_actorMembershipId_crea_idx" ON "OperationalAuditEvent"("organizationId", "actorMembershipId", "createdAt");
CREATE UNIQUE INDEX "SavedOperationalView_ownerMembershipId_name_key" ON "SavedOperationalView"("ownerMembershipId", "name");
CREATE INDEX "SavedOperationalView_organizationId_scope_idx" ON "SavedOperationalView"("organizationId", "scope");
CREATE UNIQUE INDEX "ProjectionReceipt_organizationId_projector_sourceEventId_key" ON "ProjectionReceipt"("organizationId", "projector", "sourceEventId");
CREATE INDEX "ProjectionReceipt_organizationId_createdAt_idx" ON "ProjectionReceipt"("organizationId", "createdAt");
CREATE UNIQUE INDEX "Task_organizationId_idempotencyKey_key" ON "Task"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "Task_organizationId_sourceEventId_type_key" ON "Task"("organizationId", "sourceEventId", "type");
CREATE INDEX "Task_organizationId_assigneeMembershipId_status_dueAt_idx" ON "Task"("organizationId", "assigneeMembershipId", "status", "dueAt");
CREATE INDEX "Task_organizationId_priority_dueAt_idx" ON "Task"("organizationId", "priority", "dueAt");
CREATE INDEX "Task_caseId_idx" ON "Task"("caseId");
CREATE UNIQUE INDEX "Meeting_organizationId_idempotencyKey_key" ON "Meeting"("organizationId", "idempotencyKey");
CREATE INDEX "Meeting_organizationId_ownerMembershipId_operationalStatus_idx" ON "Meeting"("organizationId", "ownerMembershipId", "operationalStatus");
CREATE INDEX "Meeting_organizationId_scheduledAt_idx" ON "Meeting"("organizationId", "scheduledAt");
CREATE INDEX "Meeting_caseId_idx" ON "Meeting"("caseId");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvite" ADD CONSTRAINT "OrganizationInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvite" ADD CONSTRAINT "OrganizationInvite_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeMembershipId_fkey" FOREIGN KEY ("assigneeMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalAuditEvent" ADD CONSTRAINT "OperationalAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperationalAuditEvent" ADD CONSTRAINT "OperationalAuditEvent_actorMembershipId_fkey" FOREIGN KEY ("actorMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SavedOperationalView" ADD CONSTRAINT "SavedOperationalView_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SavedOperationalView" ADD CONSTRAINT "SavedOperationalView_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectionReceipt" ADD CONSTRAINT "ProjectionReceipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
