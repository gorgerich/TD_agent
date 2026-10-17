# PR36 Security Evidence

Candidate runtime `b0b2d784e89c91211ff4b3df0d5bb7cd150f38a4`, base `87550178d6b4ba60b3f752880fd08674c6fd2835`, [PR36](https://github.com/gorgerich/TD_agent/pull/36).
Exact Preview `dpl_DPhyGiZBuGeWTzY4SJGTbJHKFNS5`: https://td-agent-jfnz3t53l-rics-projects-9baa2793.vercel.app; isolated DB fingerprint `545a187f9e9d66b0`, schema `m3_cpo_repair_1792184661797936430`, private Blob `store_Ov8erHstuvfJ52Og`.
Production remains `87550178d6b4ba60b3f752880fd08674c6fd2835` / `dpl_8rqT8aRp2x75wfxHVpmJBaMigytY`, fingerprint `0257665af2dd90a4`, freeze disabled. PR36 CPO release NOT_PERFORMED; human/full rollout BLOCKED.

## Verified Technical Boundaries

Current tenant/Membership roles, stable uploader identity, purpose-limited Finance/Reviewer projections, private storage, immutable document/contract/ledger history, reserved command namespaces, MFA/current-session CAS and signed webhook replay are covered by current CI and cumulative source review. [Registry](cpo-registry-current.md) maps each CPO row. CPO12 Finance read is FIXED with same-organization scope and foreign404, not an open exception.

Browser callbacks and abandoned waiters have explicit ownership; failures discard raw error/call-log/header material. MFA pixels are masked where captured. Auth infrastructure diagnostics allow fixed stages/status/source basenames only; actual CI failure/recovery passed at b0. Original prior one-second CI cause remains UNPROVEN: current PASS does not prove historical429 or framework causation. Password costs, limiter windows, transaction deadlines and assertions were not relaxed.

## Cleanup And Retained Material

UAT wrapper publishes the receipt only after each child exits0. M3 and CPO finally blocks close browser/context and settle owned asynchronous callbacks; failures set nonzero exit. This supports LOCAL browser/context/async-resource cleanup, not remote database/account deletion. CPO logout additionally asserts real cookie clear and protected redirect. Cookies discarded/expired are not server revocation of copied stateless tokens.

Owned Preview schema, accounts/invitations/history, private Blob fixtures and protected fixture secrets are RETAINED for controlled review. No credentials, cookies, MFA seeds, URLs containing credentials, private file contents or signing keys are included in this packet. Local restore resources cleaned according to operation9b3 receipt. Source CI's four fixture cleanup steps passed; that CI cleanup is distinct from retained deployed Preview data.

## External Boundaries

Real Production scanner/provider readiness remains unverified; synthetic CLEAN and fail-closed503 do not certify malware scanning. Human policies/thresholds/legal/ritual verdicts remain awaiting. Existing CPO-only scope ceiling, NOX exclusion and M4 NOT_STARTED remain. Historical Production credential denial is not rerouted; no agent PTY/SSH/alternate-source execution. Owner OT01-05 source closures do not waive remaining Preview-proof P2, final CI/binding, or actual tool policy.

## History

[Prior packet](historical/pre-pr36-b0-packet-20261017/README.md) preserves the old c0567/PR34 candidate, executions and Production history. [Dated checkpoint](cpo-audit-repair-20261013.md) preserves failed/interrupted attempts and later outcomes without reassigning them to b0.
