-- CreateEnum
CREATE TYPE "QuoteLifecycleStatus" AS ENUM ('LEGACY_INCOMPLETE', 'DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QuoteVersionState" AS ENUM ('LEGACY_INCOMPLETE', 'DRAFT', 'PUBLISHED', 'SUPERSEDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CommercialPriceState" AS ENUM ('KNOWN', 'UNKNOWN', 'REQUESTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CommercialCostState" AS ENUM ('KNOWN', 'UNKNOWN', 'REQUESTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CatalogAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'REQUESTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "QuoteLineItemType" AS ENUM ('SERVICE', 'PRODUCT', 'PACKAGE', 'ADD_ON', 'EXTERNAL_EXPENSE', 'MEMORIAL');

-- CreateEnum
CREATE TYPE "QuoteLineRelation" AS ENUM ('STANDALONE', 'INCLUDED', 'ADD_ON', 'REPLACEMENT');

-- CreateEnum
CREATE TYPE "QuoteClientDecisionType" AS ENUM ('ACCEPTED', 'CHANGES_REQUESTED');

-- AlterTable
ALTER TABLE "AgentCatalogItem" ADD COLUMN     "availability" "CatalogAvailability" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN     "costState" "CommercialCostState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "priceState" "CommercialPriceState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "scenarioCompatibility" JSONB NOT NULL DEFAULT '["CREMATION_V1","FAMILY_PLOT_BURIAL_V1"]',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "activeDraftVersionId" INTEGER,
ADD COLUMN     "caseId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'RUB',
ADD COLUMN     "latestPublishedVersionId" INTEGER,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerMembershipId" TEXT,
ADD COLUMN     "scenario" "CaseScenario",
ADD COLUMN     "status" "QuoteLifecycleStatus" NOT NULL DEFAULT 'LEGACY_INCOMPLETE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "QuoteVersion" ADD COLUMN     "catalogSourceVersion" TEXT,
ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'RUB',
ADD COLUMN     "discountTotal" INTEGER,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "publishChannel" TEXT,
ADD COLUMN     "publishReason" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedByMembershipId" TEXT,
ADD COLUMN     "snapshotChecksum" TEXT,
ADD COLUMN     "state" "QuoteVersionState" NOT NULL DEFAULT 'LEGACY_INCOMPLETE',
ADD COLUMN     "subtotal" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "totalState" "CommercialPriceState" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "validUntil" TIMESTAMP(3),
ADD COLUMN     "versionNumber" INTEGER;

-- CreateTable
CREATE TABLE "CatalogItemRevision" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'шт.',
    "priceState" "CommercialPriceState" NOT NULL,
    "clientUnitPrice" INTEGER,
    "costState" "CommercialCostState" NOT NULL,
    "unitCost" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "availability" "CatalogAvailability" NOT NULL,
    "scenarioCompatibility" JSONB NOT NULL,
    "vendorSource" TEXT,
    "vendorSourceVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogItemRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLineItem" (
    "id" TEXT NOT NULL,
    "quoteVersionId" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "QuoteLineItemType" NOT NULL,
    "catalogItemId" TEXT,
    "catalogRevisionId" TEXT,
    "serviceCode" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'шт.',
    "priceState" "CommercialPriceState" NOT NULL,
    "clientUnitPrice" INTEGER,
    "costState" "CommercialCostState" NOT NULL,
    "unitCost" INTEGER,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "included" BOOLEAN NOT NULL DEFAULT false,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "relationKind" "QuoteLineRelation" NOT NULL DEFAULT 'STANDALONE',
    "relationKey" TEXT,
    "source" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "scenarioCompatibility" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteClientLink" (
    "id" TEXT NOT NULL,
    "quoteVersionId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdByMembershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3),

    CONSTRAINT "QuoteClientLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteClientDecision" (
    "id" TEXT NOT NULL,
    "quoteVersionId" INTEGER NOT NULL,
    "type" "QuoteClientDecisionType" NOT NULL,
    "comment" TEXT,
    "source" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'client-link',
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteClientDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotePresentationSession" (
    "id" TEXT NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "ownerMembershipId" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotePresentationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogItemRevision_organizationId_availability_idx" ON "CatalogItemRevision"("organizationId", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemRevision_catalogItemId_version_key" ON "CatalogItemRevision"("catalogItemId", "version");

-- CreateIndex
CREATE INDEX "QuoteLineItem_quoteVersionId_position_idx" ON "QuoteLineItem"("quoteVersionId", "position");

-- CreateIndex
CREATE INDEX "QuoteLineItem_catalogItemId_catalogRevisionId_idx" ON "QuoteLineItem"("catalogItemId", "catalogRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLineItem_quoteVersionId_stableKey_key" ON "QuoteLineItem"("quoteVersionId", "stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteClientLink_tokenHash_key" ON "QuoteClientLink"("tokenHash");

-- CreateIndex
CREATE INDEX "QuoteClientLink_quoteVersionId_expiresAt_idx" ON "QuoteClientLink"("quoteVersionId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteClientDecision_quoteVersionId_key" ON "QuoteClientDecision"("quoteVersionId");

-- CreateIndex
CREATE INDEX "QuoteClientDecision_quoteVersionId_idempotencyKey_idx" ON "QuoteClientDecision"("quoteVersionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "QuotePresentationSession_quoteId_expiresAt_idx" ON "QuotePresentationSession"("quoteId", "expiresAt");

-- CreateIndex
CREATE INDEX "AgentCatalogItem_organizationId_availability_idx" ON "AgentCatalogItem"("organizationId", "availability");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_activeDraftVersionId_key" ON "Quote"("activeDraftVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_latestPublishedVersionId_key" ON "Quote"("latestPublishedVersionId");

-- CreateIndex
CREATE INDEX "Quote_organizationId_status_updatedAt_idx" ON "Quote"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Quote_caseId_idx" ON "Quote"("caseId");

-- CreateIndex
CREATE INDEX "Quote_ownerMembershipId_status_idx" ON "Quote"("ownerMembershipId", "status");

-- CreateIndex
CREATE INDEX "QuoteVersion_state_publishedAt_idx" ON "QuoteVersion"("state", "publishedAt");

-- CreateIndex
CREATE INDEX "QuoteVersion_publishedByMembershipId_idx" ON "QuoteVersion"("publishedByMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_quoteId_versionNumber_key" ON "QuoteVersion"("quoteId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteVersion_quoteId_idempotencyKey_key" ON "QuoteVersion"("quoteId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "AgentCatalogItem" ADD CONSTRAINT "AgentCatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemRevision" ADD CONSTRAINT "CatalogItemRevision_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "AgentCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemRevision" ADD CONSTRAINT "CatalogItemRevision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_activeDraftVersionId_fkey" FOREIGN KEY ("activeDraftVersionId") REFERENCES "QuoteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_latestPublishedVersionId_fkey" FOREIGN KEY ("latestPublishedVersionId") REFERENCES "QuoteVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_publishedByMembershipId_fkey" FOREIGN KEY ("publishedByMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "AgentCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_catalogRevisionId_fkey" FOREIGN KEY ("catalogRevisionId") REFERENCES "CatalogItemRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteClientLink" ADD CONSTRAINT "QuoteClientLink_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteClientLink" ADD CONSTRAINT "QuoteClientLink_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteClientDecision" ADD CONSTRAINT "QuoteClientDecision_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotePresentationSession" ADD CONSTRAINT "QuotePresentationSession_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- M2 legacy ownership backfill. Relationships come only from canonical M1
-- foreign keys; no commercial price fact is inferred from JSON payloads.
UPDATE "AgentCatalogItem" item
SET
  "organizationId" = membership."organizationId",
  "priceState" = CASE
    WHEN item."clientPrice" > 0 THEN 'KNOWN'::"CommercialPriceState"
    ELSE 'UNKNOWN'::"CommercialPriceState"
  END,
  "costState" = CASE
    WHEN item."costPrice" > 0 THEN 'KNOWN'::"CommercialCostState"
    ELSE 'UNKNOWN'::"CommercialCostState"
  END
FROM "Membership" membership
WHERE membership."agentId" = item."agentId";

UPDATE "Quote" quote
SET
  "organizationId" = meeting."organizationId",
  "caseId" = meeting."caseId",
  "ownerMembershipId" = meeting."ownerMembershipId",
  "scenario" = canonical_case."scenarioId"
FROM "Meeting" meeting
JOIN "Case" canonical_case ON canonical_case."id" = meeting."caseId"
WHERE quote."meetingId" = meeting."id";

WITH numbered AS (
  SELECT
    version."id",
    ROW_NUMBER() OVER (
      PARTITION BY version."quoteId"
      ORDER BY version."createdAt", version."id"
    )::INTEGER AS "versionNumber"
  FROM "QuoteVersion" version
)
UPDATE "QuoteVersion" version
SET "versionNumber" = numbered."versionNumber"
FROM numbered
WHERE numbered."id" = version."id";

-- Existing catalog zeroes are ambiguous. Revisions preserve the legacy value
-- only when it is positive; otherwise the state stays UNKNOWN and value null.
INSERT INTO "CatalogItemRevision" (
  "id",
  "catalogItemId",
  "organizationId",
  "version",
  "name",
  "description",
  "priceState",
  "clientUnitPrice",
  "costState",
  "unitCost",
  "availability",
  "scenarioCompatibility",
  "vendorSource",
  "vendorSourceVersion"
)
SELECT
  'legacy:' || item."id" || ':1',
  item."id",
  item."organizationId",
  1,
  item."name",
  item."description",
  item."priceState",
  CASE WHEN item."priceState" = 'KNOWN' THEN item."clientPrice" * 100 ELSE NULL END,
  item."costState",
  CASE WHEN item."costState" = 'KNOWN' THEN item."costPrice" * 100 ELSE NULL END,
  item."availability",
  item."scenarioCompatibility",
  'legacy-agent-catalog',
  '1'
FROM "AgentCatalogItem" item
WHERE item."organizationId" IS NOT NULL;

ALTER TABLE "QuoteLineItem"
  ADD CONSTRAINT "QuoteLineItem_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "QuoteLineItem_discount_nonnegative" CHECK ("discountAmount" >= 0),
  ADD CONSTRAINT "QuoteLineItem_price_state_value" CHECK (
    ("priceState" = 'KNOWN' AND "clientUnitPrice" IS NOT NULL AND "clientUnitPrice" >= 0)
    OR ("priceState" <> 'KNOWN' AND "clientUnitPrice" IS NULL)
  ),
  ADD CONSTRAINT "QuoteLineItem_cost_state_value" CHECK (
    ("costState" = 'KNOWN' AND "unitCost" IS NOT NULL AND "unitCost" >= 0)
    OR ("costState" <> 'KNOWN' AND "unitCost" IS NULL)
  );

ALTER TABLE "CatalogItemRevision"
  ADD CONSTRAINT "CatalogItemRevision_price_state_value" CHECK (
    ("priceState" = 'KNOWN' AND "clientUnitPrice" IS NOT NULL AND "clientUnitPrice" >= 0)
    OR ("priceState" <> 'KNOWN' AND "clientUnitPrice" IS NULL)
  ),
  ADD CONSTRAINT "CatalogItemRevision_cost_state_value" CHECK (
    ("costState" = 'KNOWN' AND "unitCost" IS NOT NULL AND "unitCost" >= 0)
    OR ("costState" <> 'KNOWN' AND "unitCost" IS NULL)
  );

-- Published commercial content is immutable at the database boundary. State
-- may advance to SUPERSEDED or EXPIRED, but snapshot fields cannot change.
CREATE OR REPLACE FUNCTION "m2_protect_quote_version_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."state" = 'PUBLISHED' AND NEW."state" NOT IN ('PUBLISHED', 'SUPERSEDED', 'EXPIRED') THEN
    RAISE EXCEPTION 'published quote version lifecycle cannot move backwards';
  END IF;
  IF OLD."state" IN ('SUPERSEDED', 'EXPIRED') AND NEW."state" <> OLD."state" THEN
    RAISE EXCEPTION 'terminal quote version lifecycle is immutable';
  END IF;
  IF OLD."state" IN ('PUBLISHED', 'SUPERSEDED', 'EXPIRED')
     AND (
       NEW."payload" IS DISTINCT FROM OLD."payload"
       OR NEW."subtotal" IS DISTINCT FROM OLD."subtotal"
       OR NEW."discountTotal" IS DISTINCT FROM OLD."discountTotal"
       OR NEW."total" IS DISTINCT FROM OLD."total"
       OR NEW."totalState" IS DISTINCT FROM OLD."totalState"
       OR NEW."currency" IS DISTINCT FROM OLD."currency"
       OR NEW."snapshotChecksum" IS DISTINCT FROM OLD."snapshotChecksum"
       OR NEW."catalogSourceVersion" IS DISTINCT FROM OLD."catalogSourceVersion"
       OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
       OR NEW."publishedByMembershipId" IS DISTINCT FROM OLD."publishedByMembershipId"
       OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR NEW."publishReason" IS DISTINCT FROM OLD."publishReason"
       OR NEW."publishChannel" IS DISTINCT FROM OLD."publishChannel"
       OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil"
       OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
       OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId"
     )
  THEN
    RAISE EXCEPTION 'published quote version snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "m2_quote_version_snapshot_immutable"
BEFORE UPDATE ON "QuoteVersion"
FOR EACH ROW EXECUTE FUNCTION "m2_protect_quote_version_snapshot"();

CREATE OR REPLACE FUNCTION "m2_protect_quote_line_item"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  version_state "QuoteVersionState";
  target_version_id INTEGER;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."quoteVersionId" ELSE NEW."quoteVersionId" END;
  SELECT "state" INTO version_state
  FROM "QuoteVersion"
  WHERE "id" = target_version_id;

  IF version_state <> 'DRAFT' THEN
    RAISE EXCEPTION 'non-draft quote line item is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "m2_quote_line_item_insert_immutable"
BEFORE INSERT ON "QuoteLineItem"
FOR EACH ROW EXECUTE FUNCTION "m2_protect_quote_line_item"();

CREATE TRIGGER "m2_quote_line_item_update_immutable"
BEFORE UPDATE ON "QuoteLineItem"
FOR EACH ROW EXECUTE FUNCTION "m2_protect_quote_line_item"();

CREATE TRIGGER "m2_quote_line_item_delete_immutable"
BEFORE DELETE ON "QuoteLineItem"
FOR EACH ROW EXECUTE FUNCTION "m2_protect_quote_line_item"();

CREATE OR REPLACE FUNCTION "m2_append_only_commercial_receipt"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'commercial decision receipts are append-only';
END;
$$;

CREATE TRIGGER "m2_quote_decision_append_only"
BEFORE UPDATE OR DELETE ON "QuoteClientDecision"
FOR EACH ROW EXECUTE FUNCTION "m2_append_only_commercial_receipt"();

CREATE TRIGGER "m2_catalog_revision_append_only"
BEFORE UPDATE OR DELETE ON "CatalogItemRevision"
FOR EACH ROW EXECUTE FUNCTION "m2_append_only_commercial_receipt"();

-- AddForeignKey
ALTER TABLE "QuotePresentationSession" ADD CONSTRAINT "QuotePresentationSession_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

