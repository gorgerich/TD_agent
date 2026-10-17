# Independent Adversarial Review Continuation

Recorded: 2026-10-16. External review receipt only; not mission acceptance, CI/UAT PASS, human approval, or release authorization.

## Exact Binding

- Base: `87550178d6b4ba60b3f752880fd08674c6fd2835`.
- Prior cumulative review: `944015151be81a241956a077ebda62ee0d53d61b`, recorded in `independent-source-review-94401515.md` in this directory.
- Current HEAD: `92169538d6a8df600e52d1e93102dc0ef82924a7`.
- HEAD and clean tree independently checked. Base-to-HEAD contains 141 changed paths; 944-to-HEAD contains exactly seven.
- This continuation independently reviews the entire seven-file increment and carries forward the prior substantive cumulative review of all 49 original HTML records and 37 registry entries. It is not a claim that all 141 files were reread from scratch in this turn.
- The increment contains six test/harness files and exactly `docs/evidence/missions/M3/cpo-audit-repair-20261013.md`. No app/lib/prisma/schema/migration/dependency/lockfile/workflow/script runtime change from 944. Therefore the previously reviewed runtime repair is byte-identical in those paths.

## Findings And Status

- No newly established P0/P1/P2 source defect in the seven-file increment. No unclosed concrete runtime P0/P1/P2 established by the cumulative review chain. This is not exhaustive formal verification.
- R944-01 / CPO09 missing server regression: source coverage gap CLOSED. Added API denial after ISSUED and SIGNED with repeated409 and unchanged snapshots; positive multiple payers and unbound draft mutation/replay; injected role drift blocks ISSUE/SIGN and reconciles issued drift; conflicting issue/removal commands cannot both commit and audit winner/loser assertions are explicit.
- R944-02 / CPO10 missing server publication regression: source coverage gap CLOSED. Both EMAIL and MESSENGER exercise missing/not-found/foreign/wrong-case recipients, four non-granted consent states, NONE/mismatched channel and missing contact: 22 negative API attempts with intended422 message and no-write snapshots. Positive publication, stable replay and changed-recipient409 remain explicit. No real outreach/provider certification is claimed.
- Earlier new-test P2 missing-contact setup: CLOSED. Canonical valid party creation precedes an explicitly isolated stored-contact-null injection. Granted consent, matching channel and null contact are asserted before publication. No production guard bypass or timeout increase.
- Earlier new-test snapshot gap: CLOSED. Client decisions, client links, presentation sessions, organization projection receipts and parties/roles are now included alongside quotes/versions/lines/Case/events/tasks/audits.
- Login diagnostic P2: CLOSED. PASSWORD status is emitted before JSON parsing; only status and fixed phase are printed. Bodies/passwords/MFA/cookies are not logged by this addition.
- R944-03 authoritative evidence rebinding: OPEN P2 readiness item. `mission.yaml`, `test-results.json`, `human-signoffs.json`, and `review.md` still identify c0567/PR34/old CI/old Preview. Their historical PASS fields are not PR36/921 evidence. Preserve history and human PENDING; create current source/CI/Preview/review bindings only from actual final results. The working checkpoint does not replace the authoritative packet.

## Incremental Source Review

- `tests/integration/m3PolicyActivation.itest.ts`: only ten wrong-password attempts override verifier outcome. Both persistent SQL rate limiters and their actual60-second window remain real; count10 verifier assertion, ten401/no-cookie results, eleventh real POST429/no-cookie and persisted count11 remain. Later password/MFA/TOTP/Finance checks are unchanged. No Node clock freeze, security parameter change, new product hook or transaction deadline change.
- `tests/e2e/localClientIdentity.mjs`: stable per-context documentation IPv6 identity, separate per factory/session, only bare HTTP localhost/127.0.0.1. Deployed Preview/Production requests receive no synthetic identity header. Exhaustion rejects instead of reusing identities.
- `tests/e2e/cpo-repair.mjs`: context header wiring preserves the existing protection-bypass header; original authentication, MFA, permission, business and cleanup assertions remain. Both login phases have status-only diagnostics.
- `tests/localClientIdentity.test.ts`: valid unique documentation IPv6 assertions and Preview/Production/lookalike/credentials/path/query/hash rejection. The final committed addition of an explicit string assertion strengthens the previously inspected test.
- Finance and commercial test blobs exactly match the independently reviewed frozen worktree patch `/tmp/td-cpo09-cpo10-944.patch`. Existing test assertions are not deleted or relaxed; the only removed finance line is replaced import wiring.
- Latest checkpoint records the subsequent browser scope and six new PG successes while retaining the failed full runs, unchanged deadlines, unknown CI failure status and unproven host-load causation. It explicitly limits historical944 Preview proof to that source. Human PENDING, existing CPO-only restriction, NOX exclusion and M4 NOT_STARTED remain.

## Reviewed Committed Blobs

| Path | Git Blob |
| --- | --- |
| tests/integration/cpoAuditFinance.itest.ts | 72b083a6ce2bb8e926d02b76b1ec685f91e14670 |
| tests/integration/commercialQuotes.itest.ts | 8b71f3570bcec5fcb5fe5e8307998be738fd2452 |
| tests/integration/m3PolicyActivation.itest.ts | 90f2172ac0136be5fb9e475bef9894bd78690ae4 |
| tests/e2e/cpo-repair.mjs | 440d3677d30e7d2be00d94fe8a99d0947a5275bf |
| tests/e2e/localClientIdentity.mjs | 609144875d95915e1b34b5ca9db34c60a18485c4 |
| tests/localClientIdentity.test.ts | af6c7cbae0e8f6c8ddc0e80f3285b1b5ec41dfa0 |
| docs/evidence/missions/M3/cpo-audit-repair-20261013.md | 983f1e84dab6e138eff6ed2a0ce94109b676d421 |

## Independent Checks And Evidence Limits

- Cumulative base-to-HEAD diff whitespace check: exit0.
- Independently executed on exact921: `node --import tsx --test tests/localClientIdentity.test.ts`, 2/2 PASS, zero failures/skips, exit0. No other current suite duplicated.
- Exact seven-path increment and clean HEAD: independently asserted from Git.
- Full no-rename4ec-to-921 changed-path set exactly matches all18 literal restore-helper allowlist entries. The only documentation entry is the reviewed checkpoint; no docs wildcard. Fixture factories, Prisma/schema/migrations and lockfile are excluded from that change set.
- Previously independently executed at944: 144 focused domain/auth/money/document/boundary/namespace/harness unit checks, zero skips. These are historical focused checks, not rerun full921 gates. Earlier identity tests and additional URL/factory/IPv6/exhaustion probes passed; source-guard/receipt-preservation probes used extracted functions and in-memory stubs, never imported operator helpers or read credentials.
- Independent actual local auth-budget reproduction completed:200 -> original owned IP429/count11 -> distinct documentation IPv6200 -> original429/count12; reset unchanged, blocked attempts do not increment account bucket, no cookie on denial; logout/server stop/owned-schema absence passed. Receipt `cpo-local-auth-budget-UpP85X/receipt.json` under the user's temporary directory. Existing build provenance is attributed4ec, with unchanged auth sources through944; not a fresh full-runtime build or proof of original CI response status.
- Implementer receipt `/tmp/td-cpo09-cpo10-pg-review-944.md` inspected: six new tests PASS; corrected two-file total18/19 FAIL, zero skips. CPO24 failed during initial publication before concurrent decision assertions at6553ms versus unchanged5000ms deadline. Host load is not proven causation. All four named run schemas reported absent. Reviewer did not rerun PG.
- Main reports browser rework scope PASS and cleanup PASS on the prior frozen working tree. This is not independently repeated browser execution, a final full unit/PG gate, deployed921 UAT, or exact-head CI.
- Canonical normal-concurrency PG execution is currently owned by main; outcome PENDING here. Earlier154/157 and later18/19 failures are not waived. No heavy parallel suite, build or browser was launched by reviewer.

## External Helper Scope

- Restore helper reviewed SHA256: `08722a1ab6882eb3fa892bf5c2e488ef9fb35c3f8aedf8654f38600d152eca52`.
- UAT helper reviewed SHA256: `9201e77162e0c2f3a371e4b8a69448741c15c2c5f6d52fc2aa75e192640d8bc1`.
- Scoped fresh/bind/uat guard findings are closed: exact runtime argument/clean source, full-tree no-rename literal allowlist, fresh absent owned schemas, local-only synthetic fixture creation, atomic remote restore, strict UTC53-table comparison/no-op/parity, stale runtimeBinding removed, unique sentinel authentication and logout, strict UAT binding, pre-API/final-publication exact-source checks, unique durable attempt receipts and archive-before-success-only canonical replacement.
- Legacy prepare/extend modes and Production release helpers are not cleared by these fresh/bind/uat source findings. No operator helper executed by reviewer. Source compatibility for921 is not execution success or release authorization.
- Historical944 UAT/restore receipts must remain archived and SHA-bound; fresh921 Preview verification must not relabel them.

## Remaining Gates And Policy Boundaries

- Final normal-concurrency canonical gate, complete exact-source CI, fresh exact-candidate authenticated Preview binding/UAT, authoritative evidence synchronization/validation and checked owner-terminal handoff remain required.
- Real scanner remains external/unconfigured; synthetic CLEAN fixtures and503 fail-closed behavior are not malware-provider readiness. Human Finance/Accounting, Legal/Privacy and Ritual SME verdicts remain PENDING. Broad rollout remains closed; only the existing restricted synthetic CPO organization is in scope.
- Historical Production credential denial in `cpo-release-preflight-20260928.md:33` is not rerouted through new files/helpers or alternate credentials. No new Production provisioning, real MFA extraction or agent Production write execution. Write-capable frozen Production backup/migration/release operations require the checked owner-terminal procedure; owner authorization does not override policy. This is not a declaration that all technical work is complete or that access is the sole remaining blocker.
- Fresh frozen875 rollback deployment and additive-migration rollback semantics still require qualification. Old-runtime document uploads intentionally fail closed after trigger repair; retain freeze rather than destructively reverse immutable history. Legacy PR32 `release.mjs` remains unusable for PR36.

Reviewer actions in this continuation: repository/source/receipt reads, lightweight Git assertions and one focused identity unit file only; this external receipt is the only authored file. No source edits, credential/Keychain/archive reads, DB/network/SSH/Production operations, new helper execution or gate collision.
