\set ON_ERROR_STOP on

-- Inserted after all historical migrations and immediately before M2. Zero
-- values are intentionally ambiguous legacy facts and must remain UNKNOWN.
INSERT INTO "AgentCatalogItem" (
  "id", "agentId", "name", "category", "clientPrice", "costPrice", "description", "imageData", "createdAt"
) VALUES
  ('m2-catalog-unknown', 9001, 'Legacy unknown item', 'Венки', 0, 0, '', 'data:image/webp;base64,dGVzdA==', CURRENT_TIMESTAMP),
  ('m2-catalog-known', 9001, 'Legacy known item', 'Венки', 15000, 7000, '', 'data:image/webp;base64,dGVzdA==', CURRENT_TIMESTAMP);

INSERT INTO "QuoteVersion" ("id", "quoteId", "payload", "total", "createdAt")
VALUES (9411, 9301, '{"legacy":true}', 12000000, CURRENT_TIMESTAMP + INTERVAL '1 second');
