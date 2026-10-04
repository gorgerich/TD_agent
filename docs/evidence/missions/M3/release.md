# Controlled Intake Hotfix CPO Release Packet

Full-agent mission state: `BLOCKED_HUMAN_JUDGMENT`. This is distinct from the owner-authorized, synthetic-organization-only CPO audit release, which remains pending the final green evidence-head CI and controlled production gates.

## Current Reconciliation Repair, 2026-10-04

Source `c0567d11d4a80d1488a1e8bca6dc1815ffc83806`, PR #34, based on main `8deda6c3dbeb79dd15f3897a44ee16a492f55cca`. Exact Preview `dpl_AkHmeuGd4EoQJVTPqEH3qpCeKgUa`, https://td-agent-2z7lvoo1b-rics-projects-9baa2793.vercel.app; Railway fingerprint `545a187f9e9d66b0`, private store `store_Ov8erHstuvfJ52Og`. Fresh synthetic schema `m3_intake_preview_1791111530558`, run `intake-1791111530558`. Both full authenticated journeys PASS, including the new pre-upload reconciliation API regression, document review/replacement, immutable contract/ledger, partial/full/refund/reversal, four-eyes, webhook replay, cross-tenant and failure recovery. Reconciliation=0, unexpected5xx=0, skipped=0, critical/serious accessibility=0, mobile/200% zoom PASS.

Local gate: 143 unit, 92 integration across 15 files, canonical build, all five E2E scripts, migrate/no-op/parity and cleanup PASS. Independent exact-source delta review P0=0/P1=0; inherited Finance P2 remains documented. Source CI https://github.com/gorgerich/TD_agent/actions/runs/37197375921; authoritative evidence-head CI remains a separate pre-merge gate.

Fresh read-only encrypted backup and real isolated restore: receipt `intake-2026-10-04T11-05-23.102Z`, 52 table counts/digests MATCH, parity PASS, no-op, plaintext clone removed. Production during this technical validation remains frozen rollback `dpl_4sFF8Boy1yHkyx2kbb8N3GXVySwo`, source `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`. Earlier committed synthetic Case57 histories and the false reconciliation stop are preserved in reconciliation-incident.md, not erased. No Production migration is needed for this repair. Human verdicts PENDING; broad rollout CLOSED; CPO-only release still requires green final CI and controlled Production smoke.

## Historical Intake Hotfix Validation, Superseded

Implementation `4bc03e2f228d64f9d12325cfe21b683ee143d5a1`; PR #33; Preview `dpl_7CEoXKy9ArgdvC95KhNw2UKco7tC`, https://td-agent-77fadgqm7-rics-projects-9baa2793.vercel.app; Railway fingerprint `545a187f9e9d66b0`, private store `store_Ov8erHstuvfJ52Og`. Current authenticated UAT passed both complete scenarios with reconciliation=0, unexpected 5xx=0, skipped=0, mobile/200% zoom and critical/serious accessibility=0. The previous interrupted Preview and continuation-harness omission are retained in intake-validation-current.json; neither is counted as PASS.

Technical source CI: https://github.com/gorgerich/TD_agent/actions/runs/37159816398. All technical steps passed; overall FAIL at stale authoritative evidence is NOT green overall CI. Green evidence-head CI remains required before merge. Independent exact-source review: P0=0/P1=0, one unchanged documented P2. Human verdicts remain PENDING and broad rollout CLOSED.

## Actual Production State Before Hotfix Merge

- Main contains M3: `c9e8a9373d10e1e2c1b2f2d6a4bcbb49654e7de1`.
- PR #32 is already merged. This repair is PR #33, currently Draft pending final overall CI/release preflight.
- Serving rollback: `dpl_PZHnvWjMdhWAMYthAChf3gBCXM5f`, SHA `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`, https://td-agent.vercel.app, freeze enabled/header active.
- Production fingerprint: `0257665af2dd90a4`; NOX excluded by prior Railway endpoint/volume isolation proof.
- Original M3 migration and CPO provisioning committed under operator authorization before the intake incident. Failed intake rolled back its transaction; Lead 57 / Case `case_16785ce6b182455ca421fdab8f18cd74` remain INTAKE, one creation event, requirements/meetings/quotes/ledger zero.
- Read-only real-customer baseline MATCH for 34 tables; volatile security table explicitly excluded. Real customer records changed during this repair: 0.
- Fresh encrypted backup/real restore PASS for 52 tables; receipt `intake-2026-10-04T09-33-06.999Z`; keys separate; plaintext clone removed. Check freshness before merge.

## Remaining Controlled Steps

Green exact evidence-head CI and Preview source equivalence; final independent packet review; fresh preflight/backup as required; protected PR #33 merge; main CI; exact merge-SHA frozen Production deployment; read-only smoke; controlled synthetic writes only in existing `m3-cpo-audit-20260923`, reusing Lead/Case 57; reconciliation/baseline/containment; final exact disabled freeze only after PASS. Failure retains freeze and rolls runtime back to the verified target, never destructive schema rollback. No new tenant/reprovision operation is authorized by this hotfix.

Real organizations cannot execute M3 financial/document/legal writes. Production scanner remains unconfigured and verification fail-closed. Finance/Legal/Ritual verdicts remain PENDING; full agent rollout CLOSED. M4 NOT_STARTED.
