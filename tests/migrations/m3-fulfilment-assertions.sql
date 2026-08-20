\set ON_ERROR_STOP on

DO $$
DECLARE
  table_name text;
  missing_count integer;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'CaseParty', 'CasePartyRoleAssignment', 'DocumentTypeDefinition',
    'DocumentRequirementPolicy', 'DocumentRequirementRule', 'CaseDocumentRequirement',
    'CaseDocument', 'CaseDocumentVersion', 'DocumentAccessEvent',
    'ContractSigningPolicy', 'Contract', 'ContractVersion', 'PaymentObligation',
    'PaymentLedgerEntry', 'PaymentLedgerApproval', 'FinancialControlPolicy',
    'PaymentWebhookReceipt'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'M3 table missing: %', table_name;
    END IF;
  END LOOP;

  IF (
    SELECT array_agg(enumlabel::text ORDER BY enumsortorder)
    FROM pg_enum
    JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'MembershipRole'
  ) IS DISTINCT FROM ARRAY['AGENT', 'MANAGER', 'ADMIN', 'DOCUMENT_REVIEWER', 'FINANCE'] THEN
    RAISE EXCEPTION 'M3 MembershipRole values mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'PaymentLedgerEntry_append_only' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'CaseDocumentVersion_history_guard' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'ContractVersion_history_guard' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'PaymentObligation_immutable' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'DocumentRequirementPolicy_content_guard' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'DocumentRequirementRule_immutable' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'ContractSigningPolicy_approved_guard' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'FinancialControlPolicy_approved_guard' AND tgenabled = 'O'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'DocumentTypeDefinition_approved_guard' AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'M3 immutable-history trigger missing or disabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'protect_contract_version_history'
      AND pg_get_functiondef(oid) LIKE '%ContractVersion signed proof is immutable%'
      AND pg_get_functiondef(oid) LIKE '%pg_advisory_xact_lock%'
      AND pg_get_functiondef(oid) LIKE '%only one active SIGNED version%'
  ) THEN
    RAISE EXCEPTION 'Contract signed-proof or single-active-version guard is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS columns_metadata
    WHERE columns_metadata.table_schema = 'public'
      AND columns_metadata.table_name = 'CaseDocumentRequirement'
      AND columns_metadata.column_name = 'ownerRole'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS columns_metadata
    WHERE columns_metadata.table_schema = 'public'
      AND columns_metadata.table_name = 'CaseDocumentRequirement'
      AND columns_metadata.column_name = 'reviewChecklist'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS columns_metadata
    WHERE columns_metadata.table_schema = 'public'
      AND columns_metadata.table_name = 'CaseDocumentRequirement'
      AND columns_metadata.column_name = 'isApplicable'
  ) THEN
    RAISE EXCEPTION 'M3 materialized policy snapshot columns missing';
  END IF;

  SELECT count(*) INTO missing_count
  FROM (VALUES
    ('CaseDocumentVersion_integrity_check'),
    ('ContractSigningPolicy_approval_check'),
    ('ContractVersion_integrity_check'),
    ('PaymentObligation_positive_amount_check'),
    ('PaymentLedgerEntry_integrity_check'),
    ('PaymentLedgerApproval_four_eyes_check')
  ) expected(name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = expected.name);
  IF missing_count <> 0 THEN
    RAISE EXCEPTION 'M3 domain constraints missing: %', missing_count;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Document"
    WHERE "id" = 9601 AND "leadId" = 9103 AND "agentId" = 9001 AND "size" = 128
  ) THEN
    RAISE EXCEPTION 'legacy uploaded document changed or disappeared';
  END IF;
  IF EXISTS (SELECT 1 FROM "CaseDocument" WHERE "caseId" = (SELECT "id" FROM "Case" WHERE "leadId" = 9103))
     OR EXISTS (SELECT 1 FROM "CaseDocumentVersion" WHERE "caseId" = (SELECT "id" FROM "Case" WHERE "leadId" = 9103)) THEN
    RAISE EXCEPTION 'legacy upload was silently promoted to canonical/verified document truth';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "CasePayment"
    WHERE "id" = 9701 AND "leadId" = 9103 AND "amountKopecks" = 8800000
  ) THEN
    RAISE EXCEPTION 'legacy payment note changed or disappeared';
  END IF;
  IF EXISTS (SELECT 1 FROM "PaymentObligation")
     OR EXISTS (SELECT 1 FROM "PaymentLedgerEntry") THEN
    RAISE EXCEPTION 'legacy payment/order status was silently promoted to obligation or ledger truth';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Order" WHERE "id" = 9503 AND "status" = 'PAID' AND "totalAmount" = 10000000
  ) THEN
    RAISE EXCEPTION 'legacy Order state was destructively rewritten';
  END IF;
  IF EXISTS (SELECT 1 FROM "Contract") OR EXISTS (SELECT 1 FROM "ContractVersion") THEN
    RAISE EXCEPTION 'legacy accepted/signed labels were silently promoted to legal contract truth';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "ClientLead" WHERE "id" = 9103 AND "religion" = 'legacy-sensitive-value'
  ) THEN
    RAISE EXCEPTION 'legacy special-category field was rewritten without Privacy/Legal decision';
  END IF;
  IF EXISTS (SELECT 1 FROM "CaseParty") THEN
    RAISE EXCEPTION 'legacy contact data was silently promoted to consented CaseParty truth';
  END IF;

  IF EXISTS (SELECT 1 FROM "DocumentRequirementPolicy" WHERE "status" = 'APPROVED')
     OR EXISTS (SELECT 1 FROM "ContractSigningPolicy" WHERE "status" = 'APPROVED')
     OR EXISTS (SELECT 1 FROM "FinancialControlPolicy" WHERE "status" = 'APPROVED') THEN
    RAISE EXCEPTION 'migration invented a human approval';
  END IF;
END $$;
