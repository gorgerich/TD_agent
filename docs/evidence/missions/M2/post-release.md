# M2 Commercial Trust Loop — production release attempt

State: `PRODUCTION_RELEASE_BLOCKED`

## What was done

- PR #28 merged under explicit owner release authorization.
  Merge commit `54da13348d0a983d44752c3683fb8a17c40683f2`.
- Main CI on the merge commit: PASS,
  https://github.com/gorgerich/TD_agent/actions/runs/30693286770
- Production database: **not migrated**. Zero production writes of any kind.

## Incident: deployment overtook migration

Merging to `main` auto-created production deployment `5703283212` for
`54da133` at 09:13:42Z — about one minute after the merge, before any migration
could be applied. The build script is `prisma generate && next build`, so a
deployment never applies migrations. Production therefore ran M2 code against a
pre-M2 schema.

Confirmed by read-only probe, not inferred:

- `GET /api/co/<bogus>` → **500** (the route reads `QuoteClientLink`, a table the
  M2 migration creates).
- Auth-gated routes still returned 401/307, so the blast radius was the commercial
  surface rather than authentication.

**Containment:** production was rolled back to the previous production deployment
`dpl_jPKRCuV3uhs5rJW74SMZTGnp75zz`. Post-rollback probes: `/api/co/<bogus>` → 404
`{"error":"Not found"}` (correct pre-M2 behaviour), `/agent/login` → 200, `/` → 307.
No database write was performed at any point, before or during the incident.

This is a sequencing defect in the release process, not in the M2 code: for this
repository the production migration must be applied **before** `main` is merged, or
the production deployment must be gated, because merge triggers deployment
automatically and deployment never migrates.

## Blocker: backup/restore readiness could not be established

`docs/db-migrations-runbook.md` states that every production step is owner-run and
requires a verified, restorable backup in hand. The previous release
(`M1-RBAC-HARDENING`) satisfied this with a real `pg_dump`, `pg_restore --list`, a
real isolated restore with exact row-count matching, and an encrypted backup with a
separately stored key.

Reproducing that means exporting the entire production database — real client names,
phone numbers and case records — onto a local development machine. That is bulk
export of living people's personal data, it was not specifically authorized, and the
runbook assigns the step to the owner. Neon point-in-time-restore readiness could not
be confirmed either: no Neon API credential is available, only the Vercel-managed
integration.

Per the authorization's own stop list — "backup/restore readiness не подтверждена" —
this is a stop before production writes.

## Preflight status at the point of stopping

| Check | Result |
| --- | --- |
| PR head unchanged, CLEAN, MERGEABLE, checks PASS | PASS |
| `main` unchanged before merge | PASS (`a7b0851`) |
| Recovery branch and its Previews absent | PASS |
| Main CI on merge commit | PASS |
| Production baselined for `migrate deploy` | PASS — nine migrations applied by prior releases |
| Exact pending migration set | `20260729170000_m2_commercial_trust_loop`, one migration |
| Migration additive / backward-compatible | PASS — reviewed across seven rounds; no DROP/RENAME/destructive statement |
| Production DB fingerprint verified | NOT RUN — requires production credentials |
| Applied-migration list, checksums, failed/partial check | NOT RUN — requires production credentials |
| Backup / restore readiness | **BLOCKED** |
| Production migration | NOT RUN |
| Production deployment | ROLLED BACK to the pre-merge deployment |

## Safe next step (one owner action)

Take a verified production backup — or confirm Neon PITR covers the window — then
either run `npx prisma migrate deploy` against the production direct URL yourself, or
supply the backup evidence and re-authorize. Because `main` already carries M2, the
correct order from here is: **migrate production first, then re-promote the
`54da133` production deployment.** Do not re-promote before migrating.

## Confirmations

- Real client data was not used, read in bulk, or exported.
- No payments and no real notifications were triggered.
- Production environment variables were not modified.
- No undocumented production writes. The production database was never written to.
- Isolated UAT resources are retained pending final release evidence.
