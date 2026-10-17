---
schema: m3-human-packet-v2
gate: financeAccounting
preview_url: https://td-agent-jfnz3t53l-rics-projects-9baa2793.vercel.app
deployment_id: dpl_DPhyGiZBuGeWTzY4SJGTbJHKFNS5
deployment_sha: b0b2d784e89c91211ff4b3df0d5bb7cd150f38a4
implementation_sha: b0b2d784e89c91211ff4b3df0d5bb7cd150f38a4
database_fingerprint: 545a187f9e9d66b0
current_verdict: AWAITING_HUMAN_VERDICT
reviewer_id: null
reviewer_name: null
attestation_fingerprint: null
---
# Finance/accounting human decision packet

## Candidate facts

PR36 / base875 technical candidate, 2026-10-17. Both authenticated synthetic journeys passed on this exact runtime. Technical PASS is not this human gate's approval; all checklist answers and attestations remain awaiting. Current CPO release NOT_PERFORMED; Production unchanged875 with freeze disabled. Prior packet is archived in historical/pre-pr36-b0-packet-20261017. Protected fixture credentials remain retained outside Git; browser logout is not credential destruction.


- Exact Preview: `https://td-agent-jfnz3t53l-rics-projects-9baa2793.vercel.app`
- Deployment: `dpl_DPhyGiZBuGeWTzY4SJGTbJHKFNS5`
- Implementation: `b0b2d784e89c91211ff4b3df0d5bb7cd150f38a4`
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
