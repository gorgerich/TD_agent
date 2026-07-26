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
  IF EXISTS (SELECT 1 FROM "User" WHERE "platformRole" IS NULL) THEN
    RAISE EXCEPTION 'User.platformRole contains NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM "Organization" WHERE status IS NULL) THEN
    RAISE EXCEPTION 'Organization.status contains NULL';
  END IF;
END $$;
