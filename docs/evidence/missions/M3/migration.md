# Intake Hotfix Migration Safety

## Current Intake Hotfix Validation, 2026-10-04

Implementation `4bc03e2f228d64f9d12325cfe21b683ee143d5a1`; PR #33; Preview `dpl_7CEoXKy9ArgdvC95KhNw2UKco7tC`, https://td-agent-77fadgqm7-rics-projects-9baa2793.vercel.app; Railway fingerprint `545a187f9e9d66b0`, private store `store_Ov8erHstuvfJ52Og`. Current authenticated UAT passed both complete scenarios with reconciliation=0, unexpected 5xx=0, skipped=0, mobile/200% zoom and critical/serious accessibility=0. The previous interrupted Preview and continuation-harness omission are retained in intake-validation-current.json; neither is counted as PASS.

Technical source CI: https://github.com/gorgerich/TD_agent/actions/runs/37159816398. All technical steps passed; overall FAIL at stale authoritative evidence is NOT green overall CI. Green evidence-head CI remains required before merge. Independent exact-source review: P0=0/P1=0, one unchanged documented P2. Human verdicts remain PENDING and broad rollout CLOSED.

No schema or migration files changed from c9 to the repair source. Original M3 migration is already applied in Production and was not reapplied there. Fresh encrypted Production backup and real isolated local restore receipt: `intake-2026-10-04T09-33-06.999Z`; previous passing receipt `intake-2026-10-03T23-18-31.198Z` retained. All 52 table counts/digests MATCH including `_prisma_migrations`; volatile `SecurityRateLimitBucket` excluded explicitly. UTC/ISO serialization corrected an initial metadata digest mismatch, without excluding migration history. Local restore Prisma connection uses explicit local user. Repeated deploy NO_OP; schema parity PASS; plaintext clone STOPPED_AND_REMOVED. Backup key retained separately, never in Git. Backup helper independently reviewed P0/P1=0; 16 failure-path checks plus affected receipt-failure retest PASS. Freshness must be rechecked at release preflight.

## Historical Baseline Rehearsal

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
