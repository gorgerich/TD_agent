---
schema: m3-independent-review-v1
reviewed_sha: 18e130990264813bde61ce7bc3b55aecec4d7d6c
reviewer: independent final release reviewer (Codex)
verdict: BLOCKED_SAFETY
p0: 0
p1: 1
p2: 2
---
# Independent M3 final release audit, 2026-10-03

This review applies to exactly `18e130990264813bde61ce7bc3b55aecec4d7d6c`, against main `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`. HEAD matched the requested SHA and the working tree was clean before review. The baseline diff contains 167 changed files, 21,471 insertions and 1,320 deletions. The reviewer inspected actual changed source and evidence, including the subsequent delta from Gibbs's `e98cdbc613321e7c35e65c141dca7edfd20565a1`; the earlier Gibbs, Mendel and reported Epicurus verdicts are not substituted for this review.

No P0 was identified. One P1 blocks technical release approval, including the closed CPO candidate, until repaired and independently verified. Two P2 findings remain. This is not PASS and is not full-rollout authorization. The owner's authorization is for a synthetic CPO-only release; Finance/Accounting, Legal/Privacy and Ritual Operations SME verdicts remain pending.

## P1: Finance can discard an uncertain committed command and append the same payment again

Primary locations: `app/agent/(app)/finance/FinanceClient.tsx:291` and `:297`. Supporting locations: `:118`, `:179`, `:369`, `:404`, `:427`, `:429`, `:439`; `lib/contractLedgerService.ts:484` and `:542`.

Finance stores its idempotency envelope only in the open action dialog. Cancel, the close control, Escape and a backdrop click clear that dialog, including while a request is in flight. Opening the payment action again always generates a fresh UUID and occurrence time. A lost HTTP response therefore permits the operator to abandon the uncertain command and submit the same confirmed payment under a new key. The API deduplicates by key, not by evidence reference; the second key authorizes another PAYMENT entry. The server intentionally supports overpayment, so the outstanding balance is not a duplicate-payment safeguard.

There is also a deterministic post-commit failure path: `recordManualPayment` commits the ledger transaction before awaiting `advanceObligationCaseAfterCommit`. Projection contention can return 503 `CASE_PROJECTION_RETRY` after persistence. Finance's `post` discards the response code and treats every non-2xx as a generic failure; unlike the document-review and Case projection clients, it does not retain a recovery envelope or lock destructive controls. Closing and reopening after this response loses the only retry identity.

Reproduction sequence derived from source: submit a valid manual payment; let the server commit but lose the response, or return the post-commit projection 503; close the still-open payment dialog; reopen it and enter the same amount and receipt. The new envelope is not a replay, and another immutable credit is allowed. An in-flight close/reopen is a second route to the same outcome. This is a source-traced finding, not a newly executed browser/database reproduction.

The existing browser regression at `tests/e2e/m3-fulfilment.mjs:351` tests a lost response followed by retry inside the same dialog. It proves that narrower path, not close/reopen safety. The recovery-contract test at `tests/m3RecoveryContracts.test.ts:87` does not cover FinanceClient.

Required repair: preserve the exact key and serialized payload for uncertain and confirmed-commit responses; distinguish saved-but-unsynchronized from not saved; prevent abandoning or replacing the recovery command before authoritative reconciliation; protect dialog close while submitting. Add isolated browser regressions for post-commit 503, lost response followed by every close mechanism, and close during an in-flight request. Assert one ledger entry and unchanged command identity. Owner: M3 product engineering. Required before release; no risk acceptance was supplied for this finding.

## P2: Finance Case-payment reads still apply agent ownership

Location: `lib/m3Api.ts:13`, called by `app/api/agent/cases/[caseId]/payments/route.ts:26`.

The GET route admits FINANCE, but `canonicalCaseIdFromLead` applies ownerId to every role except MANAGER and ADMIN. The Finance identities normally do not own the agent's Case, so a valid same-organization Case-payment read returns 404 despite the downstream ledger read allowing organization-scoped Finance. This corroborates the prior documented P2, not a tenant leak. Fix the role-specific read scope and test own, other-agent same-tenant, and foreign-tenant Cases. Existing owner: M3 product engineering; existing target: 2026-10-04 before broad rollout.

## P2: Payment webhook accepts amounts outside the stored ledger range

Location: `app/api/webhooks/m3/payments/[provider]/route.ts:16`; supporting `lib/contractLedgerService.ts:1012` and `prisma/migrations/20260811172829_m3_fulfilment_money_trust/migration.sql:317`.

The webhook schema accepts positive integers through Number.MAX_SAFE_INTEGER, and the service checks only safe-integer positivity. PaymentLedgerEntry.amountKopecks is PostgreSQL INTEGER. A correctly signed, tenant-valid event for 2,147,483,648 kopecks passes these checks but cannot be inserted; it reaches the generic error path instead of a controlled input rejection. Transaction rollback prevents a partial receipt/ledger commit, so this is not amount corruption. It can cause repeated provider retries and prevent recording that event. The manual Finance routes and displayed-ruble parser already enforce 2,147,483,647. Apply the same bound at webhook and shared service boundaries and test that invalid amounts produce 4xx without a write. Owner: M3 product engineering; resolve before enabling real provider traffic.

## Reviewed safety boundaries

The M3 capability guard in `lib/operationalAuth.ts:125` covers party management, document upload/review, contract management and Finance writes. Production runtime checks restrict these operations to the exact CPO organization; webhook and ledger authorization additionally call the allowlist directly. Preview approval compares pooled and direct fingerprints and the expected branch, with a separate narrowly constrained CI path. This is an M3 mutation boundary, not a promise that all legacy operational writes are CPO-only. Release freeze remains a separate deployment requirement.

Document upload uses private storage, opaque keys and non-overwrite writes. Scan exceptions or an unconfigured scanner produce quarantined versions. Review and download require CLEAN, and verification/download check etag, size, MIME and checksum against stored identity. Reviewer download is restricted to assigned IN_REVIEW versions; Finance lacks document and party capabilities. The production scanner implementation is fail-closed and no real scanner adapter is supplied in this tree. Consequently a Production CPO demonstration cannot be claimed to complete upload-to-verification with the current scanner; Preview's synthetic scan success is not Production lifecycle evidence.

Finance workspace selects obligation, contract, ledger and approval fields rather than family notes, document bodies or quote margin. API reads/writes require Finance MFA; the app layout redirects Finance without MFA. Case pages deny non-core roles. No additional P0/P1 tenant/Finance disclosure was identified in inspected paths. This is not an exhaustive proof over every legacy endpoint.

Only the new M3 migration is added relative to main; no earlier migration file is modified. Its SHA-256 is `270c36a7aebd3ccf0604f87331d83865e6367e9806c27142e5a9d0d996366480`, matching the recorded rehearsal. Static inspection confirms ledger and audit update/delete guards, immutable obligations, protected document/contract identities, same-transaction lifecycle/ledger authorization and tenant/role checks. Historical migration compatibility and actual PostgreSQL triggers were not re-executed by this reviewer.

Retention uses database statement time, bounded transactions, FOR UPDATE SKIP LOCKED and an expiry recheck. Renewal and deletion serialize on the row; active renewed counters are not deliberately removed. A separately committed cadence lease preserves backoff after cleanup failure. The new delta handles only PostgreSQL lock contention 55P03 as a lost claim and rethrows other errors. The protected cron endpoint checks a strong secret and freeze state. Concurrent renewal/worker tests were read, not run against a database in this audit. A short batch with skipped locked rows does not certify an empty backlog; the returned budget flag reports budget exhaustion only.

The CPO provisioner was reviewed statically and was not executed. It pins the production target fingerprint or explicit Unix-socket rehearsal target, checks migration completion, refuses unexpected fixture/account state, validates passwords without printing them and creates the fixture transactionally. Replay verifies active role identities, absence of other memberships and canonical policy contents. It does not grant human policy approval: its policies are explicitly synthetic. Local credential file read uses lstat then readFile rather than the existing single-handle secure reader; no hostile-local-operator exploit or additional release-severity finding is asserted here.

## Evidence and checks

The complete unit suite passed locally: 137 tests, 137 passed, 0 failed, 0 skipped. A preceding focused run passed 33/33, skipped 0. These runs used the bundled Node executable because node was absent from the shell PATH. No application environment files or credentials were read. No integration suite, fixture seeding, migration, provisioner, build server or Production operation was run.

The mission validator exited 1. It reports that implementationSha `e98cdbc613321e7c35e65c141dca7edfd20565a1` has source changes relative to HEAD. Its built-in GitHub CI lookup also failed to connect; that attempted read did not establish remote CI status. No follow-up remote probe was made. The packet cannot be taken as exact-head certification: release.md still names e98, and the preflight cites df18 before the operational changes. This evidence mismatch and unavailable exact-head CI remain release gates, independent of the P1 above. This supplemental blocked review does not replace review.md or relabel historical evidence.

The retained E2E source and screenshots were inspected; the Finance mobile image shows historical UI, not a fresh execution of this SHA. The applicable design instructions were rechecked against the inspected UI source and image: readable default content, gutters, fit, centering, controls, failure truth and recovery. Existing pills, borders and paired actions remain design-law deviations; no design compliance PASS is claimed. No UI implementation was changed. Fresh pointer interactions, keyboard, mobile, zoom, clipping and every visual-rule check require isolated browser execution; screenshot inspection alone cannot prove them. In particular the P1 failure/recovery path must be added to that execution.

## Limitations and release decision

This is a full release-scope audit with targeted source tracing, not a claim of line-by-line exhaustive coverage of all 21,471 added lines. Actual diff inspection focused on the requested high-risk server, documents, ledger/webhook, roles, history, retention, CPO and UI truth boundaries. Supplied evidence claims were read critically but remote CI/deployment, the reported separate Mendel/Epicurus reviews, and historical authenticated UAT were not independently revalidated. No production data, secrets, external backups or retained restore clone were accessed.

Before any permitted CPO-only release: repair the P1; obtain independent review and green exact-source CI/evidence; prove protected merge and the final freeze, isolation, fresh encrypted backup/isolated restore, additive migration/rollback and approved provisioning execution gates. The preflight's absent Production CRON_SECRET is a recorded prerequisite, not current independently verified metadata. Real uploaded document verification remains unavailable without a real scanner. Do not infer completion of these gates from the old Preview run or local unit results.

Human verdicts remain pending and full agent rollout remains blocked regardless of eventual technical clearance. This audit changed only this evidence artifact. No other files were edited, and no commit, push, merge or deployment was performed.
