---
schema: m3-independent-review-v1
reviewed_sha: ced3fad0fee5e5018bf4dab93cf87f644c0e4a3f
reviewer: independent cumulative M3 source reviewer (Codex)
verdict: PASS
p0: 0
p1: 0
p2: 1
---
# Independent exact-SHA repair review, 2026-10-03

Reviewed exact source `ced3fad0fee5e5018bf4dab93cf87f644c0e4a3f`, combining the full-release-scope review of `18e130990264813bde61ce7bc3b55aecec4d7d6c` in final-review-20261003.md with inspection of the complete subsequent repair diff, the harness fix at `0c3659ffef1a9f5a07929082982157477155dae6`, and the latest two-file alert/regression patch. All changes since 18e are confined to eight files: FinanceClient, payment webhook route, shared recovery helper, ledger service, amount parser, M3 E2E, M3 integration and recovery-contract tests. HEAD was independently verified and tracked source was clean.

Cumulative source findings at this exact SHA: P0=0, P1=0, P2=1. The original Finance close/reopen P1, webhook range P2, durability downgrade and injected-503 harness P2 are resolved in inspected source. The single remaining P2 is the carried Finance Case-payment read ownership restriction described below. The front-matter PASS means independent technical source review only. It does not certify CI, full integration, Preview UAT, Production preflight or release authorization.

## Resolved: Injected post-commit 503 accounting

Locations: `tests/e2e/m3-fulfilment.mjs:62`, `:68`, `:153` and `:373`.

The intercepted payment must really return 201 before the test adds that exact route request to injectedProjectionFailures and fulfills the controlled 503. The response listener excludes only status 503 with a matching request object; deletion consumes the marker and increments an observed count. Final assertions require exactly one observed injection, no outstanding markers and no unexpected5xx. Other payment 503s, 500s and a second 503 for the already consumed request remain failures. The final assertion has not been weakened to permit real payment failures.

An independent local contract check executed the actual extracted final response listener with one marked 503, an unrelated 503, a 500 and a repeated 503 for the consumed request. Observed injection count was 1, remaining marker count 0, and the latter three responses were recorded as unexpected. This is a deterministic listener check, not a browser E2E PASS. An attempted completely intercepted localhost-only Playwright check could not launch Chromium: the local headless process exited with SIGTRAP. No application or Production request was made by that attempt. Actual browser request-object identity and event timing remain to be confirmed by the new E2E run; a mismatch fails closed through the count/set assertions rather than hiding a failure.

The source-level harness P2 is closed at 0c3659f. Successful full execution remains a validation gate, not a claimed result of this source review.

## Finance repair assessment

Finance now retains the serialized request body, path, idempotency key, correlation ID and timestamp for transport failures, 5xx and unreadable or structurally invalid successful acknowledgements. The acknowledgement requires a nonempty ledgerEntryId and boolean replayed, matching the payment, refund, adjustment and approval service result contracts. Invalid JSON no longer silently closes the dialog and loses its recovery identity.

The synchronous mutation ref prevents duplicate submits and retries before React rerenders. Dialog close, Cancel, Escape and backdrop dismissal are guarded during submission and recovery; replacement actions are refused and inputs are disabled. Recovery retry reuses the retained envelope rather than collecting edited form values. Its button sits outside the disabled fieldset. The original in-dialog close/reopen P1 is addressed in the inspected implementation.

Shared recovery helpers preserve CONFIRMED_COMMIT through subsequent transport failures and generic 5xx. The sequential regression covers confirmed 503, transport failure, 502, invalid 201 acknowledgement, then valid replay, asserting identical requests throughout. This resolves the previously reported durability downgrade. These guarantees are component-lifetime guarantees; no persistence across browser reload, tab closure or remount is implemented or certified.

The E2E additions exercise post-commit-style 503 for cremation and lost response for burial, each after a real successful server payment. They assert disabled close/Cancel/input, Escape refusal, exact path/body/header replay, replayed=true and the same ledgerEntryId. The injected 503 proves client reaction after a real commit, not actual server projection contention. Backdrop and in-flight dismissal are covered by inspected guards/static tests rather than new browser clicks. Runtime dialog fit, focus transitions and recovery on mobile were not independently exercised in this review.

## Webhook amount repair assessment

MAX_LEDGER_AMOUNT_KOPECKS is 2,147,483,647. The webhook route rejects values above it with schema validation before calling the service. The webhook service and common manual-ledger validator independently enforce safe-integer positivity and the same upper bound before transaction work. The ruble parser retains exact BigInt conversion. No amount rounding or coercion regression was found.

The new integration assertions use correctly signed values of 2,147,483,648 and Number.MAX_SAFE_INTEGER, expect route 400 and direct-service 422, then check unchanged obligation ledger count. Their source was reviewed, but this reviewer did not execute the database suite. No synthetic provider receipt can be created through the inspected oversized-value path because the service rejection precedes the transaction. A valid maximum-bound webhook insert is not specifically added by this diff; existing amount-parser boundary tests are not a substitute for a database boundary test.

## Latest patch: One visible Finance alert

The complete 0c3659f-to-ced3fad diff changes only FinanceClient and its recovery-contract test. At `app/agent/(app)/finance/FinanceClient.tsx:283`, the page alert now requires error and neither actionState nor approvalState. The existing modal commandFeedback still renders its alert, so an active action or approval dialog has one error location rather than both modal and page alerts. When neither modal is active, the page error is not suppressed. Recovery state, request identity, acknowledgement validation, mutation locks and webhook validation are unchanged.

The added regression at `tests/m3RecoveryContracts.test.ts:20` checks both alert conditions, verifies feedback is supplied to each modal, and tests zero/one visible alert with no modal, action modal and approval modal. The mutual-exclusion action-opening handlers were checked against those assumptions. No new actionable defect was identified. This is source/contract validation; it does not independently establish a fresh browser E2E PASS or the outcome of the reported CI failure.

## Independent checks

At exact ced3fad, the independently executed m3RecoveryContracts and financeAmount tests passed: 12 tests, 12 passed, 0 failed, 0 skipped. This is one independent run, not a claim to have repeated the owner's five runs. The complete latest patch passed diff whitespace checking.

Historical independent checks remain bound to their sources: at 0c3659f, m3RecoveryContracts, financeAmount and m3Domain passed 30/30, skipped 0, and no-emit/non-incremental typecheck completed successfully; E2E syntax and repair diff whitespace checks passed. At 429b6ab, the full unit suite passed 142/142, skipped 0. Full unit suite and typecheck were not independently rerun for ced3fad and are not relabeled as exact-ced3fad checks. Unit assertions that extract/transpile client functions were treated as contract tests, not as proof of browser behavior.

No integration runner, fixture seed, migration, build server, Production endpoint or secret was accessed by this reviewer. The owner's integration/CI work and preparation of a clean Railway Preview namespace are not completed evidence for this latest source in this report. Fresh Preview UAT on the prior 18e commit was reported by the owner and remains bound to that prior SHA; it does not certify ced3fad. No fresh UAT for ced3fad has been established here. No full Preview PASS, exact-head CI PASS or rollout PASS is claimed.

## Open P2: Finance Case-payment read ownership restriction

Location: `lib/m3Api.ts:13`, used by `app/api/agent/cases/[caseId]/payments/route.ts:26`. FINANCE is admitted by the GET route but is not classified as team operational scope, so canonicalCaseIdFromLead adds ownerId for that role. Same-tenant Cases owned by an agent can return 404 to Finance despite the downstream organization-scoped ledger read. This is a read-availability defect, not tenant disclosure. It is unchanged by the repairs and remains the sole cumulative P2.

Owner: M3 product engineering. Existing target: 2026-10-04, before broad rollout. Existing deferral rationale: closed CPO uses the synthetic assigned Case and organization Finance workspace; correction needs role-specific own/other-agent/foreign-tenant read regressions. No new waiver or broad-rollout approval is supplied by this report.

## Release boundary

The cumulative source review identifies no remaining P0/P1 at ced3fad. This supersedes the earlier repair-only BLOCKED_VALIDATION finding for the harness, without rewriting historical reports or upgrading their run results. Full-release-scope baseline limitations still apply: targeted high-risk source tracing is not an exhaustive proof over every legacy endpoint or every added line, and historical remote evidence was not independently revalidated.

Historical reviewer context at source-review completion: exact-head CI, full integration and fresh authenticated Preview UAT were not independently established by this reviewer. Subsequent implementer results are recorded separately in test-results.json and ux-uat.md; they are not retroactively attributed to the reviewer. Evidence-head CI and Production preflight remain release gates.

The CPO-only authorization remains the release ceiling. Finance/Accounting, Legal/Privacy and Ritual SME verdicts remain pending; full agent rollout is not authorized. Production scanner availability and preflight limitations from the baseline report remain separate and were not revalidated here. Provenance: this report was copied from the independent cumulative report review429b6ab.md, whose historical filename is retained; reviewed_sha above is authoritative. The reviewer did not commit, push, merge or deploy.
