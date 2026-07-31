\set ON_ERROR_STOP on

DO $$
DECLARE
  bad_count integer;
BEGIN
  IF to_regclass('public."QuoteLineItem"') IS NULL
     OR to_regclass('public."QuoteClientLink"') IS NULL
     OR to_regclass('public."QuoteClientDecision"') IS NULL
     OR to_regclass('public."QuotePresentationSession"') IS NULL
     OR to_regclass('public."CatalogItemRevision"') IS NULL THEN
    RAISE EXCEPTION 'M2 commercial tables missing';
  END IF;

  SELECT count(*) INTO bad_count
  FROM "Quote" q
  JOIN "Meeting" m ON m.id = q."meetingId"
  WHERE q."organizationId" IS DISTINCT FROM m."organizationId"
     OR q."caseId" IS DISTINCT FROM m."caseId"
     OR q."ownerMembershipId" IS DISTINCT FROM m."ownerMembershipId";
  IF bad_count <> 0 THEN
    RAISE EXCEPTION 'legacy quote ownership mismatch: %', bad_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Quote"
    WHERE status <> 'LEGACY_INCOMPLETE'
       OR "activeDraftVersionId" IS NOT NULL
       OR "latestPublishedVersionId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'legacy quotes were silently promoted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "QuoteVersion"
    WHERE state <> 'LEGACY_INCOMPLETE'
       OR "totalState" <> 'UNKNOWN'
       OR "versionNumber" IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy versions gained invented publication or total facts';
  END IF;

  IF (
    SELECT array_agg("versionNumber" ORDER BY "versionNumber")
    FROM "QuoteVersion"
    WHERE "quoteId" = 9301
  ) IS DISTINCT FROM ARRAY[1, 2] THEN
    RAISE EXCEPTION 'legacy quote versions were not numbered deterministically';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "AgentCatalogItem"
    WHERE id = 'm2-catalog-unknown'
      AND "organizationId" = 'agent:9001'
      AND "priceState" = 'UNKNOWN'
      AND "costState" = 'UNKNOWN'
  ) THEN
    RAISE EXCEPTION 'legacy zero catalog values were not preserved as UNKNOWN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "CatalogItemRevision"
    WHERE "catalogItemId" = 'm2-catalog-known'
      AND "priceState" = 'KNOWN'
      AND "clientUnitPrice" = 1500000
      AND "costState" = 'KNOWN'
      AND "unitCost" = 700000
  ) THEN
    RAISE EXCEPTION 'known legacy catalog values were not versioned in minor units';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Quote" q
    LEFT JOIN "Organization" o ON o.id = q."organizationId"
    LEFT JOIN "Case" c ON c.id = q."caseId"
    LEFT JOIN "Membership" m ON m.id = q."ownerMembershipId"
    WHERE o.id IS NULL OR c.id IS NULL OR m.id IS NULL
  ) THEN
    RAISE EXCEPTION 'M2 quote orphan detected';
  END IF;
END $$;
