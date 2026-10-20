---
schema: m3-human-packet-v2
gate: financeAccounting
preview_url: https://td-agent-ixjzuqpub-rics-projects-9baa2793.vercel.app
deployment_id: dpl_CwUNtEzxsxxsg4xJWfFeiCgFxjBg
deployment_sha: e9c23c516adf4b136b94a8825ec1cc45626b66a0
implementation_sha: e9c23c516adf4b136b94a8825ec1cc45626b66a0
database_fingerprint: 545a187f9e9d66b0
current_verdict: AWAITING_HUMAN_VERDICT
reviewer_id: null
reviewer_name: null
attestation_fingerprint: null
---
# Finance/accounting human decision packet

## Candidate facts

PR37 / base055 technical candidate,2026-10-17. Actual exacte9 Preview journeys passed; this does not approve any human checklist. PR36 release failed and remains recorded in INCIDENT-PR36-20261017.md. Subsequent restricted CPO releaseffc/deployment3qc/freezedisabled is recorded in cpo-post-release-20261018.md; it does not approve this Finance verdict or broad rollout. Protected synthetic material retained; no credentials in this packet.


- Exact Preview: `https://td-agent-ixjzuqpub-rics-projects-9baa2793.vercel.app`
- Deployment: `dpl_CwUNtEzxsxxsg4xJWfFeiCgFxjBg`
- Implementation: `e9c23c516adf4b136b94a8825ec1cc45626b66a0`
- Data is synthetic and isolated from Production.
- Ledger is append-only; corrections and reversals preserve the original entry.
- Payment status is derived from obligation and ledger, never manually set.
- Reference calculation passed: 176,000 RUB obligation, 88,000 RUB paid,
  `PARTIALLY_PAID`, 88,000 RUB remaining.
- Five identical webhook deliveries created one entry.
- Missing approved four-eyes threshold leaves sensitive changes pending.

## Human checklist

The Finance/accounting reviewer must exercise both synthetic scenarios and decide:

- [ ] entry-policy: Confirm `OBLIGATION`, `PAYMENT`, `REFUND`, `CORRECTION`, and `REVERSAL` meanings.
- [ ] manual-evidence: Define mandatory evidence for manual payment and pilot fallback.
- [ ] four-eyes-threshold: Approve threshold and policy version for two-person approval.
- [ ] accounting-formulas: Confirm balance, overpayment, refund, correction, and reversal formulas.
- [ ] export-scope: Approve fields allowed in a purpose-limited finance export.
- [ ] reconciliation: Confirm reconciliation rules, exception ownership, and escalation.
- [ ] scenario-cremation: Complete the synthetic cremation finance journey in this Preview.
- [ ] scenario-family-plot-burial: Complete the synthetic family-plot burial finance journey in this Preview.

## Required attestation

Record reviewer name/role, date, exact deployment ID/SHA, each checklist answer, and final
`PASS` or `FAIL`. A conditional answer must identify the exact rule to change. Automated tests
do not constitute a Finance verdict.

Current verdict: **AWAITING HUMAN**.
