# Missing-document reconciliation incident, 2026-10-04

## Preserved Production Facts

PR #33 merged at `8deda6c3dbeb79dd15f3897a44ee16a492f55cca`; main CI 37193479466 passed. Synthetic CPO Case `case_16785ce6b182455ca421fdab8f18cd74` (Lead 57) completed intake, immutable QuoteVersion 44 acceptance, synthetic contract signing, obligation and two payments. Its 176000 RUB obligation and 88000 RUB first payment correctly produced PARTIALLY_PAID and 88000 RUB balance; the second payment produced PAID and zero balance. These committed histories were retained.

Production has no approved malware provider. Its one uploaded document stayed QUARANTINED with scan ERROR; review returned 409, private access 404 and execution transition 422 GUARD_FAILED. These are deliberate fail-closed controls, not a claim of production verification success.

At deployment `dpl_DZtQetDYhXwsN1z69QPXtRw9D5wo`, GET `/api/agent/cases/57/reconciliation` succeeded but returned two DOCUMENT_TENANT_MISMATCH discrepancies for requirements `cmutnya5y0004o4usrt3up3km` and `cmutnya5y0005o4usimdpe3ot`. Both had no document. The smoke stopped; freeze was enabled and rollback runtime `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4` was rebuilt as `dpl_4sFF8Boy1yHkyx2kbb8N3GXVySwo`. READY, domain alias, exact source and active freeze header were verified. No schema rollback or history deletion occurred.

## Root Cause And Narrow Repair

The optional document relation was compared using `requirement.document?.organizationId !== record.tenantId`. An absent relation yields undefined, which is unequal to the tenant ID. Absence was incorrectly classified as foreign ownership rather than an unsatisfied document requirement.

Source `c0567d11d4a80d1488a1e8bca6dc1815ffc83806`, based on main `8deda6c3dbeb79dd15f3897a44ee16a492f55cca`, checks document tenancy only when the document exists. Requirement tenancy, document-version tenancy, policy/applicability checks and readiness blockers are unchanged. No migration or timeout change.

## Regression And Provenance

- Before repair: canonical M3 PostgreSQL target 7 passed, 1 failed, skipped 0. The new assertion reproduced the false mismatch.
- After repair: target 8/8 PASS, skipped 0, owned schema dropped. Both cremation and relative burial cover missing documents, one quarantined document with other missing requirements, and an intentionally foreign empty document that still produces the mismatch.
- Browser regression reads reconciliation before uploads in both journeys and requires no false tenant mismatch while readiness remains blocked by DOCUMENT_NOT_VERIFIED.
- Independent reviewer inspected exact committed three-file diff, P0=0/P1=0. Its own earlier 8/8 run preceded the added mixed-state assertion; the updated target execution is implementer evidence, not falsely attributed to the reviewer.
- Historical PR #33 source, UAT and overall green CI remain bound to their old SHA; they do not certify this new source.

Production release remains contingent on new exact-source Preview UAT, authoritative evidence-head CI, protected merge/main CI and limited synthetic resume. Finance, Legal/Privacy and Ritual SME verdicts remain PENDING. Broad rollout remains closed; CPO audit is not human sign-off.
