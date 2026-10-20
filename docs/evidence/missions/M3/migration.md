# PR39 Migration and Restore Evidence

Runtime `da24768bb6026ba02774e92232059ae3da06fc92`, base `91ae4fb23b8f87c0574ccec23708daeabdc50fc9`, [PR39](https://github.com/gorgerich/TD_agent/pull/39). Exact [Preview](https://td-agent-lf6re44au-rics-projects-9baa2793.vercel.app), deployment `dpl_F8BNU6rZ1TAq2AUn2DbJvaMQ9pai`, isolated Railway fingerprint `545a187f9e9d66b0`, owned schema `m3_cpo_repair_1792434976131_9c13601a`, private Blob `store_Ov8erHstuvfJ52Og`.

Only new migration: `20261018140000_maintenance_job_state`, SHA256 `e9fe7871fbdfaece06745c9a14a3dcc3c96f45a83a799b3ab86993508138a480`. CREATE TABLE plus primary key only; no historical columns, identifiers or data changed. First13 migration checksums MATCH origin/main. No backfill invents previous cron executions.

## Actual Isolated Results

DA source CI and one full local run:14 deploy; repeated deploy NO_OP; schema parity PASS; legacy fixtures PASS; orphan/duplicate/tenant mismatch assertions0. Local AES256 encrypted synthetic pg_dump restored into an owned local database;54 table counts/digests MATCH; restored schema repeated deploy NO_OP and parity PASS. Local owned schemas/databases cleanup PASS. [Receipt](technical-readiness/pr39-da-local-gate.json).

Preview applied14 only to new synthetic owned schema in approved Railway service857fe7b5-0392-4579-9c09-aa10d174b51d, project317daa1f-dd94-4c1e-84bb-929abd290d9f. Target545a187f9e9d66b0 differs Production0257665af2dd90a4. Existing unknown schemas were not reset/deleted. Application unique-case readback and reconciliation0 prove post-redeploy binding; env write acknowledgement alone is not isolation proof.

## Production Release Preconditions

No PR39 Production migration performed. Historical Oct18 native schema13 backup is NOT a fresh schema14 rehearsal. Existing PR37 owner runner pins13/no migration and is inapplicable unchanged.

Static compatibility: old91ae tolerates additive14; newDA requires14 for retention observation/health. Before a merge-triggered deployment, a newly reviewed native plan must verify target025 and current rollback runtime, enable/verify freeze, take fresh encrypted backup, actually restore that exact archive in isolation, rehearse13-to14/no-op/parity/counts and then apply only reviewed14 while the compatible old runtime remains frozen. Require14 successful history, unchanged business/census and parity before protected merge/main CI/exact deployment. No db push/reset/down migration.

On runtime failure retain14 and immutable history, restore reviewed compatible old runtime, retain freeze and contain only synthetic access. Runtime rollback is not DB rollback. Fresh native Production execution is not attempted through a credential/permission fallback. No Production baseline digest was measured here.
