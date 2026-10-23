# M3 Migration And Restore

Runtime `48eef7cd34b4cc2f9898dadf4506a32da8699962`, base `91ae4fb23b8f87c0574ccec23708daeabdc50fc9`, [PR39](https://github.com/gorgerich/TD_agent/pull/39). [Exact Preview](https://td-agent-h162tsojw-rics-projects-9baa2793.vercel.app), deployment `dpl_HszboxTiE1dYJu5dgrBUTciaQ126`, isolated Railway fingerprint `545a187f9e9d66b0`, schema `m3_cpo_repair_1792775433611_04dc5b99`, private Blob `store_Ov8erHstuvfJ52Og`.

Candidate has17 migrations. Relative to serving main, additions14-17 create `MaintenanceJobState`, `StaffAccountRecovery`, `PlatformOrganizationInvite`, `M3ProductionActivation` and `M3ReviewerCredentialEpoch`. The last migration also adds immutable-activation and reviewer-credential epoch triggers/functions and backfills only the epoch projection from existing audit records; this grants no approval. Historical migration bytes are unchanged. No legacy uploaded document becomesVERIFIED; no payment note becomes a proven ledger payment, no invented payer/consent or destructive history reset.

Exact48 full local and sourceCI deploy/no-op/parity and production-like legacy fixtures PASS. AES256 synthetic pg_dump was actually restored into an owned isolated local DB:58tables counts/digestsMATCH, restored no-op/parityPASS, cleanupPASS. Preview17 migrations/no-op/parity used only the new approved545 namespace; existing unknown data was not deleted.

## Native Release Gate Still Pending

No fresh Production migration inventory, drift query, backup, isolated restore or rehearsal is claimed here. A reviewed runner must read actual applied history, verify025/current rollback/freeze, take a fresh encrypted native backup, actually restore it in isolation, rehearse only genuinely pending additive migrations and verify old-app/new-schema compatibility before merge-triggered deployment. New code needs the final schema; a runtime rollback is not a schema rollback. Historical13/14-migration runners are not applicable unchanged. No denied credential action will be repeated via another tool.

Production remains91ae on READY dpl_EUHyDbLQgdVP2fgWubxvZdsdWguW. No PR39 Production DB/schema/env/deployment/freeze write, merge, smoke or fresh customer digest is claimed. Human verdicts remain PENDING; real rollout stays closed until all mandatory conditions. NOX excluded, M4 NOT_STARTED.
