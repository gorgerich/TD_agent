\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlatformRole') THEN
    RAISE EXCEPTION 'PlatformRole enum missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrganizationStatus') THEN
    RAISE EXCEPTION 'OrganizationStatus enum missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'platformRole'
  ) THEN
    RAISE EXCEPTION 'User.platformRole missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Organization' AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'Organization.status missing';
  END IF;
  IF to_regclass('public."PlatformAuditEvent"') IS NULL THEN
    RAISE EXCEPTION 'PlatformAuditEvent missing';
  END IF;
  IF to_regclass('public."PlatformAccountActivation"') IS NULL THEN
    RAISE EXCEPTION 'PlatformAccountActivation missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'PlatformAccountActivation_userId_fkey'
  ) THEN
    RAISE EXCEPTION 'PlatformAccountActivation user foreign key missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'PlatformAccountActivation'
      AND indexname = 'PlatformAccountActivation_tokenHash_key'
  ) THEN
    RAISE EXCEPTION 'PlatformAccountActivation token hash unique index missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'PlatformAccountActivation'
      AND column_name = 'purpose'
      AND udt_name = 'PlatformAccountActivationPurpose'
  ) THEN
    RAISE EXCEPTION 'PlatformAccountActivation purpose missing';
  END IF;
  IF (
    SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'PlatformAccountActivationPurpose'
  ) IS DISTINCT FROM ARRAY['FIRST_ACCESS', 'OWNER_RECOVERY'] THEN
    RAISE EXCEPTION 'PlatformAccountActivationPurpose values mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'sessionVersion'
  ) THEN
    RAISE EXCEPTION 'User.sessionVersion missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'platformMfaSecretEncrypted'
  ) THEN
    RAISE EXCEPTION 'User.platformMfaSecretEncrypted missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'PlatformAccountActivation' AND column_name = 'mfaSecretEncrypted'
  ) THEN
    RAISE EXCEPTION 'PlatformAccountActivation.mfaSecretEncrypted missing';
  END IF;
  IF to_regclass('public."SecurityRateLimitBucket"') IS NULL THEN
    RAISE EXCEPTION 'SecurityRateLimitBucket missing';
  END IF;
  -- Value assertions, not NULL assertions. Both columns are NOT NULL, so an "IS NULL"
  -- check can never fire and proves nothing. What must actually hold after the backfill is
  -- that pre-existing rows received the unprivileged defaults: a regression that flipped
  -- DEFAULT 'USER' to 'SUPER_ADMIN' would silently grant platform ownership to every
  -- legacy account and the old check would still pass.
  IF (SELECT count(*) FROM "User") = 0 THEN
    RAISE EXCEPTION 'Backfill assertion is vacuous: no legacy User rows present';
  END IF;
  IF EXISTS (SELECT 1 FROM "User" WHERE "platformRole" <> 'USER') THEN
    RAISE EXCEPTION 'Legacy User.platformRole must backfill to USER, found privileged row';
  END IF;
  IF (SELECT count(*) FROM "Organization") = 0 THEN
    RAISE EXCEPTION 'Backfill assertion is vacuous: no legacy Organization rows present';
  END IF;
  IF EXISTS (SELECT 1 FROM "Organization" WHERE status <> 'ACTIVE') THEN
    RAISE EXCEPTION 'Legacy Organization.status must backfill to ACTIVE';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PlatformAccountActivation"
    WHERE "mfaSecretEncrypted" = ''
      AND "consumedAt" IS NULL
      AND "revokedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'legacy activation without MFA secret remains usable';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "PlatformAccountActivation"
    WHERE "mfaSecretEncrypted" = '__OWNER_RECOVERY_MFA_PENDING__'
      AND purpose <> 'OWNER_RECOVERY'
  ) THEN
    RAISE EXCEPTION 'pending recovery MFA marker used outside owner recovery';
  END IF;
END $$;
