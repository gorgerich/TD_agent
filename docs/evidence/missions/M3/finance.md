# Finance/accounting human decision packet

## Candidate facts

- Exact Preview: `https://td-agent-1plelby0t-rics-projects-9baa2793.vercel.app`
- Deployment: `dpl_Dzj7KprKCNASbVN1xPBpfPoraD8f`
- Implementation: `a917a1f10b959b80cd4e0a249a2d2281e0bba106`
- Data is synthetic and isolated from Production.
- Ledger is append-only; corrections and reversals preserve the original entry.
- Payment status is derived from obligation and ledger, never manually set.
- Reference calculation passed: 176,000 RUB obligation, 88,000 RUB paid,
  `PARTIALLY_PAID`, 88,000 RUB remaining.
- Five identical webhook deliveries created one entry.
- Missing approved four-eyes threshold leaves sensitive changes pending.

## Human checklist

The Finance/accounting reviewer must exercise both synthetic scenarios and decide:

1. Are `OBLIGATION`, `PAYMENT`, `REFUND`, `CORRECTION`, and `REVERSAL` sufficient and correctly interpreted?
2. What evidence is mandatory for manual payment and the approved pilot fallback?
3. What threshold and policy version require two-person approval?
4. Are overpayment, partial refund, full refund, correction, reversal, and balance formulas acceptable?
5. Which fields may appear in a safe finance export?
6. Do reconciliation rules and exception ownership match accounting practice?

## Required attestation

Record reviewer name/role, date, exact deployment ID/SHA, each checklist answer, and final
`PASS` or `FAIL`. A conditional answer must identify the exact rule to change. Automated tests
do not constitute a Finance verdict.

Current verdict: **AWAITING HUMAN**.
