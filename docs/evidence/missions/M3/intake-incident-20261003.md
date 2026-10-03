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

The 30-query batched-projection candidate has passed the first two targeted runs, each 16/16 and skipped 0, with 80 ms injected network RTT. Initial transactions measured 2,896/2,895 ms and 3,662/2,922 ms. First-run parallel transaction durations were 2,331-3,614 ms. The unchanged deadline is 5,000 ms; normal and parallel regression assertions require at least 500 ms headroom. Remaining targeted repeats, final gates, independent exact-SHA review, new authenticated Preview UAT and production re-release are pending. Historical UAT is not evidence for this candidate.

The latency harness is local-only, preserves concurrent request scopes and packet ordering, and retains realistic policies, requirements, audit and projections. Fault injection after the final intake event proves rollback; five parallel duplicate requests must commit exactly once. No production test data is copied into fixtures.

## Release boundary

Do not merge or promote this candidate until all required repair gates and new exact-runtime Preview UAT pass. Before release, recheck production fingerprint `0257665af2dd90a4`, customer baseline, freeze, backup/restore readiness and rollback deployment. Resume the retained synthetic Case 57, not a replacement tenant. Existing M3 migration is already applied and must not be manually reapplied. On failure preserve freeze and financial/document history, and restore the verified runtime target.
