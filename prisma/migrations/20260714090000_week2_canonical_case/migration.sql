-- Week 2: canonical Case aggregate and append-only CaseEvent log.
-- Additive only. Existing B2C and B2B columns are unchanged.

CREATE TYPE "CaseStage" AS ENUM (
  'INTAKE', 'PLANNING', 'QUOTING', 'AGREEMENT',
  'CONTRACTING', 'PAYMENT', 'EXECUTION', 'CLOSED'
);

CREATE TYPE "CaseScenario" AS ENUM (
  'UNSELECTED', 'CREMATION_V1', 'FAMILY_PLOT_BURIAL_V1'
);

CREATE TABLE "Case" (
  "id" TEXT NOT NULL,
  "publicRef" TEXT NOT NULL,
  "leadId" INTEGER NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ownerId" INTEGER NOT NULL,
  "scenarioId" "CaseScenario" NOT NULL DEFAULT 'UNSELECTED',
  "stage" "CaseStage" NOT NULL DEFAULT 'INTAKE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "guardState" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "publishedQuoteVersionId" INTEGER,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CaseEvent" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actorId" INTEGER NOT NULL,
  "actorType" TEXT NOT NULL DEFAULT 'agent',
  "eventType" TEXT NOT NULL,
  "eventVersion" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "causationId" TEXT,
  "fromStage" "CaseStage" NOT NULL,
  "toStage" "CaseStage" NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "payload" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaseEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Case_publicRef_key" ON "Case"("publicRef");
CREATE UNIQUE INDEX "Case_leadId_key" ON "Case"("leadId");
CREATE INDEX "Case_tenantId_ownerId_idx" ON "Case"("tenantId", "ownerId");
CREATE INDEX "Case_tenantId_stage_idx" ON "Case"("tenantId", "stage");
CREATE INDEX "Case_publishedQuoteVersionId_idx" ON "Case"("publishedQuoteVersionId");
CREATE UNIQUE INDEX "CaseEvent_tenantId_idempotencyKey_key" ON "CaseEvent"("tenantId", "idempotencyKey");
CREATE INDEX "CaseEvent_caseId_createdAt_idx" ON "CaseEvent"("caseId", "createdAt");
CREATE INDEX "CaseEvent_tenantId_eventType_createdAt_idx" ON "CaseEvent"("tenantId", "eventType", "createdAt");

ALTER TABLE "Case" ADD CONSTRAINT "Case_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "ClientLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Case" ADD CONSTRAINT "Case_publishedQuoteVersionId_fkey"
  FOREIGN KEY ("publishedQuoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing leads without changing their contact/intake records.
INSERT INTO "Case" (
  "id", "publicRef", "leadId", "tenantId", "ownerId", "scenarioId", "stage", "version", "guardState", "createdAt", "updatedAt"
)
SELECT
  'case_' || substr(md5('case:' || l."id"::text), 1, 24),
  'TD-' || upper(substr(md5('public:' || l."id"::text), 1, 12)),
  l."id",
  'agent:' || l."agentId"::text,
  l."agentId",
  CASE
    WHEN lower(coalesce(l."ceremonyType", '')) LIKE '%крем%' THEN 'CREMATION_V1'::"CaseScenario"
    WHEN lower(coalesce(l."ceremonyType", '')) LIKE '%погреб%' THEN 'FAMILY_PLOT_BURIAL_V1'::"CaseScenario"
    ELSE 'UNSELECTED'::"CaseScenario"
  END,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "Order" o JOIN "Meeting" m ON m."id" = o."meetingId"
      WHERE m."leadId" = l."id" AND upper(o."status") = 'COMPLETED'
    ) THEN 'CLOSED'::"CaseStage"
    WHEN EXISTS (
      SELECT 1 FROM "Order" o JOIN "Meeting" m ON m."id" = o."meetingId"
      WHERE m."leadId" = l."id" AND upper(o."status") IN ('PAID', 'PARTIALLY_PAID')
    ) THEN 'EXECUTION'::"CaseStage"
    WHEN EXISTS (
      SELECT 1 FROM "Order" o JOIN "Meeting" m ON m."id" = o."meetingId"
      WHERE m."leadId" = l."id"
    ) THEN 'PAYMENT'::"CaseStage"
    WHEN EXISTS (
      SELECT 1 FROM "Quote" q JOIN "Meeting" m ON m."id" = q."meetingId"
      WHERE m."leadId" = l."id"
    ) THEN 'QUOTING'::"CaseStage"
    WHEN EXISTS (SELECT 1 FROM "Meeting" m WHERE m."leadId" = l."id") THEN 'PLANNING'::"CaseStage"
    ELSE 'INTAKE'::"CaseStage"
  END,
  1,
  '{}'::jsonb,
  l."createdAt",
  CURRENT_TIMESTAMP
FROM "ClientLead" l
ON CONFLICT ("leadId") DO NOTHING;

INSERT INTO "CaseEvent" (
  "id", "caseId", "tenantId", "actorId", "eventType", "idempotencyKey", "correlationId",
  "fromStage", "toStage", "before", "after", "payload", "result", "createdAt"
)
SELECT
  'evt_' || substr(md5('case-created:' || c."leadId"::text), 1, 24),
  c."id",
  c."tenantId",
  c."ownerId",
  'case.created.v1',
  'migration:case-created:' || c."leadId"::text,
  'migration:week-2',
  c."stage",
  c."stage",
  '{}'::jsonb,
  jsonb_build_object('stage', c."stage", 'scenarioId', c."scenarioId", 'version', c."version"),
  jsonb_build_object('leadId', c."leadId", 'source', 'week-2-backfill'),
  jsonb_build_object('caseId', c."id", 'leadId', c."leadId", 'stage', c."stage", 'replayed', false),
  c."createdAt"
FROM "Case" c
ON CONFLICT ("tenantId", "idempotencyKey") DO NOTHING;
