\set ON_ERROR_STOP on

INSERT INTO "PlatformAuditEvent" (id, "actorUserId", action, "targetType", "targetId", metadata)
SELECT 'm3-real-legacy-reviewer', id, 'M3_REVIEWER_CREDENTIAL_REGISTERED',
       'm3-reviewer-credential', repeat('b', 64), '{"syntheticMigrationFixture":true}'::jsonb
FROM "User" ORDER BY id LIMIT 1;

INSERT INTO "OrganizationInvite" ("id", "organizationId", "emailNormalized", "tokenHash", "role", "expiresAt", "createdByMembershipId")
SELECT 'm3-real-legacy-invite', "organizationId", 'legacy-invite@synthetic.invalid', repeat('a', 64), 'AGENT', '2026-01-01T00:00:00Z', "id"
FROM "Membership" ORDER BY "id" LIMIT 1;

CREATE TABLE "m3_real_fixture_baseline" AS
SELECT (SELECT count(*) FROM "User") AS users,
       (SELECT count(*) FROM "Organization") AS organizations,
       (SELECT count(*) FROM "Membership") AS memberships,
       (SELECT to_jsonb(invitation) FROM "OrganizationInvite" invitation WHERE "id" = 'm3-real-legacy-invite') AS invitation;

DO $$
BEGIN
  IF (SELECT invitation FROM "m3_real_fixture_baseline") IS NULL THEN
    RAISE EXCEPTION 'Legacy invitation fixture is vacuous';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "PlatformAuditEvent" WHERE id = 'm3-real-legacy-reviewer') THEN
    RAISE EXCEPTION 'Legacy reviewer epoch fixture is vacuous';
  END IF;
END $$;
