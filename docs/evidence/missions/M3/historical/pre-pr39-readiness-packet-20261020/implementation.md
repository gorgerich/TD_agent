# PR37 Initial Intake Reconciliation Repair

Candidate runtime `e9c23c516adf4b136b94a8825ec1cc45626b66a0`, base `055c8d70da428cf5c2c1328c1a5268f9db241b4e`, [PR37](https://github.com/gorgerich/TD_agent/pull/37).
Exact Preview `dpl_CwUNtEzxsxxsg4xJWfFeiCgFxjBg`: https://td-agent-ixjzuqpub-rics-projects-9baa2793.vercel.app; isolated Railway DB fingerprint `545a187f9e9d66b0`, schema `m3_cpo_repair_179224926421011217041`, private Blob `store_Ov8erHstuvfJ52Og`.
Restricted CPO recovery is now released at PR37 merge `ffc41e4a7105349e3b4aaa65cef3154eebb2a921`, deployment `dpl_3qc23sNV7v6c68LP8UhiJvtMPk2V`, exact disabled freeze. See the [actual post-release record](cpo-post-release-20261018.md). The failed PR36 release and earlier frozen875 recovery remain historical in the [incident](INCIDENT-PR36-20261017.md). Schema13 was already applied; PR37 introduces no migration. Human verdicts PENDING, full rollout CLOSED, NOX excluded, M4 NOT_STARTED.

## Scope

The cumulative37 canonical audit repairs remain in [registry](cpo-registry-current.md), not implemented again. This increment changes only reconciliation plus11 API/PostgreSQL regressions and an incident record. Initial INTAKE/UNSELECTED with no closure, lifecycle history, documents, requirements, Quotes, contracts or financial effects is honest incompleteness, not unsupported-scenario drift. Strict policy parity stays false; policy/contract/payment fulfilment blockers remain. Advanced/lost-materialized/previously progressed states still fail closed. No writes, money, auth, transaction deadline, migration or dependency change.

## Actual Execution

[Source CI39043091834](https://github.com/gorgerich/TD_agent/actions/runs/39043091834):258unit,174PG/23files,5x90concurrency,5x22latency at80ms round-trip delay, maximum parallel4052ms against unchanged5000ms deadline. All27 technical steps PASS, including six E2E scripts, auth failure/recovery, document component browser, four fixture cleanups and encrypted synthetic backup/real restore/no-op/parity. Overall CI FAIL only stale b0 evidence, not retroactively green. Subsequent [exact final-head CI39069388095](https://github.com/gorgerich/TD_agent/actions/runs/39069388095) and [merge main CI39072019723](https://github.com/gorgerich/TD_agent/actions/runs/39072019723) PASS. The final-head latency maximum is4064ms; the earlier4052ms is not relabeled.

[New exact-runtime result](pr37-e9-preview-result.json) covers both full M3 journeys, CPO browser and two new partial-intake replay/census journeys. M3 reconciliation0/unexpected5xx0/skip0. New journey census1Case/1Lead/1Party/3roles/2events/2audits, no documents/financial/work rows per ceremony; fulfilment remains blocked. Local narrowed11 and full174 PostgreSQL tests, unit258/typecheck/lint/build passed separately.

## Boundaries

Only this post-recovery technical interval has Production writes/schema/env/deployment NONE. That claim does not erase native PR36 migrations, retained synthetic effects or failed release. Owned Preview schema/history/secrets remain protected for review; local/browser cleanup is not secret destruction. [Historical packet](historical/pre-pr37-e9-packet-20261017/README.md) preserves b0 facts unchanged.

The later owner-native restricted release is a different measured interval. It performed fresh encrypted backup/actual isolated restore, standard redeploy, controlled unfreeze and replay of four already saved commands only. All51 scoped business and31 retained-synthetic table count/digests match. Authentication/rate-limit infrastructure and deployment configuration did change; do not call the whole release write-free. No new business entities, schema changes, provisioning or financial/document effects occurred. Production verification is the narrow retained-command smoke, not a repeat of the full Preview financial/document UAT.
