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

## Rehearsal result

Status: `PASS`.

- Isolated PostgreSQL fixture applied Week 1 baseline, Week 2 and both additive
  M1 migrations.
- A repeated `prisma migrate deploy` was a no-op.
- Schema parity result: `No difference detected`.
- Legacy counts, stable links, backfill, enum, index and foreign-key assertions
  passed.
- Duplicate idempotency identities, orphans, tenant mismatches and reconciliation
  discrepancies: 0.
- Approved checksums:
  - `20260713000000_baseline`:
    `420fa8e66fd5211c3725c6d1870e991482f79596bc2edd9cc34e16f92d6b93b3`
  - `20260714090000_week2_canonical_case`:
    `04a60742e28be9a628e7085007cb3a222c373539dc8018eab447900103c4a0b8`
  - `20260718090000_m1_operations_control_plane`:
    `04aed4c1b9f261a6ef49f239255257cb8343fde753c13af3e75631c63342906e`
  - `20260719190000_m1_operations_integrity`:
    `f1e3d1e2201230473ef838b00f61b3e4783d8eeae396d3aec97d783c6c06cb2d`

Production migration and production database changes remain `NOT RUN` / `NONE`.
