# Canonical Publication Command Boundary

## Confirmed P2

Read-only follow-up review of publication repair `b001ecaff3a9ab9e256f267776a004a2a808c94e` identified a pre-existing public-command gap. An owning Agent could send `quote.published.v1` or `quote.republished.v1` through the generic Case transition API with an owned DRAFT or LEGACY_INCOMPLETE QuoteVersion. Membership guards passed, advancing the workflow and completing a quote-send task without canonical immutable publication. The read model rejects the invalid pointer, and no financial or cross-tenant bypass was demonstrated; severity is P2, not a claimed P1 escalation.

A new authenticated PostgreSQL API regression reproduced HTTP200 where422 was required. Its first fixture attempt omitted a required task creator; that fixture error was fixed before the actual200-versus422 reproduction. No Production or native Preview mutation was used to reproduce the defect.

## Repair

After authentication, body validation and the existing capability check, the public generic route now rejects these two publication events with422 `CANONICAL_PUBLICATION_REQUIRED`. Canonical commercial publication still invokes the original internal transactional service and retains all domain, task, receipt and audit writes. No deadline, lock, permission, financial/document history or migration is changed. No UI caller of the generic publication events was found.

The full-chain and legacy membership positive fixtures now call the trusted internal transaction with explicit PUBLISHED versions. They no longer normalize an unpublished version as a successful public publication. Existing contract/acceptance and other transitions are unchanged by this narrow repair.

## Observed Checks

The affected canonical PostgreSQL subset passed20/20, skipped0: Case11, commercial publication idempotency3, commercial lifecycle6; all three isolated schemas removed. Four owner API negatives cover both events with DRAFT and LEGACY_INCOMPLETE at their valid starting stages and assert the exact error plus unchanged Case, quote/version, tasks, events, operational audits and projection receipts. Legacy meeting-based ownership, sibling-version denial, teammate/foreign-tenant denial, republish/replay and full Case chain remain covered. Canonical publish/replay, concurrency, immutable history and client-link tests still pass.

The affected browser program adds two authenticated generic-publication422 assertions while retaining its canonical publication/scenario guards. Fresh exact-source browser/CI execution is required, not inferred from b001's earlier native execution. Independent source review reports no P0/P1/P2 in this delta; that is not a GitHub approval or professional verdict.

Implementation was prepared in a separate detached TD Agent worktree while the b001 Preview run kept its source clean and unchanged. No result from that older run is renamed to this successor. Production and NOX remain untouched; real-agent rollout is still closed pending actual provider, operational and genuine human gates.
