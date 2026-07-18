# Mission 1 migration contract

## Strategy

Additive PostgreSQL migration. No existing table, column, enum value or production
row is deleted. Existing IDs and foreign-key relationships remain stable.

## Backfill

1. Create one organization per existing Agent using deterministic legacy keys.
2. Create one active Agent membership linking existing `User` and `Agent`.
3. Bind existing `Case`, `Task` and `Meeting` rows to that organization.
4. Convert `Task.completedAt != null` to `COMPLETED`; all other legacy tasks to
   `OPEN`. Preserve title, due date, lead, agent and timestamps.
5. Convert legacy Meeting statuses deterministically and preserve scheduled/start/end
   timestamps, lead, agent, quote, order and co-view links.
6. Seed no business data. Backfill audit records only where explicitly marked as
   migration provenance, never as a fabricated human action.

## Rehearsal gates

- Apply Week 1 baseline, Week 2 migration and M1 migration to an isolated restored
  legacy fixture.
- Repeated `prisma migrate deploy` is a no-op.
- `prisma migrate diff` reports no schema difference.
- Legacy row counts and stable relationships are preserved or explicitly transformed.
- Duplicate organizations/memberships/tasks/meetings/audit idempotency keys = 0.
- Orphans and tenant/assignee mismatches = 0.
- Case-Task-Meeting reconciliation discrepancies = 0.

Production migration is not authorized by this mission branch.

