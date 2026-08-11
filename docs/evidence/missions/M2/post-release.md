# M2 Commercial Trust Loop - release chronology

Authoritative status as of 2026-08-11: `POST_RELEASE_VERIFIED`.

The current production deployment is `dpl_Cdk9bcWg9EYE5B482etPGQTzC9VP`, READY at
`b8f6a40555c5fda83798dc2fc3fc96386d9156fd`, and serves `https://td-agent.vercel.app`.
The production database fingerprint remains `0257665af2dd90a4`. Ten migrations are applied;
their approved checksums match, no migration changed in the hotfix, and schema parity is
`No difference detected`. `RELEASE_WRITE_FREEZE` is `disabled`.

Everything below this authoritative record preserves earlier release and stopped-attempt
facts. Historical blocker states are superseded where a later section explicitly closes them.

## 2026-08-11 idempotency truth hotfix - production verified

The response-truth defect recorded below was repaired in PR #30. The hotfix started from
`fb5d76bfe328810fec5aa72b9a097e22ec09cc87`; runtime repair source
`4f1b78481a305b05eabbee4c3fcea297707bd3ce` and evidence head
`004864f20ac7c58ed0a49d6e4898bee7df7fdc5f` merged as
`b8f6a40555c5fda83798dc2fc3fc96386d9156fd`.

The root cause was a response-boundary error: the first command correctly persisted its
domain result with `replayed: false`, but the replay path returned that JSON unchanged. The
repair leaves the persisted first result immutable and overlays `replayed: true` only after a
validated idempotency hit. Same-key/different-payload requests still conflict, malformed stored
results fail closed, and domain creation semantics are unchanged.

Release gates:

- exact-head CI `31484886101`: PASS, skipped tests 0;
- main CI `31486011860`: PASS, skipped tests 0;
- exact-head Preview `dpl_831MXqVLy1gy2fKbxMs2x6CTVZ5f`: READY at
  `https://td-agent-fvpsgg7ww-rics-projects-9baa2793.vercel.app`;
- independent review of runtime source: P0=0, P1=0, P2=0;
- targeted idempotency suite: 5/5 runs, 3/3 tests per run;
- unit 96/96, integration 47/47 across five full repeats, browser suites PASS;
- migration diff: none; all ten historical checksums: MATCH.

Production deployment `dpl_5DfQBc49c5GvaicQTDR4oq3vgb1T` first promoted the exact merge
SHA while the write freeze remained enabled. Authenticated frozen smoke passed for Agent and
Manager reads, capability denial and cross-tenant 404; the representative publish mutation was
blocked at the proxy with 503. The same deployment was then rebuilt with only the freeze value
changed to `disabled` as `dpl_Cdk9bcWg9EYE5B482etPGQTzC9VP`; the production alias points to
that READY deployment. The known-good frozen rollback remains
`dpl_9qKCzo2jmnHtvggAWdSbpBpf9GB5` at source
`f6f3f17e984d7b1baaff619c9bcf063933e63e05`.

The production replay used only the designated synthetic tenant
`m2-p1-prod-smoke:20260809t165002z`. The stored first result remained version 1 / QuoteVersion
42 with `replayed: false`; the exact HTTP replay returned 200, the same version and
`replayed: true`. Before and after were identical: QuoteVersion rows 2, numbered Published
versions 1, publish audit rows 1, CaseEvent rows 5, Task rows 2, ProjectionReceipt rows 3,
all operational audit rows 14, links 0, decisions 0 and presentation sessions 0. The exact
publish CaseEvent and publish audit each remain singular. Added replay side effects: 0.

Temporary access was bounded by append-only audits
`c171b725-86ae-43a7-8895-f3220bee36a6` and
`d9859926-55cd-4cc0-802a-e277dcda1391`. Final containment is: Organization suspended; Users
209/210 have no password hash and incremented session versions; Agents 219/220 and both
memberships suspended; old temporary-password login 401; active links, tasks, meetings,
presentations and agent sessions all 0. Temporary passwords, cookies and local project links
were destroyed.

Retained synthetic domain IDs are Lead 55, Case
`case_5abca500cf1e490b90e2512e75409d9b`, Meeting 48, Quote 37, QuoteVersions 41/42,
Tasks 34/35, four QuoteLineItems, five append-only CaseEvents and three ProjectionReceipts.
They remain for honest audit history; no append-only record was deleted.

Commercial reconciliation discrepancies: 0. Operations reconciliation discrepancies: 0.
The pre/post digest of every non-synthetic row is
`e8853c82defcb9759d0f30fa9620c4e30e8acfa73017b71b473102522bfc04cb` on both sides; real
customer records changed: 0. Production schema changes: none. The only production writes in
this hotfix window were the two-user/two-agent/two-membership synthetic access activation and
containment updates plus two append-only synthetic audit events. M3 remains `NOT_STARTED`.

## 2026-08-09 idempotency response incident and hotfix candidate

PR #29 merged as `fb5d76bfe328810fec5aa72b9a097e22ec09cc87`; main CI run
`31324471482` passed with zero skipped tests. Production verification then found one narrow
response-truth defect: the first publish correctly returned `replayed: false`, but an exact
retry returned the persisted first-command result and therefore also reported
`replayed: false`. The retry did not duplicate domain state: Published QuoteVersion, CaseEvent,
Task and ProjectionReceipt counts remained unchanged.

Containment completed before this hotfix work began. The candidate deployment
`dpl_6cCGMvpkKCQcLA4xdWr3XKjxY4ou` was replaced by the known-good runtime source
`f6f3f17e984d7b1baaff619c9bcf063933e63e05`. Frozen production deployment
`dpl_9qKCzo2jmnHtvggAWdSbpBpf9GB5` is READY and serves `td-agent.vercel.app` with
`RELEASE_WRITE_FREEZE=enabled`. The designated synthetic tenant, users, agents and memberships
are suspended; active links, sessions, tasks, meetings and presentations are zero. Commercial
and operations reconciliation discrepancies are zero, the non-synthetic production baseline
digest matches, and real customer records changed are zero.

Hotfix base: `fb5d76bfe328810fec5aa72b9a097e22ec09cc87`.

Runtime repair source: `4f1b78481a305b05eabbee4c3fcea297707bd3ce`.

The fix leaves the persisted original result unchanged and overlays `replayed: true` only when
an existing idempotency result is returned. Publish replay additionally verifies a complete,
endpoint-specific persisted result shape and the immutable version against the original quote,
validity, channel, reason and idempotency key. Reusing the same key with changed command data
returns `IDEMPOTENCY_CONFLICT` without side effects; malformed stored results fail closed with
`IDEMPOTENCY_REPLAY_INVALID`.

Local verification on an isolated PostgreSQL database passed: targeted idempotency 5/5 runs
(3/3 tests per run), unit 96/96, integration 47/47 for five consecutive full-suite runs, all
four browser suites, lint, typecheck, production build, production-like migration fixtures,
repeated migrate deploy no-op, and schema parity (`No difference detected`). Browser evidence
covers Agent, Manager, Platform Admin, Organization Admin, cremation, relative burial,
Draft/Published isolation, client decisions, print, failure recovery, cross-tenant denial,
mobile, 200% zoom and zero critical/serious accessibility findings. Skipped and NOT_RUN checks
are zero. Test residue, schema changes, migration changes, dependency changes and UI changes
are zero.

A concurrent cleanup deadlock found during the repeat gate was repaired with bounded retry of
the exact-ID, idempotent fixture transaction after full rollback; no suite serialization, broad
cleanup, timeout or production retry budget changed. A later SSI collision came only from an
unnecessary publish command used to prepare the accepted-draft regression fixture; the fixture
now creates that exact pre-existing lifecycle state directly, while the tested save/replay
commands remain unchanged.

Independent review round 1 returned P0=0, P1=0, P2=1; complete persisted-result validation
closed that finding. Round 2 returned P0=0, P1=1, P2=0 because an accepted quote can persist an
`ACCEPTED` draft-save result. The final runtime source accepts exactly `DRAFT` and `ACCEPTED`
for that endpoint and adds a persisted-result regression. Final independent review of exact
runtime source `4f1b78481a305b05eabbee4c3fcea297707bd3ce` returned P0=0, P1=0, P2=0 and recommends
merge. Exact-head GitHub CI and Vercel Preview remain required before merge.

Production changes made while preparing this hotfix: NONE. The release write freeze remains
enabled. M3 remains `NOT_STARTED`.

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
