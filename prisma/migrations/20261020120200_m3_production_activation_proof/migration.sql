CREATE TABLE "M3ProductionActivation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activatedByUserId" INTEGER NOT NULL,
    "bundleFingerprint" TEXT NOT NULL,
    "bundle" JSONB NOT NULL,
    "humanSignoffs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "M3ProductionActivation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "M3ProductionActivation_digest_check" CHECK ("bundleFingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "M3ProductionActivation_organizationId_bundleFingerprint_key"
    ON "M3ProductionActivation"("organizationId", "bundleFingerprint");
ALTER TABLE "M3ProductionActivation" ADD CONSTRAINT "M3ProductionActivation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "M3ProductionActivation" ADD CONSTRAINT "M3ProductionActivation_activatedByUserId_fkey"
    FOREIGN KEY ("activatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "m3_production_activation_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'M3 production approval proof is immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "M3ProductionActivation_immutable"
    BEFORE UPDATE OR DELETE ON "M3ProductionActivation"
    FOR EACH ROW EXECUTE FUNCTION "m3_production_activation_immutable"();

CREATE TABLE "M3ReviewerCredentialEpoch" (
    "keyFingerprint" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "M3ReviewerCredentialEpoch_fingerprint_check" CHECK ("keyFingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "M3ReviewerCredentialEpoch_version_check" CHECK ("version" > 0)
);

CREATE FUNCTION "m3_reviewer_credential_epoch"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW."targetType" = 'm3-reviewer-credential'
       AND NEW."action" IN ('M3_REVIEWER_CREDENTIAL_REGISTERED', 'M3_REVIEWER_CREDENTIAL_REVOKED')
       AND NEW."targetId" ~ '^[0-9a-f]{64}$' THEN
        INSERT INTO "M3ReviewerCredentialEpoch" ("keyFingerprint", "version", "updatedAt")
        VALUES (NEW."targetId", 1, clock_timestamp())
        ON CONFLICT ("keyFingerprint") DO UPDATE
        SET "version" = "M3ReviewerCredentialEpoch"."version" + 1, "updatedAt" = clock_timestamp();
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "PlatformAuditEvent_reviewer_credential_epoch"
    AFTER INSERT ON "PlatformAuditEvent"
    FOR EACH ROW EXECUTE FUNCTION "m3_reviewer_credential_epoch"();

-- Install the writer boundary first: concurrent old-runtime inserts cannot fall
-- between the scan and trigger creation. This projection grants no approval.
INSERT INTO "M3ReviewerCredentialEpoch" ("keyFingerprint")
SELECT DISTINCT "targetId" FROM "PlatformAuditEvent"
WHERE "targetType" = 'm3-reviewer-credential'
  AND "action" IN ('M3_REVIEWER_CREDENTIAL_REGISTERED', 'M3_REVIEWER_CREDENTIAL_REVOKED')
  AND "targetId" ~ '^[0-9a-f]{64}$'
ON CONFLICT ("keyFingerprint") DO NOTHING;
