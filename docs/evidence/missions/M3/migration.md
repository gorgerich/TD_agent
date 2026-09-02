# M3 migration evidence

## Identity and checksum

- Migration: `20260811172829_m3_fulfilment_money_trust`
- SHA-256: `270c36a7aebd3ccf0604f87331d83865e6367e9806c27142e5a9d0d996366480`
- Historical migrations changed: **NO**
- Prisma schema change: additive models, enums, relations, indexes, and nullable legacy links.

## Legacy policy

Existing uploads are not promoted to verified evidence. Existing payment notes are not
promoted to ledger payments. Unknown payer, consent, signing evidence, and obligation facts
remain unknown or `LEGACY_INCOMPLETE`. No legacy row is deleted and no tenant, Case, owner,
Quote, Task, or Organization identifier is rewritten.

The production-like migration fixture covers legacy Organization, Membership, Case, Quote,
Task, Document, CasePayment, and audit relationships. The post-migration assertions require:

- legacy counts unchanged;
- M3 rows owned by the same organization and Case;
- no orphan, duplicate, or tenant-mismatched rows;
- no legacy document classified `VERIFIED`;
- no legacy payment note classified as confirmed ledger `PAYMENT`;
- reconciliation discrepancies equal zero.

## Rehearsal result

An encrypted custom-format PostgreSQL backup was created from the production-like isolated
fixture, listed, and restored into a separate disposable database. A list-only check was not
used as restore evidence. Schema and aggregate counts matched the source snapshot.

All 11 migrations applied on the isolated target. The M3 deploy step completed within the
2-second CI step window; repeated deploy completed within the next 1-second step window and
reported no pending migration. Prisma schema parity passed. Orphans, duplicates, tenant
mismatches, and reconciliation discrepancies were all zero.

The retained isolated Preview database was reset after the final migration checksum changed,
all 11 migrations were applied from the exact implementation SHA, repeated deploy reported no
pending migration, and a fresh schema diff returned `No difference detected`. Only synthetic
Preview fixtures were restored after those checks.

The exact Preview database fingerprint is `545a187f9e9d66b0`, distinct from Production
`0257665af2dd90a4`. Preview migration and UAT never used the Production connection.

## Rollback and forward-fix

The migration is additive. Before a future authorized Production release, retain an encrypted
backup and prove a real isolated restore under write freeze. If a migration or invariant fails,
keep the application frozen, do not drop M3 tables, do not erase document or ledger history,
and diagnose a safe additive forward-fix. Runtime rollback may use the known pre-M3 deployment;
schema rollback is not the containment mechanism.

Production migration was not performed in this mission.
The final read-only Production check on 2026-08-25 found zero guarded M3 tables and no applied
`20260811172829_m3_fulfilment_money_trust` migration record.
