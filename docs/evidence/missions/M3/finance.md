---
schema: m3-human-packet-v2
gate: financeAccounting
preview_url: https://td-agent-h162tsojw-rics-projects-9baa2793.vercel.app
deployment_id: dpl_HszboxTiE1dYJu5dgrBUTciaQ126
deployment_sha: 48eef7cd34b4cc2f9898dadf4506a32da8699962
implementation_sha: 48eef7cd34b4cc2f9898dadf4506a32da8699962
database_fingerprint: 545a187f9e9d66b0
current_verdict: AWAITING_HUMAN_VERDICT
reviewer_id: null
reviewer_name: null
attestation_fingerprint: null
---
# Finance/accounting human decision packet

## Candidate facts

PR39 / base91ae technical candidate. Actual exact48 Preview journeys passed on 2026-10-23; synthetic access was then revoked. This packet is prepared factual input, NOT a professional verdict. No PR39 Production release occurred. Historical releases and failed attempts remain in their original receipts. Re-admit only scoped synthetic access through an approved reviewed mechanism when a real reviewer is scheduled.


- Exact Preview: `https://td-agent-h162tsojw-rics-projects-9baa2793.vercel.app`
- Deployment: `dpl_HszboxTiE1dYJu5dgrBUTciaQ126`
- Implementation: `48eef7cd34b4cc2f9898dadf4506a32da8699962`
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
