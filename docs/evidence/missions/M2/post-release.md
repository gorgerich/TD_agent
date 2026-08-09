# M2 Commercial Trust Loop - release chronology

Authoritative status as of 2026-08-02: `RELEASED`.

The production deployment is `dpl_38Ry4cPYMxL3xWStt4aM7nERR4ma`, READY at
`f6f3f17e984d7b1baaff619c9bcf063933e63e05`, and the production database fingerprint is
`0257665af2dd90a4`. Ten migrations are applied; the M2 migration checksum matches and
schema parity is `No difference detected`.

Everything below records earlier stopped release attempts. Those facts remain historical
evidence, but their blocker states are superseded by the successful release above.

## Post-release truth audit and repair candidate

Read-only audit base: `f6f3f17e984d7b1baaff619c9bcf063933e63e05`.

Final source repair: `3e03061821dac6ec9623dd6305bb05e799cd191d`.

The candidate closes five P1 commercial-truth defects: unknown price rendered as a final
amount, lost margin-only cost, editor/published divergence, current-rule recalculation of
published history, and local write fallback after a failed canonical read. Local deterministic
gates pass with 96 unit and 44 integration tests, four browser suites, skipped=0, migration
no-op, schema parity, 0 accessibility critical/serious findings and 0 fixture residue. The
route-authority, delayed-response-body, stale-feedback and failed post-publish-refresh race
regressions passed five full isolated commercial journeys in succession. Each run left zero
commercial fixture rows and zero synthetic rate-limit buckets. Final 200 percent zoom geometry
and M1 meeting-detail navigation each passed 5/5 targeted runs. Exact-source Quality run
`31320817751` passed twice, and independent final review returned P0=0, P1=0, P2=0.

Exact-source Preview `dpl_CAgGrVtHkGeQNZ8fjJkh5Ld1d85p` is READY at
`https://td-agent-h6cc7oxaz-rics-projects-9baa2793.vercel.app`. Its protected read-only smoke
returned 200/307/307/401 for login/root/protected page/protected API. The temporary exact-project
link was removed after the check.

The repair remains unmerged and undeployed to production. Production writes, schema changes,
environment changes and production deployment changes during this audit: NONE. M3 remains
`NOT_STARTED`.

## Historical first attempt

Attempt state: `PRODUCTION_RELEASE_BLOCKED`

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

---

## Second attempt — owner accepted the PITR risk; blocked on credential access

Owner explicitly accepted the unverified-PITR risk and authorised continuation, which
cleared the backup blocker. The release still cannot proceed, for a different and
independently proven reason.

### Production store identified (metadata only, no values read)

`ACTIVE_PRODUCTION_STORE = neon-bole-lamp` (`store_MB9cTWCMbEdoHhrO`), established from
Vercel env `contentHint.storeId`: production `DATABASE_URL_UNPOOLED`, `NEON_PROJECT_ID`
and `POSTGRES_HOST` all resolve to that store. `neon-cinereous-plank`
(`store_aOyIaIxYfYSPCpJd`) is not referenced by any production database variable.

Unresolved: production `DATABASE_URL` (the pooled URL the running app uses) has **no**
store link — it was set manually — so it cannot be proven to address the same database as
the unpooled URL that migrations would use.

### Blocker: the production connection string is architecturally unreadable

Both production database variables are Vercel `type=sensitive`:

```
DATABASE_URL_UNPOOLED   type=sensitive   valueReturned=NO
DATABASE_URL            type=sensitive   valueReturned=NO
```

Sensitive variables in Vercel are write-only by design. They are injected into the
deployment runtime and are never returned by the API or by `vercel env pull`. Verified
three independent ways:

1. `vercel env pull --environment=production` — both keys present, both values empty (run twice).
2. `GET /v9/projects/{id}` — `"type":"sensitive"`, no value field populated.
3. `GET /v1/storage/stores/store_MB9cTWCMbEdoHhrO` — all 18 secret names listed, every value empty.

Consequence: the mandated fail-closed preflight cannot even begin. Step 1 is "connect via
production `DATABASE_URL_UNPOOLED`". Without that string there is no connection, therefore
no fingerprint comparison against `0257665af2dd90a4`, no `current_database()` check, no
migration-history or checksum verification, and no `prisma migrate deploy`.

This is an access limitation, not a safety refusal. Zero production writes occurred.

### Safe next step (one owner action, choose either)

1. Supply the production direct connection string (`POSTGRES_URL_NON_POOLING` /
   `DATABASE_URL_UNPOOLED`) through a channel outside the repository, and the preflight and
   migration proceed unattended; or
2. Run the migration yourself from an environment that already holds it:
   `npx prisma migrate deploy` with `DATABASE_URL_UNPOOLED` set to the production direct URL.
   Exactly one migration is pending: `20260729170000_m2_commercial_trust_loop`.

Order is not optional: migrate **first**, then promote the `54da133` production deployment.
Promoting before migrating reproduces the 500s recorded above.
