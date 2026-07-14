DO $$
DECLARE
  mismatch_count INTEGER;
BEGIN
  SELECT count(*) INTO mismatch_count
  FROM (VALUES
    (9101, 'CONTRACTING'::"CaseStage", 9401),
    (9102, 'PAYMENT'::"CaseStage", 9402),
    (9103, 'EXECUTION'::"CaseStage", 9403),
    (9104, 'EXECUTION'::"CaseStage", 9404),
    (9105, 'PLANNING'::"CaseStage", NULL),
    (9106, 'AGREEMENT'::"CaseStage", 9406)
  ) AS expected("leadId", "stage", "publishedQuoteVersionId")
  LEFT JOIN "Case" c ON c."leadId" = expected."leadId"
  WHERE c."id" IS NULL
     OR c."stage" <> expected."stage"
     OR c."publishedQuoteVersionId" IS DISTINCT FROM expected."publishedQuoteVersionId";

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Week 2 backfill stage/publication mismatches: %', mismatch_count;
  END IF;

  SELECT count(*) INTO mismatch_count
  FROM "Case" c
  LEFT JOIN "CaseEvent" e ON e."caseId" = c."id"
  WHERE c."leadId" BETWEEN 9101 AND 9106
    AND (
      e."eventType" IS DISTINCT FROM 'case.migrated.v1'
      OR e."fromStage" IS DISTINCT FROM 'INTAKE'::"CaseStage"
      OR e."toStage" IS DISTINCT FROM c."stage"
      OR e."correlationId" IS DISTINCT FROM 'migration:week-2'
    );

  IF mismatch_count <> 0 THEN
    RAISE EXCEPTION 'Week 2 backfill event mismatches: %', mismatch_count;
  END IF;

  IF (SELECT count(*) FROM "CaseEvent" WHERE "eventType" = 'case.migrated.v1') <> 6 THEN
    RAISE EXCEPTION 'Expected six migration events';
  END IF;
END $$;
