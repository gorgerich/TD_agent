# M3 intake incident: 2026-10-03

## Incident and containment

- Released main: `c9e8a9373d10e1e2c1b2f2d6a4bcbb49654e7de1`.
- Request: `PATCH /api/agent/cases/57/intake`, designated synthetic CPO organization only.
- HTTP 500, Prisma P2028 at `case.findUnique`: 5,000 ms transaction deadline, 5,074 ms elapsed.
- Lead 57 and Case `case_16785ce6b182455ca421fdab8f18cd74` were created before intake.
- Intake writes rolled back: stage INTAKE, one creation event, no materialized requirements, meetings, quotes or ledger entries.
- Finance synthetic MFA enrollment had committed before the intake failure.
- Production runtime rollback: `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`.
- Serving rollback deployment: `dpl_PZHnvWjMdhWAMYthAChf3gBCXM5f`.
- Freeze remains enabled. M3 schema retained; no destructive schema rollback.
- Human Finance/Legal/Ritual verdicts remain PENDING; general agent rollout remains closed.

## Root cause and measurement boundaries

Initial intake loaded the entire aggregate five times in one transaction, including unrelated quote, financial and document relation trees. The original-source reproduction uses the complete approved synthetic policy fixture, not a reduced fixture.

| Source | Scenario | SQL statements | FOR UPDATE statements | Local transaction ms |
| --- | --- | ---: | ---: | ---: |
| Original main | Cremation | 76 | 6 | 951 |
| Original main | Family-plot burial | 76 | 6 | 623 |
| Joined-facts repair candidate | Cremation | 32 | 3 | 159 |
| Joined-facts repair candidate | Family-plot burial | 32 | 3 | 106 |
| Batched-projection repair candidate | Cremation | 30 | 3 | 404 |
| Batched-projection repair candidate | Family-plot burial | 30 | 3 | 320 |
| Preloaded-requirements repair candidate | Cremation | 28 | 3 | 150 |
| Preloaded-requirements repair candidate | Family-plot burial | 28 | 3 | 103 |

Application region `iad1` and Railway TD Agent database region `us-west2` differ. A read-only operator-Mac probe of 20 `SELECT 1` calls measured median 279.105 ms, p95 347.587 ms and max 356.452 ms. This is **not** a measurement of Vercel-to-database RTT. The incident duration divided by reproduced query count implies about 66.8 ms per query, but this is an inference, not a captured production SQL trace. Current read-only lock-waiter count was zero; historical lock wait is unknown. SQL lock-statement timing includes network time and is not server lock-wait timing.

## Repair contract

- Reuse the tenant/owner-locked Case and returned Lead row for the two initial transitions.
- Initial transition validation uses only intake facts; later financial/document transitions retain full authoritative validation.
- Keep all transitions, requirements, projections and audit in the same atomic transaction.
- Read only date and effective party roles for requirement applicability, in one parameterized tenant-constrained joined query.
- Preserve policy and Case lock ordering, idempotency guards, original stored command result and truthful replay response.
- Batch the two scenario tasks and their two audit entries, retaining actual returned task IDs and deterministic projection result order. Parent replay is checked behind the Case ownership lock before waiting on a policy lock.
- No migration, transaction timeout increase, retry of P2028, weakened policy or production allowlist expansion.

## Validation status

The 34-query intermediate repair passed two latency repeats but failed the third with P2028 (15/16). That candidate was reworked, not released or marked PASS.

The 32-query candidate first passed 16/16 but its second repeat failed 13/16: scenario selection and parallel duplicate requests still reached P2028. That intermediate candidate was also reworked.

The 30-query candidate passed two targeted runs but failed the third headroom assertion (4,521.74 ms for one parallel transaction). CI `37158163153` independently reproduced that boundary (4,512.15 ms). Both are FAIL, despite successful HTTP responses and zero duplicates.

The 28-query revision preloads existing tenant requirements and refreshes historical rows without rereading newly materialized rows. PostgreSQL regressions passed 18/18, skipped 0, including historical applicability and its audit for both scenarios. Five fresh 80 ms latency repeats are pending. The unchanged deadline is 5,000 ms; normal and parallel regression assertions require at least 500 ms headroom. Final gates, independent exact-SHA review, new authenticated Preview UAT and production re-release are pending. Historical UAT is not evidence for this candidate.

The latency harness is local-only, preserves concurrent request scopes and packet ordering, and retains realistic policies, requirements, audit and projections. Fault injection after the final intake event proves rollback; five parallel duplicate requests must commit exactly once. No production test data is copied into fixtures.

## Release boundary

Do not merge or promote this candidate until all required repair gates and new exact-runtime Preview UAT pass. Before release, recheck production fingerprint `0257665af2dd90a4`, customer baseline, freeze, backup/restore readiness and rollback deployment. Resume the retained synthetic Case 57, not a replacement tenant. Existing M3 migration is already applied and must not be manually reapplied. On failure preserve freeze and financial/document history, and restore the verified runtime target.
# Continued repair on 2026-10-04

The 28-query candidate `64505ffc58ccd118b2b456de6b9aa238b2cf2a0a` passed all
technical steps of source CI `37158517403`, including the 80ms latency gate,
canonical integration, required concurrency repeats, build, E2E and encrypted
restore/parity. Its overall CI failed at authoritative evidence validation.
This is not a green overall CI or release approval.

Local v4 and diagnostic runs retained two later-stage/initial timeout failures;
they are not relabeled PASS. The subsequent repair removes the early policy lock
only when the locked Case is beyond INTAKE/PLANNING, where scenario selection and
materialization cannot occur. Tenant/owner Case locking and requirement refresh
remain mandatory. Regression tests assert two raw operations on those edits and
record operation names/durations without query values. Five new latency repeats
and exact-runtime authenticated UAT remain required before release.
