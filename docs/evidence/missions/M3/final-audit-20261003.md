# Final M3 candidate audit, 2026-10-03

Source: `ced3fad0fee5e5018bf4dab93cf87f644c0e4a3f`.
Protected Preview: `dpl_Fo28yhKy4XrW4uvVwGGcZ9cE12y5`.
Source CI: `37116487974`; technical steps PASS, overall failure only at stale
evidence. Evidence-head CI remains a distinct required check.

## Problem mapping

| Symptom | Root cause and current repair | Regression / Preview proof | Production proof |
| --- | --- | --- | --- |
| Uploaded document could imply readiness; public legacy URL | Canonical requirements require latest clean VERIFIED version; private authorized access, revocation and access audit. Present at final source. | M3 integration, quarantine/rejection/replacement/expired/access negatives; both fresh Preview scenarios PASS. | NOT_RELEASED; production unchanged. Real scanner unavailable remains fail-closed. |
| Manual payment status or destructive history | Immutable contract obligation and append-only ledger drive status and guards, not Order status. | 176000/88000 gives PARTIALLY_PAID, balance 88000; refund/reversal and reconciliation PASS. | NOT_RELEASED. |
| Ambiguous financial input and oversized webhook amount | Exact decimal parser; API/service minor-unit Int bounds. Parser/webhook repair `a4f7d6c`; additional range guard `429b6ab`. | Raw input regression, signed oversized API 400/service 422 with unchanged ledger count; valid full/partial flow PASS. | NOT_RELEASED. |
| Legacy commission webhook fail-open / gross commission | Secret authorization precedes reads; no verified contractual margin means no Commission. Repairs `a4f7d6c`, `cc574b4`, `42901ef`. | API/integration auth, replay/concurrency, unknown-base and Int-range negative tests PASS in source CI. | NOT_RELEASED; no invented commission policy. |
| One checklist or unconditional unapproved legal requirements | Versioned scenario/conditional rules, DRAFT_POLICY boundary and explicit applicability. | Distinct cremation/family-plot policies and activation/materialization/concurrency tests; fresh Preview PASS. | NOT_RELEASED; human rules are not professionally approved. |
| Case/Quote/Contract screens contradict each other | Canonical projections separate active draft, immutable published/signed truth and ledger balance. Repair `0c54170`. | Legacy pointer tests, guard/projection regressions, both fresh Preview journeys PASS. | NOT_RELEASED; original real Case 52 not mutated or freshly reproduced. |
| Payment counter hidden by urgent bucket | Financial count independent of priority bucket; explicit canonical stage truth. Repair present at `0c54170`. | Case worklist unit regressions and source CI PASS. | NOT_RELEASED. |
| Finance close/reopen could repeat committed payment | Exact serialized command retained through uncertain transport/5xx, invalid acknowledgements and post-commit recovery; synchronous lock and guarded dismissal. Repair `429b6ab`. | Targeted repeat 5/5; actual committed-payment lost response and controlled post-commit 503 replay same ID/key/body, one ledger entry. | NOT_RELEASED. |
| Duplicate error alerts | Page alert hidden while the same error appears in the active dialog. Repair `ced3fad`. | Single-alert regression 5/5 and final CI/Preview E2E PASS. | NOT_RELEASED. |
| Login bucket retention operational debt | Bounded expiry cleanup, concurrent renewal protection, protected schedule plus login cadence. | Retention 12-test concurrency suite x5 in final source CI; real Production schedule not enabled yet. | NOT_RELEASED; Production-only CRON_SECRET absent in last preflight. |

## Actual coverage and limits

Unit: 143; canonical PostgreSQL integration: 73 tests / 14 files. No test skips.
All five source-CI E2E scripts passed. Remote Preview tested Agent, Manager,
Finance and Reviewer, both scenarios, private document access, obligation,
partial/full/refund/reversal, four-eyes, webhook x5, guards, cross-tenant denial,
failure recovery, keyboard, mobile and 200% equivalent viewport. Reconciliation
and unexpected 5xx were zero; axe critical/serious findings were zero.

Independent cumulative source review: P0=0, P1=0, P2=1. It combines the baseline
full-scope review and all subsequent repair diffs; its limits are stated in
review.md, not represented as an exhaustive proof of every legacy line.

The original 45-point HTML audit was unavailable locally. No claim is made that
all 45 original points have been remapped. Existing screenshot assets are
historical, not final-SHA captures. Mobile workspace checks do not prove every
possible mobile dialog/recovery state. Local Turbopack build was blocked by
worker port permissions; optional webpack fallback failed on a node:crypto
client import. Canonical exact-source CI and Vercel builds passed.

## Release boundary

No merge, Production migration, environment change, write smoke or deployment
was performed. Production metadata remains `dpl_AkdiVtTqDjsvnX4nS3k4yKbez61g`
at `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`. A prior sandbox denial of the
Production-credential/write-capable CPO provisioning path is not bypassed.

The owner authorized only a controlled CPO synthetic release, not broad rollout.
Finance/Legal/Privacy/Ritual verdicts remain pending. The open Finance Case-detail
P2 is owned by M3 engineering, due 2026-10-04 before broad rollout. Real malware
scanning, fresh frozen release backup/restore and permitted Production execution
remain prerequisites, not Preview PASS claims. M4 is NOT_STARTED.
