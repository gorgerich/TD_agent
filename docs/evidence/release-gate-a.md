# Release Gate A evidence

- Verification window: 2026-07-14/15 (Europe/Moscow)
- Pull request: https://github.com/gorgerich/TD_agent/pull/19
- Implementation commit: `f49497511035b849e1a7b8fb7c86444741cdb2e7`
- Evidence base commit: `a06201c64ad1a22fff5ea0884387b20d6e16843f`
- Governance mode: `SOLO_FOUNDER_AI_ASSISTED`
- `RELEASE_GATE_A: BLOCKED`
- `WEEK_1_AUTHENTICATED_SMOKE_STATUS: BLOCKED`
- `PRODUCTION_SCHEMA_DRIFT_STATUS: PASS`
- `BACKUP_STATUS: PASS`
- `RESTORE_VERIFICATION_STATUS: PASS`
- `CLONE_MIGRATION_STATUS: PASS`
- `POST_MIGRATION_INVARIANTS: PASS`
- `DELTA_WINDOW_RISK: OPEN`

No production write, DDL, migration, demo login, OTP, `/co/[code]` request,
merge, deployment or Week 3 work was performed.

## 1. Password login and read-only route audit

Static password-login path:

1. `app/agent/login/page.tsx` posts only to `/api/agent/auth/login` in password mode.
2. `app/api/agent/auth/login/route.ts` validates input, performs `User`/`Agent`
   reads, verifies the password hash, signs a stateless session and sets an
   HTTP-only cookie. It performs no database mutation.
3. `app/agent/(app)/layout.tsx` rejects a missing/invalid session before rendering
   protected pages. Its normal render path reads `Agent` and overdue `Task` data.
4. `lib/caseReadModel.ts` scopes canonical case reads by both `tenantId` and
   `ownerId`. Detail reads also require the owned `leadId`.

Production unauthenticated checks returned `307 -> /agent/login` for:

- `/agent/cases`
- `/agent/meetings`
- `/agent/estimates`
- `/agent/documents`
- `/agent/tasks`
- `/agent/settings`
- `/agent/commissions`

`/agent/login` returned `200`.

### Authenticated read-only allowlist

These routes are safe only as direct GET/navigation with no control activation:

| Route | Read path | Interaction restriction |
| --- | --- | --- |
| `/agent/cases` | canonical cases and scoped tasks | Do not submit “new case”. |
| `/agent/cases/[ownedLeadId]` | owned lead/case, tasks, notes, documents, payments and events | Do not complete onboarding or use edit/add/delete controls. |
| `/agent/meetings` | meetings scoped by `agentId` | Do not create meeting. |
| `/agent/meetings/[ownedMeetingId]` | meeting scoped by `id + agentId` | Do not change meeting status. |
| `/agent/estimates` | quotes scoped through owned meetings | Open list only. |
| `/agent/documents` | leads/documents scoped by `agentId` | Do not upload/delete or open client co-view. |
| `/agent/tasks` | tasks scoped by `agentId` | Do not toggle completion. |
| `/agent/settings` | owned agent settings | Do not toggle, change password or log out during capture. |
| `/agent/commissions` | commissions/payouts scoped by `agentId` | Read only. |
| `/agent/catalog` | static catalog and local shortlist read | Do not change shortlist during capture. |
| `/agent/catalog/my` | authenticated GET `/api/agent/catalog` | Do not upload/create/delete. |

Explicitly excluded:

- `/agent/meetings/[meetingId]/quote`: `QuoteBuilder` automatically sends `PUT`
  to `/api/agent/meeting/[meetingId]/session` 400 ms after mount/state change.
- `/co/[code]`: GET may update `Meeting.coViewedAt`.
- demo login, OTP, registration, logout, new-case/new-meeting forms and every
  POST/PATCH/PUT/DELETE action.
- completing or dismissing an unfinished onboarding tour: completion posts to
  `/api/agent/onboarding`.

No existing password-login credentials were present in repository, local smoke
configuration or Vercel production environment keys available to the operator.
Vercel stores database variables as non-exportable `sensitive` values and no
smoke account variables exist. Per gate rule, no user was created and no password
was guessed. Authenticated navigation, runtime tenant isolation and browser
console capture therefore remain `BLOCKED`.

## 2. Production schema verification

Connection provenance: existing production database configuration from the main
project working copy. Vercel confirms the corresponding project variables are
production-scoped and `sensitive`; their values cannot be re-exported for a
second value comparison. Only a non-secret host/database fingerprint was retained:
`53613e73cbf9775f`.

Every production SQL statement ran inside `BEGIN READ ONLY` and returned
`transaction_read_only=on`. No connection string, database role, PII or row
content was printed.

Results against the Week 1 schema at main commit
`14904b4aec7d679fa2fb3e3913a7344226c7fb7e`:

- PostgreSQL major: `18`.
- Prisma schema diff: empty migration / no difference.
- `_prisma_migrations`: absent, as expected before baseline adoption.
- `Case`, `CaseEvent`, `CaseStage`, `CaseScenario`: absent; no name conflict.
- public schema: 19 tables, 56 indexes, 157 constraints.
- aggregate legacy counts: 2 agents, 13 leads, 12 meetings, 9 quotes,
  9 quote versions, 5 orders, 5 tasks, 8 notes, 4 agent sessions and 3 users;
  all other recorded table counts are retained in fingerprint
  `d5ba4679ee5a5bbd`.

## 3. Encrypted backup and restore

- Source: production direct PostgreSQL URL, read by PostgreSQL 18 `pg_dump`.
- Format: custom (`-Fc`), `--no-owner`, `--no-acl`.
- Encryption: AES-256-CBC, PBKDF2, random 256-bit passphrase, salted.
- Access: backup and key mode `0600`, stored separately on controlled local host.
- Backup size: 74,368 bytes.
- Backup SHA-256:
  `5520fbe832fb4f86f8f2aa64cd8737c111da5442f59d7d58fe4e9c17e6455508`.
- Backup duration: 22 seconds.
- Actual restore duration: 1 second.
- Restore target: local PostgreSQL 18, `127.0.0.1:55433/td_agent_test`.
- Target proof before migration: database name, loopback address, port and
  PostgreSQL major all matched isolated-clone expectations.
- Restored 19-table aggregate counts exactly matched production fingerprint.

After verification, the clone databases, encrypted dump, encryption key,
count snapshots, Vercel runtime file and PostgreSQL logs were deleted. Both local
PostgreSQL servers were stopped and their task-created data directories removed.
No queryable copied production rows or rehearsal artifacts remain.

## 4. Clone migration rehearsal

Production-equivalent order executed only on isolated clone:

1. Week 1 baseline parity: `No difference detected`.
2. `prisma migrate resolve --applied 20260713000000_baseline`.
3. `prisma migrate deploy` with `lock_timeout=5s` and
   `statement_timeout=120s`.
4. second `prisma migrate deploy`: `No pending migrations to apply`.
5. `prisma migrate status`: up to date.
6. post-migration Prisma schema diff: `No difference detected`.

Measured deployment: 3.64 seconds. No-op deployment: 3.40 seconds. No lock or
statement timeout occurred. Migration creates new enums/tables first; foreign
keys on new tables reference legacy tables, and backfill takes read locks on
legacy data. Main operational risk remains concurrent old-application writes,
not measured lock duration at current data volume.

Post-migration invariants:

- 2 migrations applied; 0 failed/incomplete.
- both enums contain exact expected values.
- `Case` and `CaseEvent` exist with 10 indexes and 4 foreign keys.
- 13 legacy leads -> 13 canonical cases -> 13 migration events.
- orphan case leads: 0.
- tenant/owner mismatches: 0.
- orphan events: 0.
- event tenant mismatches: 0.
- duplicate case leads, public references or event idempotency keys: 0.
- orphan published quote references: 0.
- all 19 legacy table counts preserved exactly.
- reconciliation: 2 agents checked, 0 discrepancies.
- product-truth impossible-state contracts: PT-001 through PT-011 PASS.
- unit: 38 passed, 0 failed, 0 skipped.
- integration: 10 passed, 0 failed, 0 skipped against migrated clone.
- lint, typecheck and production build: PASS.
- applicable local e2e login-page smoke against migrated clone: PASS.

## 5. Delta window and release sequence

`DELTA_WINDOW_RISK` remains open. Old code is compatible with the new schema,
but any old-code write after backfill can create a lead/artifact without a
matching canonical case/event. New code is not compatible with the old schema.

Recommended sequence:

1. obtain existing password-login smoke credentials and complete Week 1
   authenticated read-only smoke first;
2. confirm PR head/CI and implementation SHA have not changed;
3. enforce a technical write freeze covering agent mutations and webhooks;
4. drain active writes and take a fresh encrypted production backup;
5. restore that fresh backup to an isolated clone and verify aggregate counts;
6. repeat read-only Week 1 drift check against production;
7. while freeze remains active, adopt baseline and deploy Week 2 migration;
8. verify migration status, schema parity and backfill invariants;
9. merge PR #19 so automatic Vercel production deployment starts only after
   production schema is ready;
10. wait for terminal Vercel status and run authenticated read-only smoke;
11. lift write freeze only after application and database checks pass.

### Production commands requiring separate authorization

```bash
set -euo pipefail
export DATABASE_URL='<secure production pooled URL>'
export DATABASE_URL_UNPOOLED='<secure production direct URL>'

# Read-only baseline drift check.
git show 14904b4aec7d679fa2fb3e3913a7344226c7fb7e:prisma/schema.prisma \
  > /secure/tmp/week1-schema.prisma
npx prisma migrate diff \
  --from-url "$DATABASE_URL_UNPOOLED" \
  --to-schema-datamodel /secure/tmp/week1-schema.prisma \
  --exit-code

# Only after enforced write freeze and verified fresh backup restore.
PGOPTIONS='-c lock_timeout=5s -c statement_timeout=120s' \
  npx prisma migrate resolve --applied 20260713000000_baseline

PGOPTIONS='-c lock_timeout=5s -c statement_timeout=120s' \
  npx prisma migrate deploy

npx prisma migrate status
npx prisma migrate diff \
  --from-url "$DATABASE_URL_UNPOOLED" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

### Stop conditions

- production target fingerprint/provenance differs from approved target;
- non-empty Week 1 schema drift or pre-existing Week 2 object names;
- fresh encrypted backup cannot be fully restored with matching counts;
- technical write freeze is absent or active writes have not drained;
- PR head, migration checksum or implementation SHA changed;
- any lock/statement timeout, migration error or incomplete migration record;
- any count loss, orphan, duplicate, tenant mismatch or reconciliation issue;
- Vercel deployment or authenticated smoke is not terminal green.

### Rollback / forward-fix

Before new-code traffic: keep write freeze active. If migration verification
fails, do not merge. Restore the fresh verified backup to return to exact Week 1
state, or leave additive tables in place only with an approved forward-fix plan.

After new-code traffic: do not drop `Case` or `CaseEvent`. Freeze writes, return
application traffic to the old compatible build if necessary, preserve append-only
events and apply a reviewed forward-fix migration/reconciliation. Destructive
rollback requires separate Founder authorization and a verified backup.

## Remaining authorization

Separate Founder authorization is required for:

1. securely supplying an existing password-login account for production smoke;
2. implementing and activating a technical production write freeze;
3. taking and retaining a fresh production release backup;
4. production baseline resolve and Week 2 migrate deploy;
5. PR #19 merge and automatic Vercel production deployment;
6. post-deployment authenticated smoke and release of the write freeze.
