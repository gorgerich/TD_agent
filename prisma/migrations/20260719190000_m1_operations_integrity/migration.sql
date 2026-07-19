-- Preserve the first published M1 migration checksum. All subsequent backfill
-- hardening is additive so an environment that applied the first migration can
-- converge through normal `prisma migrate deploy`.

-- PostgreSQL truncates identifiers at 63 bytes. Align the two automatically
-- truncated legacy names with Prisma's explicit schema names so parity is exact.
ALTER INDEX IF EXISTS "OperationalAuditEvent_organizationId_actorMembershipId_createdA"
  RENAME TO "OperationalAuditEvent_organizationId_actorMembershipId_crea_idx";
ALTER INDEX IF EXISTS "OperationalAuditEvent_organizationId_entityType_entityId_create"
  RENAME TO "OperationalAuditEvent_organizationId_entityType_entityId_cr_idx";

-- A legacy Task/Meeting can satisfy its individual foreign keys while pointing
-- at a lead owned by a different Agent. The canonical Case owner is authoritative
-- for the tenant boundary; align every dependent operational record to it.
UPDATE "Task" AS t
SET
  "agentId" = c."ownerId",
  "organizationId" = c."tenantId",
  "caseId" = c."id",
  "assigneeMembershipId" = m."id",
  "createdByMembershipId" = m."id"
FROM "Case" AS c
JOIN "Membership" AS m
  ON m."organizationId" = c."tenantId"
 AND m."agentId" = c."ownerId"
 AND m."status" = 'ACTIVE'
WHERE c."leadId" = t."leadId"
  AND (
    t."agentId" IS DISTINCT FROM c."ownerId"
    OR t."organizationId" IS DISTINCT FROM c."tenantId"
    OR t."caseId" IS DISTINCT FROM c."id"
    OR t."assigneeMembershipId" IS DISTINCT FROM m."id"
    OR t."createdByMembershipId" IS DISTINCT FROM m."id"
  );

UPDATE "Meeting" AS meeting
SET
  "agentId" = c."ownerId",
  "organizationId" = c."tenantId",
  "caseId" = c."id",
  "ownerMembershipId" = m."id"
FROM "Case" AS c
JOIN "Membership" AS m
  ON m."organizationId" = c."tenantId"
 AND m."agentId" = c."ownerId"
 AND m."status" = 'ACTIVE'
WHERE c."leadId" = meeting."leadId"
  AND (
    meeting."agentId" IS DISTINCT FROM c."ownerId"
    OR meeting."organizationId" IS DISTINCT FROM c."tenantId"
    OR meeting."caseId" IS DISTINCT FROM c."id"
    OR meeting."ownerMembershipId" IS DISTINCT FROM m."id"
  );

-- Legacy terminal meetings did not have a separate outcome field. Preserve the
-- historical status honestly instead of making it look like a human-authored note.
UPDATE "Meeting"
SET
  "outcome" = CASE
    WHEN "status" = 'COMPLETED' THEN 'Перенесено из legacy: встреча была отмечена завершённой без отдельного итога'
    WHEN "status" = 'CANCELLED' THEN 'Перенесено из legacy: встреча была отмечена отменённой без отдельной причины'
    ELSE "outcome"
  END,
  "outcomeRecordedAt" = COALESCE("outcomeRecordedAt", "endedAt", "scheduledAt", CURRENT_TIMESTAMP)
WHERE "operationalStatus" IN ('COMPLETED', 'CANCELLED')
  AND ("outcome" IS NULL OR "outcomeRecordedAt" IS NULL);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Task" t
    JOIN "Case" c ON c."id" = t."caseId"
    LEFT JOIN "Membership" assignee ON assignee."id" = t."assigneeMembershipId"
    LEFT JOIN "Membership" creator ON creator."id" = t."createdByMembershipId"
    WHERE t."organizationId" <> c."tenantId"
       OR t."agentId" <> c."ownerId"
       OR assignee."organizationId" IS DISTINCT FROM c."tenantId"
       OR creator."organizationId" IS DISTINCT FROM c."tenantId"
  ) THEN
    RAISE EXCEPTION 'M1 task tenant backfill invariant failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Meeting" meeting
    JOIN "Case" c ON c."id" = meeting."caseId"
    LEFT JOIN "Membership" owner ON owner."id" = meeting."ownerMembershipId"
    WHERE meeting."organizationId" <> c."tenantId"
       OR meeting."agentId" <> c."ownerId"
       OR owner."organizationId" IS DISTINCT FROM c."tenantId"
  ) THEN
    RAISE EXCEPTION 'M1 meeting tenant backfill invariant failed';
  END IF;
END $$;
