# PR37 Schema And Restore Evidence

Candidate runtime `e9c23c516adf4b136b94a8825ec1cc45626b66a0`, base `055c8d70da428cf5c2c1328c1a5268f9db241b4e`, [PR37](https://github.com/gorgerich/TD_agent/pull/37).
Exact Preview `dpl_CwUNtEzxsxxsg4xJWfFeiCgFxjBg`: https://td-agent-ixjzuqpub-rics-projects-9baa2793.vercel.app; isolated Railway DB fingerprint `545a187f9e9d66b0`, schema `m3_cpo_repair_179224926421011217041`, private Blob `store_Ov8erHstuvfJ52Og`.
At e9 technical verification Production was rebuilt875/frozen, main055 and schema13. Subsequent actual [restricted CPO release](cpo-post-release-20261018.md) uses mergeffc/deployment3qc, disabled freeze and unchanged schema13. Native fresh encrypted backup/actual restore completed2026-10-18 at08:48:15UTC with no-op/parity/catalog/count-digests PASS; no Production migration was repeated. Human verdicts PENDING, full rollout CLOSED, NOX excluded, M4 NOT_STARTED.

## No New Migration

PR37 delta from055 has no schema or migration files. All13 approved migration checksums match. Native PR36 applied the two October migrations with no-op/parity/catalog and old-column digests MATCH; this is recorded execution, not a request to migrate again. Historical11 files remain unchanged. No db push, reset, destructive rollback or truth backfill.

| Already Applied Migration | SHA256 |
| --- | --- |
|20261013183000_cpo_document_review_repair|54fdee932304a66ab45be1f4623c4ec9396181fd2d26ec626994a393407efdf2|
|20261013190000_case_requirement_supersession|c55994662173943bf25bd43ba5ae641a4ffa50e215f7b54d739713d434273ef9|

Exacte9 source CI passed migration/no-op/parity/legacy and encrypted production-like SYNTHETIC backup/actual restore. Fresh Preview operationa42f15088dff15e1faffe412276eab41 restored ONLY a new local synthetic fixture into an empty owned schema, full counts/digests/no-op/parity/local cleanup PASS. Archive SHA2561e289d0fac21fc7c641756222d0eef1bdb26878fb1f2ab39d74ca64d8262110f. Production env metadata SHA256da179aa2534de7c6d29e13a37e4361ed5a6d16fc1fc68ee9d1fb4da70645f56e MATCH before/after Preview configuration.

## Native Continuation Gate

Historical native encrypted Production backup/actual isolated restore at09:33 is valid history, not automatically fresh for another release window. New read-only helper verifies exact fingerprint025/all13 schema history and supports only scope/backup, NEVER Production migrate. Fresh encrypted backup and current13 isolated restore, source/old-data preservation, no-op/parity/catalog and cleanup are mandatory before new PREMERGE. Agent never executes Production credential/helper paths.

Runtime recovery uses the separately supported standard rebuild/redeploy of saved frozen875 source. Hobby402 Instant Rollback is not retried. Verify new deployment ID/alias/source875/READY/actual freeze; retain additive schema/history. Source rebuild is not identical-binary rollback or DB rollback.
