-- Legacy fixtures are inserted after the Week 1 baseline and before the Week 2
-- canonical migration. IDs are isolated inside td_agent_migration_test.

INSERT INTO "AgentTier" ("id", "name", "commissionPct")
VALUES (9001, 'MigrationFixture', 10.00);

INSERT INTO "User" ("id", "email", "name") VALUES
  (9001, 'migration-agent@test.local', 'Migration Agent'),
  (9002, 'migration-client@test.local', 'Migration Client'),
  (9003, 'migration-mismatched-agent@test.local', 'Migration Mismatched Agent');

INSERT INTO "Agent" (
  "id", "userId", "status", "tierId", "selfEmployed", "onboardingCompleted", "notifyEnabled", "createdAt"
) VALUES
  (9001, 9001, 'ACTIVE', 9001, true, true, true, CURRENT_TIMESTAMP),
  (9003, 9003, 'ACTIVE', 9001, true, true, true, CURRENT_TIMESTAMP);

INSERT INTO "ClientLead" ("id", "agentId", "name", "phone", "source", "ceremonyType", "createdAt") VALUES
  (9101, 9001, 'Pending with quote', '+79000009101', 'migration', 'погребение', CURRENT_TIMESTAMP),
  (9102, 9001, 'Signed with quote', '+79000009102', 'migration', 'погребение', CURRENT_TIMESTAMP),
  (9103, 9001, 'Paid with quote', '+79000009103', 'migration', 'кремация', CURRENT_TIMESTAMP),
  (9104, 9001, 'Completed with quote', '+79000009104', 'migration', 'кремация', CURRENT_TIMESTAMP),
  (9105, 9001, 'Pending without quote', '+79000009105', 'migration', 'погребение', CURRENT_TIMESTAMP),
  (9106, 9001, 'Viewed quote', '+79000009106', 'migration', 'кремация', CURRENT_TIMESTAMP);

INSERT INTO "Meeting" ("id", "leadId", "agentId", "status", "coViewedAt") VALUES
  (9201, 9101, 9001, 'COMPLETED', NULL),
  (9202, 9102, 9001, 'COMPLETED', NULL),
  (9203, 9103, 9001, 'COMPLETED', NULL),
  (9204, 9104, 9001, 'COMPLETED', NULL),
  (9205, 9105, 9001, 'COMPLETED', NULL),
  (9206, 9106, 9001, 'COMPLETED', CURRENT_TIMESTAMP),
  (9207, 9102, 9003, 'COMPLETED', NULL);

INSERT INTO "Task" ("id", "leadId", "agentId", "title", "dueAt", "completedAt", "createdAt") VALUES
  (9251, 9101, 9001, 'Legacy open task', CURRENT_TIMESTAMP + INTERVAL '1 day', NULL, CURRENT_TIMESTAMP),
  (9252, 9102, 9001, 'Legacy completed task', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9253, 9101, 9003, 'Legacy cross-tenant task', CURRENT_TIMESTAMP + INTERVAL '2 days', NULL, CURRENT_TIMESTAMP);

INSERT INTO "Quote" ("id", "meetingId") VALUES
  (9301, 9201), (9302, 9202), (9303, 9203), (9304, 9204), (9306, 9206);

INSERT INTO "QuoteVersion" ("id", "quoteId", "payload", "total", "createdAt") VALUES
  (9401, 9301, '{}', 10000000, CURRENT_TIMESTAMP),
  (9402, 9302, '{}', 10000000, CURRENT_TIMESTAMP),
  (9403, 9303, '{}', 10000000, CURRENT_TIMESTAMP),
  (9404, 9304, '{}', 10000000, CURRENT_TIMESTAMP),
  (9406, 9306, '{}', 10000000, CURRENT_TIMESTAMP);

INSERT INTO "Order" (
  "id", "publicId", "userId", "status", "serviceType", "totalAmount", "meta", "agentId", "meetingId", "createdAt", "updatedAt"
) VALUES
  (9501, 'MIG-PENDING-QUOTE', 9002, 'PENDING', 'funeral', 10000000, '{}', 9001, 9201, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9502, 'MIG-SIGNED', 9002, 'SIGNED', 'funeral', 10000000, '{}', 9001, 9202, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9503, 'MIG-PAID', 9002, 'PAID', 'funeral', 10000000, '{}', 9001, 9203, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9504, 'MIG-COMPLETED', 9002, 'COMPLETED', 'funeral', 10000000, '{}', 9001, 9204, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9505, 'MIG-PENDING-NO-QUOTE', 9002, 'PENDING', 'funeral', 10000000, '{}', 9001, 9205, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
