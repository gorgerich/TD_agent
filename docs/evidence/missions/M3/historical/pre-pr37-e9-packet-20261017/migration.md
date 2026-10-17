# PR36 Migration And Restore Evidence

Candidate runtime `b0b2d784e89c91211ff4b3df0d5bb7cd150f38a4`, base `87550178d6b4ba60b3f752880fd08674c6fd2835`, [PR36](https://github.com/gorgerich/TD_agent/pull/36).
Exact Preview `dpl_DPhyGiZBuGeWTzY4SJGTbJHKFNS5`: https://td-agent-jfnz3t53l-rics-projects-9baa2793.vercel.app; isolated DB fingerprint `545a187f9e9d66b0`, schema `m3_cpo_repair_1792184661797936430`, private Blob `store_Ov8erHstuvfJ52Og`.
Production remains `87550178d6b4ba60b3f752880fd08674c6fd2835` / `dpl_8rqT8aRp2x75wfxHVpmJBaMigytY`, fingerprint `0257665af2dd90a4`, freeze disabled. PR36 CPO release NOT_PERFORMED; human/full rollout BLOCKED.

## Exact Additive Delta

| Migration | SHA256 |
| --- | --- |
|20261013183000_cpo_document_review_repair|54fdee932304a66ab45be1f4623c4ec9396181fd2d26ec626994a393407efdf2|
|20261013190000_case_requirement_supersession|c55994662173943bf25bd43ba5ae641a4ffa50e215f7b54d739713d434273ef9|

The eleven existing migration checksums remain unchanged; total13 migrations. Trigger enforcement and nullable supersededAt are additive. No legacy upload becomes verified, payment note becomes ledger truth, or unknown consent/signing fact becomes approved. No destructive history cleanup.

## Actual Rehearsals

Exact b0 CI passed migration, repeat NO_OP, schema parity, legacy fixture assertions and actual encrypted production-like SYNTHETIC backup/restore. This is not a fresh Production backup.

Fresh Preview restore operation `9b3fad201b486f897e9b358a17ad1507`, created2026-10-16T21:04:20.816Z, returned READY_FOR_EXACT_SHA_PREVIEW_REDEPLOY at exact b0. Synthetic local fixture only, UTC53-table counts/digests match, mismatchTables empty, restore exit0, no-op/parity and localCleanup PASS. Synthetic archive SHA256 `9bb8ed56493174d36f67f934576040fb0e16cedc594e9a5cbd7b30abfb1ba778`. Only five Preview keys updated; no secret values published. Remote owned synthetic schema retained for review; no remote fixture deletion claimed.

Historical2026-10-14 read-only Production-source encrypted backup/real restore remains historical in the checkpoint. It is NOT fresh PR36 release preflight. A fresh frozen875 rollback and encrypted backup with real isolated restore remain required before approved owner migration. Exactly the two approved migrations must run while frozen BEFORE protected merge because main auto-deploys.

## Failure Safety

No PR36 Production migration was performed. Keep freeze after release failure; restore exact recorded frozen875 runtime and verify actual probes, never erase additive schema/history. Old875 document uploads intentionally fail closed under the new trigger; rollback does not promise full write compatibility. Fresh owner-terminal procedure is independently gated; no agent credential retrieval or Production helper execution.

## History

[Prior packet](historical/pre-pr36-b0-packet-20261017/README.md) preserves the old c0567/PR34 candidate, executions and Production history. [Dated checkpoint](cpo-audit-repair-20261013.md) preserves failed/interrupted attempts and later outcomes without reassigning them to b0.
