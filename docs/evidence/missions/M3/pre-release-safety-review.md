# M3 pre-release safety review

Status: **BLOCKED_SAFETY** on 2026-09-21. This is a pre-release finding, not the requested
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
