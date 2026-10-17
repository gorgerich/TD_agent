# Independent Source Review Continuation

Recorded 2026-10-17. Source review only, not release acceptance, CI/UAT PASS or human approval.

## Binding And Scope

- Current exact HEAD: `b0b2d784e89c91211ff4b3df0d5bb7cd150f38a4`; clean tree independently confirmed.
- Increment: `92169538d6a8df600e52d1e93102dc0ef82924a7` to current HEAD, five files: checkpoint, CPO browser secret-policy tests, auth-infrastructure harness, local identity JSDoc, M3 fulfilment claim instrumentation.
- Read complete increment and complete current auth-infrastructure harness; inspected current DB inspector without importing/executing it.
- No app/lib/prisma/migration/dependency/lockfile/workflow/script changes in this increment. Carry-forward source reviews remain `independent-source-review-94401515.md` and `independent-source-review-92169538.md`; this is not a fresh reread of every cumulative path.

## Source Verdict

No newly established P0/P1/P2 in the inspected five-file increment. No prior gate failure is waived.

- Auth diagnostics allow only fixed stage names, allowlisted numeric HTTP statuses and approved source basenames with bounded numeric line/column. Raw messages, full paths, headers, causes, credentials and MFA material are discarded, including throwing stack getters.
- Exported preflight preserves existing local-target, explicit fixture opt-in/provenance, database fingerprint/schema and protected-input validation. Importing the harness no longer launches the browser or servers; the direct-CLI guard preserves actual execution failure/nonzero semantics.
- Synthetic client headers are one stable per-context identity and remain bare-HTTP-loopback-only. Header separation is tested through the actual clientIp and persistentRateLimitKey functions without DB work. Product login/limiter policy is unchanged.
- Original unavailable UI, API503/retry, secure cookie, keyboard retry, mobile/effective195px accessibility and real restored-configuration UI assertions are retained. Cleanup errors now pass through sanitized diagnostics and set nonzero exit status. The success JSON precedes finally cleanup, so consumers must continue requiring successful process exit; the reviewed operator UAT child does so.
- M3 claim instrumentation retains the original assigned-label wait and viewer assertions, adds status200/exact URL-version acknowledgement/boolean replay assertions, and rethrows UI confirmation failure after numeric-only diagnostics. No timeout increase, fallback reload or substitution of DB/HTTP truth for rendered assignment.
- JSDoc changes affect typing only.
- Checkpoint candidly records historical921 local unit254/PG163 results, failed CI auth stage and failed Preview replacement-assignment UI. The existing compatible-build local auth diagnostic is not relabelled as current deployed UAT. Root cause remains unproven. Owner command remains explicitly NOT_CLEARED.

## Inspector P2 Closure

`cpo-repair-preview-inspect.mjs` SHA256:
`1d2945c8f2fa62c38321754b80aa99feef38eecc38cc031d91ef47024ae4fac5`.

The --document-review-state branch now requires exact source921, operation `6ff9abe0c88dc772e007d745be4c9033`, deployment `dpl_72HYZ7u4cg4U94GF6f3FqXMnAxZG`, current schema and AUTHENTICATED_UNIQUE_SYNTHETIC_SENTINEL binding. These assertions precede scoped membership/document/audit queries; the read-only connection identity query occurs earlier. Fingerprint545, non-Production fingerprint, schema match and actual transaction_read_only=on checks remain. Output includes SHA/operation/deployment bindings. Positive and six mismatch probes executed against extracted assertions with synthetic objects only. Earlier exact-evidence attribution P2 CLOSED for this branch; it remains intentionally pinned to921, not b0.

## Fresh Restore Helper Compatibility

Reviewed helper SHA256:
`e28dfd09f76c797cc6a1331da7d277c215ec486618f9a58797b144f0409c7601`.

- Sole change from previously reviewed08722a1 helper is the one literal `tests/e2e/m3-fulfilment.mjs` allowlist entry. Removing that line reproduces the previous helper hash exactly.
- Independently asserted exact set equality: all19 allowed paths equal the full `git diff --no-renames --name-only -z 4ec9108cd9876f3583e7addf6fb8cfd726a5cbc0 b0b2d784e89c91211ff4b3df0d5bb7cd150f38a4` path set.
- No factory/schema/migration/lockfile or auth-runtime change; no docs/test wildcard. The reviewed Parties read-DTO/package component-test exceptions remain the earlier explicit exceptions.
- Prior fresh/target/ownership/UTC53-table/no-op/parity/recovery/journal/cleanup/history-preservation guards are byte-identical. Scoped source compatibility for `--fresh b0b2d784e89c91211ff4b3df0d5bb7cd150f38a4` is cleared at this exact helper hash and clean source, not a claim of execution success, CI acceptance or Production authority. No fresh helper executed by reviewer.

## Actual Independent Checks

- `node --import tsx --test tests/cpoBrowserSecretPolicy.test.ts tests/localClientIdentity.test.ts`:13/13 PASS, zero failures/skips, exit0. Pure checks and rejecting preflight subprocesses only; no actual browser/DB suite launched.
- Incremental diff whitespace check passed. Syntax checks passed for current auth harness, M3 fulfilment harness, DB inspector and restore helper.
- Exact19-path parity, sole-line helper change, factory/schema/lock exclusion and inspector mismatch checks passed without credentials or network.
- Read-only GitHub status query: Quality run38966224443 associated with exact b0 was in_progress at inspection. This is not a completed CI result. No CI cause inferred from prior local success or source review.
- Step snapshot: 80ms intake deadline regression in_progress; Integration tests, End-to-end tests and Auth infrastructure failure and recovery browser regression pending. The current auth step has not produced an outcome at this checkpoint.

## Open Gates And Boundaries

- Authoritative evidence rebinding remains open from R944-03; the truthful checkpoint is not the authoritative final packet.
- Exact-head complete CI and fresh exact-b0 authenticated Preview UAT/binding remain required. Historical921 UAT failed and is not relabelled. Remote reviewer-assignment rendering cause remains UNKNOWN.
- Owner findings OT-01..05 remain OPEN pending repaired-source review: verified frozen875 runtime rollback; terminal synthetic containment; allowed-effects census; complete canonical CI step list; login cookie ownership before malformed acknowledgement parsing. No owner command or APPROVED/operatorReview PASS artifact is authorized by this continuation.
- Real scanner readiness remains external; human Finance/Legal/Privacy/Ritual verdicts remain PENDING. Full rollout closed, existing restricted CPO-only scope, NOX excluded, M4 not started. Historical Production credential denial is not rerouted.

Reviewer actions: source reads, lightweight focused tests, extracted assertion probes and read-only GitHub CI metadata. This external receipt is the only authored file. No application edits, credentials/Keychain/archive access, DB/browser/operator-helper execution, SSH or Production operation.
