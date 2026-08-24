# M3 release packet

## Terminal state

`BLOCKED_HUMAN_JUDGMENT`

All safely executable technical work is complete on implementation SHA
`a917a1f10b959b80cd4e0a249a2d2281e0bba106`. Deterministic gates, exact-SHA isolated Preview
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
- Exact Preview: `https://td-agent-1plelby0t-rics-projects-9baa2793.vercel.app`
- Preview deployment: `dpl_Dzj7KprKCNASbVN1xPBpfPoraD8f`
- Preview DB: isolated fingerprint `646addef2eb61519`
- Preview storage: private `store_Ov8erHstuvfJ52Og`
- Production writes: **NONE**
- Production DB/schema changes: **NONE**
- Production env changes: **NONE**
- Production deployment: **UNCHANGED**
- Production release authorization: **NOT GRANTED**
- Product PR merge: **NOT PERFORMED**

Final read-only verification on 2026-08-25 re-confirmed Production fingerprint
`0257665af2dd90a4`, `transaction_read_only=on`, zero M3 tables from the guarded set, and no
applied M3 migration record. Production deployment remained
`dpl_AkdiVtTqDjsvnX4nS3k4yKbez61g` READY.

## Required owner decision

Arrange the three human reviews against the exact Preview and record their PASS/FAIL attestations.
If all three pass, revalidate the unchanged head and request `AUTHORIZE M3 RELEASE`. If any reviewer
rejects a policy, return the exact rule or accounting/privacy decision to rework; do not weaken the
fail-closed defaults.

`RISK-W1-TECH-HUMAN-REVIEW` remains OPEN. M4 has not started.
