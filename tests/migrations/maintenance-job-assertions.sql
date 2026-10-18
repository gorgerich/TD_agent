DO $$
BEGIN
  IF to_regclass('public."MaintenanceJobState"') IS NULL THEN
    RAISE EXCEPTION 'MaintenanceJobState missing';
  END IF;
  IF EXISTS (SELECT 1 FROM "MaintenanceJobState") THEN
    RAISE EXCEPTION 'Migration must not claim historical maintenance executions';
  END IF;
END $$;
