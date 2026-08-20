\set ON_ERROR_STOP on

-- Production-like legacy facts inserted after M2 and before M3. They are
-- intentionally insufficient evidence and must never be promoted by migration.
INSERT INTO "Document" (
  "id", "leadId", "agentId", "name", "category", "url", "pathname", "mimeType", "size", "createdAt"
) VALUES (
  9601, 9103, 9001, 'legacy-upload.pdf', 'Свидетельство о смерти',
  'https://legacy.invalid/private-document', 'legacy/private-document', 'application/pdf', 128, CURRENT_TIMESTAMP
);

INSERT INTO "CasePayment" (
  "id", "leadId", "agentId", "amountKopecks", "kind", "method", "note", "paidAt"
) VALUES (
  9701, 9103, 9001, 8800000, 'аванс', 'наличные', 'legacy note without ledger evidence', CURRENT_TIMESTAMP
);

UPDATE "ClientLead"
SET "religion" = 'legacy-sensitive-value'
WHERE "id" = 9103;
