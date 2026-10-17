---
schema: m3-human-packet-v2
gate: ritualOperationsSme
preview_url: https://td-agent-2z7lvoo1b-rics-projects-9baa2793.vercel.app
deployment_id: dpl_AkHmeuGd4EoQJVTPqEH3qpCeKgUa
deployment_sha: c0567d11d4a80d1488a1e8bca6dc1815ffc83806
implementation_sha: c0567d11d4a80d1488a1e8bca6dc1815ffc83806
database_fingerprint: 545a187f9e9d66b0
current_verdict: AWAITING_HUMAN_VERDICT
reviewer_id: null
reviewer_name: null
attestation_fingerprint: null
---
# Ritual-operations SME decision packet

## Candidate facts

- Exact Preview: `https://td-agent-2z7lvoo1b-rics-projects-9baa2793.vercel.app`
- Deployment: `dpl_AkHmeuGd4EoQJVTPqEH3qpCeKgUa`
- Implementation: `c0567d11d4a80d1488a1e8bca6dc1815ffc83806`
- Preview policies and records are explicitly synthetic, not legal or ritual verdicts.
- Cremation and burial in a family plot have different versioned requirement sets.
- Unapproved policy fails closed and cannot open a Case stage.
- Rejected, expired, or unverified documents remain visible blockers with owner and next action.

## Human checklist

The Ritual-operations SME must complete both scenarios and decide:

- [ ] cremation-requirements: Confirm every required and conditional cremation requirement.
- [ ] family-plot-requirements: Confirm every required and conditional family-plot requirement.
- [ ] accepted-document-types: Approve accepted document types and reviewer checklist fields.
- [ ] stage-blockers: Approve the exact Case stages blocked by each requirement.
- [ ] ownership-due-rules: Approve owner, due-date, deadline, and escalation rules.
- [ ] rejection-replacement-flow: Confirm rejection, replacement, expiry, and next-action usability.
- [ ] scenario-cremation: Complete the full synthetic cremation journey in this Preview.
- [ ] scenario-family-plot-burial: Complete the full synthetic family-plot burial journey in this Preview.

## Required attestation

Record SME identity/role, experience, date, exact deployment ID/SHA, result of each scenario,
each checklist answer, and final `PASS` or `FAIL`. Do not approve legal meaning outside the SME's
ritual-operations remit.

Current verdict: **AWAITING HUMAN**.
