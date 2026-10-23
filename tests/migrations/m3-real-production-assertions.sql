\set ON_ERROR_STOP on

DO $$
BEGIN
  IF (SELECT version FROM "M3ReviewerCredentialEpoch" WHERE "keyFingerprint" = repeat('b', 64)) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Legacy reviewer epoch was not backfilled';
  END IF;
  INSERT INTO "PlatformAuditEvent" (id, "actorUserId", action, "targetType", "targetId", metadata)
  SELECT 'm3-real-legacy-revocation', "actorUserId", 'M3_REVIEWER_CREDENTIAL_REVOKED',
         'm3-reviewer-credential', "targetId", '{"syntheticMigrationFixture":true}'::jsonb
  FROM "PlatformAuditEvent" WHERE id = 'm3-real-legacy-reviewer';
  IF (SELECT version FROM "M3ReviewerCredentialEpoch" WHERE "keyFingerprint" = repeat('b', 64)) IS DISTINCT FROM 2
     OR (SELECT count(*) FROM "PlatformAuditEvent" WHERE id IN ('m3-real-legacy-reviewer', 'm3-real-legacy-revocation')) <> 2 THEN
    RAISE EXCEPTION 'Reviewer revocation failed to advance epoch and preserve history';
  END IF;
  IF (SELECT users FROM "m3_real_fixture_baseline") <> (SELECT count(*) FROM "User")
     OR (SELECT organizations FROM "m3_real_fixture_baseline") <> (SELECT count(*) FROM "Organization")
     OR (SELECT memberships FROM "m3_real_fixture_baseline") <> (SELECT count(*) FROM "Membership") THEN
    RAISE EXCEPTION 'Real production migrations changed legacy entity counts';
  END IF;
  IF (SELECT to_jsonb(invitation) FROM "OrganizationInvite" invitation WHERE "id" = 'm3-real-legacy-invite')
     IS DISTINCT FROM (SELECT invitation FROM "m3_real_fixture_baseline") THEN
    RAISE EXCEPTION 'Legacy invitation changed';
  END IF;
  IF EXISTS (SELECT 1 FROM "StaffAccountRecovery") OR EXISTS (SELECT 1 FROM "M3ProductionActivation") OR EXISTS (SELECT 1 FROM "PlatformOrganizationInvite") THEN
    RAISE EXCEPTION 'Migration fabricated credentials or approval proof';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlatformOrganizationInvite_role_check') THEN
    RAISE EXCEPTION 'Platform first ADMIN constraint missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'M3ProductionActivation_immutable' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'Production approval proof immutability missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'OrganizationInvite' AND column_name = 'createdByMembershipId' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'Legacy invitation required creator changed';
  END IF;
END $$;
DROP TABLE "m3_real_fixture_baseline";
