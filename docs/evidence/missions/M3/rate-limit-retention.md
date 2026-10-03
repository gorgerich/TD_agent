# M3 rate-limit retention repair

Status: REWORK_REQUIRED until the updated candidate completes CI, independent review,
isolated Preview and verified scheduler execution. This record does not claim a release.

## Authority

The owner authorized the narrow retention repair and continuation of the controlled M3
release on 2026-09-15. Finance, Legal/Privacy and Ritual SME decisions remain PENDING.
The release-policy exception is OWNER_ACCEPTED_RISK / HUMAN_REVIEW_PENDING, not a human
approval or professional attestation. Technical gates and infrastructure protections remain
mandatory. M4 is NOT_STARTED.

## Root cause and implementation

Persistent rate-limit upserts recycled a bucket only when the same identity returned.
Expired identities that never returned accumulated indefinitely. The existing resetAt index
is retained; schema and historical migrations are unchanged.

Cleanup selects at most 128 expired rows in resetAt order, locks them with FOR UPDATE
SKIP LOCKED, rechecks expiry on deletion and executes within a transaction. Limits are
100 ms lock timeout, 1000 ms statement timeout, 500 ms acquisition wait and 2000 ms
transaction timeout. Prisma timestamps are UTC without a timezone, so SQL explicitly
converts the database clock to UTC. A local test against Europe/Moscow caught and corrected
the initial timezone comparison before any release.

Two execution paths are wired:

- Allowed persistent-limit requests may attempt one cleanup per process per minute.
  A shared, reserved database lease permits only one such cleanup per minute across
  instances. A limiter check returning 429 does not initiate cleanup; an earlier successful
  IP check can still do so before a later account check denies the request. The lease commits
  separately before deletion, preserving fleet-wide backoff if deletion fails.
- A daily Vercel cron schedules the dynamic internal endpoint at 03:17 UTC (the platform's
  plan-dependent scheduling window is not an exact-minute execution guarantee). Authorization is
  constant-time Bearer comparison against CRON_SECRET (at least 32 characters), with
  fail-closed handling of missing/invalid configuration. Cron is refused under write freeze.
  Each invocation drains at most 32 batches, stops starting batches after 8 seconds,
  and exposes budgetExhausted rather than asserting the backlog is empty.

Enforcement, renewal and cleanup use the same PostgreSQL UTC clock. Local cadence and drain
budgets use monotonic performance.now(), not wall-clock time. A final in-flight batch can
finish after the eight-second loop budget; the transaction keeps its own two-second bound.

Cleanup errors produce a fixed secret-free warning. They never change the persisted limit
decision. No public unauthenticated cleanup operation is provided. The reserved cadence
row is constant-size housekeeping state and is excluded from cleanup.

## Capacity and residual risk

A bounded batch does not bound total table size. The request path can reclaim up to 128
expired identities per minute when traffic continues (7,680/hour), not a guaranteed service
rate. A daily invocation can reclaim at most 4,096 rows, less under contention/time budget.
The next cron or permitted request continues draining; locked rows remain eligible later.
Active identities are never deleted to enforce a size cap. An idle backlog of 100,000 rows
needs at least 25 daily invocations without additional request-driven cleanup.

Capacity depends on traffic, database availability and lock contention. Budget exhaustion
and failures require operational monitoring; no automatic paid capacity is enabled. A
distributed attack or prolonged outage can exceed this rate. Operators must monitor table
size and oldest expiry and tune an authorized schedule after measured production evidence.
Synthetic burst tests are local correctness evidence, not a production throughput SLA.

## Verification history

- Initial targeted suite: 5 x 6/6 PASS, skipped 0.
- Unit: 125/125 PASS before the cadence revision.
- Full integration initially failed fixture teardown at its existing 5-second timeout while
  build/lint were also running. The timeout was not increased and assertions were not changed.
  A fresh local DB rerun at normal test-file concurrency passed 65/65 with no skips.
- Independent review identified request-driven cleanup amplification as P1. The cadence
  lease and denied-request exclusion address that finding; re-review is required.
- Final targeted suite: 5 x 10/10 PASS, skipped 0. Tests cover a 1,024-identity burst,
  five competing lease claimants, lease expiry, failure backoff, application-clock skew,
  progress past a locked renewed row, and both drain budget boundaries.
- Final full canonical integration: 69/69 PASS, skipped 0, normal file concurrency.
  Post-run Organization/User/Case counts are all zero in the local disposable database.
- Independent static review v3 (session 01a0a67a-3797-7a02-b1b1-844df4622220): no actionable
  P0/P1/P2 in the retention diff. The reviewer read the source and assertions, but did not
  execute tests. This is not a Finance, Legal/Privacy or Ritual SME verdict.
- A fresh independent review on 2026-09-21 found one P1: request-driven retention could
  still write during release freeze through an allowed login. The shared request-path now
  returns before cadence acquisition whenever the freeze is active. A database regression
  proves the login counter and 429 enforcement remain active while no cleanup transaction
  starts and an expired row remains untouched.
- After that repair the targeted suite passed 5 x 11/11. The complete proportional gate
  passed: diff check, lint, typecheck, unit 125/125, canonical integration 70/70,
  production build and all five browser suites; skipped 0 and residue 0/0/0.
- An independent re-review was attempted after the P1 repair, but the reviewer service
  exhausted its usage allowance before producing a verdict. Independent post-fix review
  therefore remains NOT_RUN and is a release blocker, not an inferred PASS.
- Before the freeze-guard repair, working-tree validation passed diff check, lint,
  typecheck, unit 125/125, canonical PostgreSQL integration 69/69 and production build;
  skipped 0. The post-repair 70/70 result above supersedes that integration count.
  Integration discovery is 13 files, including the new retention suite.
- The first browser fixture setup could not connect through localhost. No fixture rows
  remained. The same isolated database was reachable through 127.0.0.1; a fresh browser
  run using that address passed all five canonical suites (legacy, M1 operations,
  administration, commercial and M3 fulfilment). No product code, timeout or assertion
  was changed for this retry. This establishes a working connection path, not a proven
  root cause for the earlier localhost connection failure.
- Browser cleanup PASS; Organization/User/Case residue 0/0/0. M3 browser checks report
  both scenarios PASS, webhook five calls / one entry, reconciliation 0, unexpected 5xx 0,
  mobile/200% zoom PASS and critical/serious accessibility findings 0.
- These local results cover the uncommitted retention delta over
  `36bef466faa1ab600f3fd9e2aad85aee69a8a5d6`, not a certified new commit. Final exact-head
  CI, isolated Preview and deployed scheduler execution remain required.

## Read-only release preflight, 2026-09-21

- Production fingerprint MATCH (`0257665af2dd90a4`); read-only queries found ten migration
  records and zero incomplete records. M3 migration has not been applied by this work.
- Production deployment metadata: `dpl_AkdiVtTqDjsvnX4nS3k4yKbez61g`, READY, source
  `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`; exact project and canonical domain MATCH.
- Production CRON_SECRET metadata is missing. No secret has been created or changed.
- RELEASE_WRITE_FREEZE is Production-only and sensitive. The metadata API did not return
  its value; exact runtime state is not established by that read. An absent value in this
  API response is not evidence of an enabled/disabled mismatch.
- Retained restore fingerprint `0d9dbae9ca626beb` matches the earlier Phase 2 record and
  differs from Production. Read-only inspection found 31 public tables. The retained DB
  was not cleared or restored over. A fresh restore destination remains to be verified.

Production writes: NONE. Production schema changes: NONE. Production deployment: UNCHANGED
by this repair work so far. Do not interpret this historical statement as future release evidence.
