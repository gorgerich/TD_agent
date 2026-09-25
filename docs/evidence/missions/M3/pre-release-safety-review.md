# M3 pre-release safety review

Historical status: **BLOCKED_SAFETY** on 2026-09-21. This is a pre-release finding, not the requested
post-deployment 45-item audit. Production remained unchanged.

## P1: financial amount input changes user intent

`FinanceClient` removes every non-digit character before sending a payment, refund or
adjustment. The same input boundary is shared by all three operations.

Reproduction from the exact source tree:

- `88000` -> 88,000 rubles (expected);
- `88000,50` -> 8,800,050 rubles;
- `88000.50` -> 8,800,050 rubles;
- `-88000` -> positive 88,000 rubles;
- `1e3` -> 13 rubles.

Every transformed value passes the current positive-integer check. The API correctly accepts
integer kopecks, but it cannot know that the client changed the operator's input before the
request. A Finance user can therefore append an immutable ledger entry for a materially wrong
amount. Idempotency preserves that wrong command; corrections preserve history but do not make
the original operator action safe.

Required repair: parse the displayed amount without deleting semantic characters, reject
ambiguous/negative/exponential input, convert exactly to minor units, and add unit plus browser
regressions for payments, refunds and adjustments. This repair is outside the owner's narrow
rate-limit-retention scope and the audit instruction forbids broad remediation during audit.

Containment: PR #32 is not merged; Production runtime, database and environment are unchanged.
The authorized M3 release must not continue until this P1 is repaired and the full affected
financial gate and independent review pass.

## Other release-readiness facts

- Production DB fingerprint: MATCH; read-only connection and ten completed migration records
  confirmed, incomplete migration records 0.
- Retained restore target is distinct from Production and writable, but contains 31 retained
  tables. It was not cleared. The same server role can create a separate disposable database,
  so a fresh non-destructive restore rehearsal remains feasible.
- Production `CRON_SECRET` metadata is absent. Scheduled retention cannot be called securely
  until a strong Production-only secret is configured as part of an authorized release window.
- Production document scanning remains fail-closed without a real malware scanner provider.
  This prevents unsafe verification but means real uploaded documents cannot complete the
  production review lifecycle. It is an explicit operational limitation, not a PASS.
- Finance, Legal/Privacy and Ritual SME verdicts remain PENDING under the recorded owner risk
  acceptance. No professional attestation is claimed.

## Narrow P1 repair update, 2026-09-23

- Candidate source: `42901ef3bf843fafd859acc9920f6008b9117f6b`, based on PR #32 head
  `2c573f1a511a042388f0d12a3001bfe2f3fb4f3f` before repair. No migration, schema,
  workflow, or Production configuration changed in the repair commits.
- Finance amount input now accepts only exact positive rubles with at most two decimal digits,
  converts with integer arithmetic to kopecks, and rejects ambiguous, negative, exponential,
  over-precision, and out-of-range input before write. Payment, refund, and adjustment API
  boundaries reject values beyond the ledger `Int` range. Unit tests include boundary values;
  the browser E2E asserts the submitted minor-unit amount and that invalid inputs submit no
  payment command.
- Legacy `order-complete` webhook now rejects absent, short, or incorrect `WEBHOOK_SECRET`
  before parsing or database access. Authenticated events cannot create a Commission from
  `Order.totalAmount`: the documented `AgentTier.commissionPct` applies to margin, and Order
  has no approved margin source. Existing commissions, including one linked to an unassigned
  Order, also receive a controlled 409 without changing historical records. A completed
  no-agent Order without Commission remains an idempotent no-op.
- Targeted webhook integration, including five concurrent calls, passed five consecutive
  runs with skipped=0. Full local PostgreSQL integration passed with isolated schema residue
  0; unit passed 126/126 with skipped=0. Local Turbopack build was blocked by host process/port
  restrictions; Webpack fallback is unsupported by existing `node:crypto` imports. Exact-source
  GitHub CI ran the normal build, E2E, security, and migration checks successfully.
- Source CI: https://github.com/gorgerich/TD_agent/actions/runs/35833918374. Its only failed
  step was `Validate authoritative mission evidence`: the old M3 mission packet still binds
  implementation and Preview UAT to `784140db230e8d0c1a566d2e70bbce91162a5587`.
  That historical UAT cannot be relabeled as an exact-head run.
- Exact-source Preview: `dpl_Fc7MaZVBQdDC1jNPbRV76Bex53Bb`,
  https://td-agent-llhdx37t6-rics-projects-9baa2793.vercel.app, READY. GitHub Preview
  deployment record `6609067015` binds it to `42901ef3bf843fafd859acc9920f6008b9117f6b`.
  The complete authenticated Preview UAT was **not rerun** on this deployment.
- Independent read-only review of the exact repair diff: P0=0, P1=0. One P2 remains: an
  authenticated webhook `orderId` above Prisma `Int` range can produce a database error rather
  than 400. Owner: engineering; reason: outside the two P1 repair paths; review by 2026-10-01.
- Production writes, Production schema changes, Production env changes, merge, and deployment:
  **NONE** for this repair. Existing historical commissions were not rewritten. The approved
  commission margin policy and source remain an explicit product/contract blocker; the legacy
  endpoint stays fail-closed for accrual until that decision and implementation exist.

Release gate remains **BLOCKED_SAFETY**: exact-head authoritative evidence, complete Preview
UAT, and CI PASS/skipped=0 are not yet established. No Production release or post-deployment
audit was performed.
