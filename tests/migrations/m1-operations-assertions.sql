DO $$
DECLARE
  mismatch_count INTEGER;
BEGIN
  IF (SELECT count(*) FROM "Organization" WHERE "id" = 'agent:9001') <> 1 THEN
    RAISE EXCEPTION 'Expected one legacy organization';
  END IF;

  IF (SELECT count(*) FROM "Membership" WHERE "agentId" = 9001 AND "organizationId" = 'agent:9001' AND "role" = 'AGENT' AND "status" = 'ACTIVE') <> 1 THEN
    RAISE EXCEPTION 'Expected one active legacy agent membership';
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "Task" t
  JOIN "Case" c ON c."id" = t."caseId"
  WHERE t."id" IN (9251, 9252)
    AND (
      t."organizationId" <> 'agent:9001'
      OR t."assigneeMembershipId" <> 'membership:agent:9001'
      OR t."createdByMembershipId" <> 'membership:agent:9001'
      OR t."idempotencyKey" <> 'legacy:task:' || t."id"::text
      OR c."leadId" <> t."leadId"
      OR (t."id" = 9251 AND t."status" <> 'OPEN')
      OR (t."id" = 9252 AND t."status" <> 'COMPLETED')
    );
  IF mismatch_count <> 0 OR (SELECT count(*) FROM "Task" WHERE "id" IN (9251, 9252)) <> 2 THEN
    RAISE EXCEPTION 'M1 task backfill mismatches: %', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "Meeting" m
  JOIN "Case" c ON c."id" = m."caseId"
  WHERE m."id" BETWEEN 9201 AND 9206
    AND (
      m."organizationId" <> 'agent:9001'
      OR m."ownerMembershipId" <> 'membership:agent:9001'
      OR m."idempotencyKey" <> 'legacy:meeting:' || m."id"::text
      OR m."operationalStatus" <> 'COMPLETED'
      OR m."outcome" IS NULL
      OR m."outcomeRecordedAt" IS NULL
      OR c."leadId" <> m."leadId"
    );
  IF mismatch_count <> 0 OR (SELECT count(*) FROM "Meeting" WHERE "id" BETWEEN 9201 AND 9206) <> 6 THEN
    RAISE EXCEPTION 'M1 meeting backfill mismatches: %', mismatch_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Meeting"
    WHERE "operationalStatus" IN ('COMPLETED', 'NO_SHOW', 'CANCELLED')
      AND ("outcome" IS NULL OR "outcomeRecordedAt" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Terminal meeting without outcome evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Case" c
    LEFT JOIN "Organization" o ON o."id" = c."tenantId"
    WHERE o."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Canonical case without organization';
  END IF;

  IF to_regclass('public."OperationalAuditEvent"') IS NULL
    OR to_regclass('public."SavedOperationalView"') IS NULL
    OR to_regclass('public."ProjectionReceipt"') IS NULL THEN
    RAISE EXCEPTION 'M1 operational tables missing';
  END IF;

  IF (SELECT count(*) FROM "ClientLead" WHERE "id" BETWEEN 9101 AND 9106) <> 6
    OR (SELECT count(*) FROM "Case" WHERE "leadId" BETWEEN 9101 AND 9106) <> 6
    OR (SELECT count(*) FROM "CaseEvent" WHERE "eventType" = 'case.migrated.v1') <> 6
    OR (SELECT count(*) FROM "QuoteVersion" WHERE "id" IN (9401, 9402, 9403, 9404, 9406)) <> 5
    OR (SELECT count(*) FROM "Order" WHERE "id" BETWEEN 9501 AND 9505) <> 5 THEN
    RAISE EXCEPTION 'Legacy aggregate counts changed during M1 migration';
  END IF;
END $$;
