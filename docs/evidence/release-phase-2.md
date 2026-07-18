# Release Phase 2 authoritative evidence

- Release window: 2026-07-18 (Europe/Moscow)
- Repository: `gorgerich/TD_agent`
- Pull request: https://github.com/gorgerich/TD_agent/pull/19
- Repair head: `3bbfcb5c8129d893ba953d4adeb1081a7c342339`
- Production merge SHA: `d8c2f47611b6ebda939718a8ae81afc8f61c1452`
- Main CI: https://github.com/gorgerich/TD_agent/actions/runs/29642864264
- Production URL: https://td-agent.vercel.app
- Final Vercel deployment ID: `dpl_CArd2FAHsfQjr6BPA3YKJVPjdQqY`
- GitHub production deployment ID: `5501333775`
- Production runtime database fingerprint: `0257665af2dd90a4`
- `RELEASE_PHASE_2: PASS`
- `PRODUCTION_RELEASE: PASS`

This file is the authoritative closure record for Release Phase 2. Earlier
Release Gate A and Week 2 records remain historical evidence of the state at
the time they were written. Their `BLOCKED` and `NOT RUN` statements are not
the current release status.

## Pre-release repair and deterministic gates

Release rehearsal exposed two internal test/operations defects. Both were
repaired before production migration:

1. Integration fixture cleanup used a shared prefix and could delete another
   suite's fixtures. Exact-ID fixture registries and reverse-FK cleanup replaced
   broad cleanup.
2. Synthetic smoke-account provisioning calculated PBKDF2 inside a serializable
   transaction. Validation and hashing now complete before the transaction;
   the atomic nested `User` + `Agent` write remains inside it.

Verified repair result:

- PBKDF2 algorithm, cost, salt, key length and stored format unchanged;
- transaction timeout unchanged;
- delayed-hash regression greater than five seconds: PASS;
- provision replay, rollback and authentication lifecycle: PASS;
- targeted provisioning suite: 5 consecutive runs, each 3/3 PASS;
- full integration suite: 5 consecutive runs, each 14/14 PASS;
- test database residue: 0;
- unit: 47/47 PASS;
- lint, typecheck, production build and e2e: PASS;
- migration fixtures and schema parity: PASS;
- skipped tests: 0;
- repair CI: https://github.com/gorgerich/TD_agent/actions/runs/29641840867.

## Production target and backup/restore

- Canonical production database: Railway `Postgres-4Mdx`.
- Production fingerprint: `0257665af2dd90a4`.
- Isolated restore fingerprint: `0d9dbae9ca626beb`; distinct from production.
- Fresh production logical backup: PostgreSQL custom format (`pg_dump -Fc`).
- Backup encryption at rest: PASS; encryption key retained separately.
- `pg_restore --list`: PASS.
- Full restore into the isolated target: PASS.
- Source/restore schema and aggregate legacy counts: MATCH.
- Restore rehearsal, repeated migrate deploy no-op and schema parity: PASS.
- Retained encrypted release backup and isolated restore resource require a
  separate owner decision before deletion.

No Nox or Neon database was used for the release.

## Freeze, synthetic account and authenticated smoke

The release used the reviewed fail-closed application write freeze:

- current Week 1 production SHA was redeployed with the freeze enabled;
- login and audited read-only routes remained available;
- representative mutation, server action, webhook, demo/OTP and `/co/*` paths
  returned controlled `503` before route execution;
- no new `ClientLead`, `Meeting` or `Quote` appeared after freeze activation.

One canonical synthetic account was provisioned:

- exactly one `User` and one `Agent`;
- zero leads, meetings, cases, events, documents, tasks, payments and orders;
- password login and tenant isolation: PASS;
- password rotation: old credential `401`, new credential `200`;
- final state: `SUSPENDED`, login `403`, `notifyEnabled=false`, domain rows 0.

Authenticated production smoke passed before migration, after deployment under
freeze and after unfreeze. Cases, settings, tasks, catalog, documents and
estimates returned `200`; the synthetic tenant could not see foreign records;
unexpected `5xx` responses were absent.

## Production migration

Approved migration checksums remained unchanged:

- `20260713000000_baseline`:
  `420fa8e66fd5211c3725c6d1870e991482f79596bc2edd9cc34e16f92d6b93b3`
- `20260714090000_week2_canonical_case`:
  `04a60742e28be9a628e7085007cb3a222c373539dc8018eab447900103c4a0b8`

Execution under verified freeze and direct Railway connection:

1. Week 1 schema parity: `No difference detected`.
2. Baseline resolve: PASS.
3. Week 2 `prisma migrate deploy`: PASS in 26 seconds.
4. `prisma migrate status`: up to date.
5. Post-migration schema parity: `No difference detected`.

Post-migration invariants:

- failed/incomplete migrations: 0;
- legacy table counts preserved;
- 14 `ClientLead` -> 14 `Case` -> 14 `case.migrated.v1` events;
- duplicate cases, public references and event idempotency keys: 0;
- orphan cases/events and tenant/owner mismatches: 0;
- published quote reference errors: 0;
- PT-001 through PT-011: PASS;
- reconciliation discrepancies: 0.

## Merge, deployment and post-release verification

- PR #19 merged through the protected GitHub workflow.
- Merge SHA: `d8c2f47611b6ebda939718a8ae81afc8f61c1452`.
- Main CI `29642864264`: PASS, skipped steps/tests 0.
- Frozen Week 2 deployment: `dpl_CufuBXA1gZv8pg4hRcQs5UScve34`.
- Final production deployment: `dpl_CArd2FAHsfQjr6BPA3YKJVPjdQqY`.
- GitHub production deployment `5501333775`: `success`, exact merge SHA.
- Canonical production alias points to the final deployment.
- Final read-only HTTP smoke: login `200`, root `307`, unauthenticated agent
  page `307`, unauthenticated agent API `401`.

The only reversible business mutation used for release verification changed the
synthetic Agent's `notifyEnabled` value `false -> true -> false` through the
existing authenticated application path. The database reflected each state;
all other Agent fields and domain counts remained unchanged.

Final state:

- `RELEASE_WRITE_FREEZE: disabled`;
- production deployment: READY on exact merge SHA;
- migration status and schema parity: PASS;
- reconciliation discrepancies: 0;
- destructive rollback or containment action: not required.

## Risk closure and retained risk

- `RISK-RELEASE-A-AUTHENTICATED-SMOKE: CLOSED`.
  Authenticated password-login smoke, tenant isolation and allowed read-only
  routes passed with the canonical synthetic account.
- `RISK-RELEASE-A-DELTA-WINDOW: CLOSED`.
  Freeze covered the migration/deployment interval, post-deploy reconciliation
  returned 0, and the reversible mutation succeeded only after verified
  unfreeze.
- `RISK-W1-TECH-HUMAN-REVIEW: OPEN`.
  No human Tech Lead sign-off is claimed or inferred.

## Evidence provenance

- PR #19 release comment:
  https://github.com/gorgerich/TD_agent/pull/19#issuecomment-5011157918
- Main CI:
  https://github.com/gorgerich/TD_agent/actions/runs/29642864264
- Production deployment status was independently re-read from GitHub deployment
  metadata and the canonical production endpoints on 2026-07-18.
