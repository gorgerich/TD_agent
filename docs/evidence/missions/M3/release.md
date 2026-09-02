# M3 release packet

## Terminal state

`BLOCKED_HUMAN_JUDGMENT`

All safely executable technical work is complete on implementation SHA
`eb568f54d6b47d90ed36c73738bd89c03da761c9`. Deterministic gates, exact-SHA isolated Preview
UAT, migration/restore/no-op/parity, reconciliation, accessibility/mobile, evidence validation,
and independent review pass with skipped=0, NOT_RUN=0, P0=0, and P1=0.

The mission cannot truthfully become `MISSION_RELEASE_READY` until three people issue explicit
verdicts on the candidate:

1. Finance/accounting: ledger, evidence, correction/reversal, threshold, and reconciliation.
2. Legal/Privacy: contract/signing boundary, consent, retention, document access, and family roles.
3. Ritual-operations SME: cremation and family-plot requirements, conditions, blockers, and review checklist.

Prepared factual packets are in `finance.md`, `privacy.md`, and `ritual-rules.md`. No automated
result is substituted for a human decision.

## Release controls

- Product PR: `https://github.com/gorgerich/TD_agent/pull/32`
- Source CI: `https://github.com/gorgerich/TD_agent/actions/runs/33529964574`
- Exact Preview: `https://td-agent-3ulmmuenk-rics-projects-9baa2793.vercel.app`
- Preview deployment: `dpl_CDP554WNjhyMX7zABzL1ZHUB3odY`
- Preview DB: isolated fingerprint `545a187f9e9d66b0`
- Preview storage: private `store_Ov8erHstuvfJ52Og`
- Production writes: **NONE**
- Production DB/schema changes: **NONE**
- Production env changes: **NONE**
- Production deployment: **UNCHANGED**
- Production release authorization: **NOT GRANTED**
- Product PR merge: **NOT PERFORMED**

Final read-only verification re-confirmed Production fingerprint
`0257665af2dd90a4`, `transaction_read_only=on`, zero M3 tables from the guarded set, and no
applied M3 migration record. Production deployment remained
`dpl_AkdiVtTqDjsvnX4nS3k4yKbez61g` READY.

## Required owner decision

Arrange the three human reviews against the exact Preview and record their PASS/FAIL attestations.
If all three pass, revalidate the unchanged head and request `AUTHORIZE M3 RELEASE`. If any reviewer
rejects a policy, return the exact rule or accounting/privacy decision to rework; do not weaken the
fail-closed defaults.

`RISK-W1-TECH-HUMAN-REVIEW` remains OPEN. M4 has not started.

Technical P2 `M3-P2-RATE-LIMIT-RETENTION` tracks bounded reclamation of expired persistent
login-rate-limit identities. Platform Operations owns it for 2026-09-15 or before M3 Production
release. It does not weaken authentication, throttling, tenant isolation, or current mission gates.
