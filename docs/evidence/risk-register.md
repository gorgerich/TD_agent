# Delivery risk register

## RISK-W1-TECH-HUMAN-REVIEW

- Owner: Founder
- Due: before the Week 10 Gate and before any production real-data pilot
- Status: `OPEN`
- Risk: Week 1 technical evidence has independent AI-assisted review and green
  CI, but no named human Tech Lead review.
- Closure evidence: a human technical reviewer records a decision against the
  then-current commit before either blocking milestone.

## RISK-W1-RITUAL-SME

- Owner: Founder
- Due: before the Week 2 Gate
- Status: `CLOSED` on 2026-07-14
- Risk: ritual terminology, operational guards and both pilot paths required
  validation by a practicing ritual-operations expert.
- Minimum closure evidence: one active ritual agent or operations manager.
- Target closure evidence: two independent experts.
- Gate effect: Week 2 may start, but cannot close without SME validation.
- Closure evidence: `docs/evidence/week-2-signoff.md` records the human verdict
  of `SME-01`, an active ritual agent with 10 years of experience, against
  implementation commit `f49497511035b849e1a7b8fb7c86444741cdb2e7`.
- Result: cremation `PASS`; family-plot burial `PASS`; P0/P1 `NONE`; P2 `NONE`;
  conformity with real ritual practice `YES`; final verdict `PASS`.
- Target note: a second independent expert remains desirable but is not the
  minimum Week 2 gate requirement.

## RISK-RELEASE-A-AUTHENTICATED-SMOKE

- Owner: Founder
- Due: before production migration and PR #19 merge
- Status: `CLOSED` on 2026-07-18
- Risk: Week 1 authenticated production smoke has not run because no existing
  password-login credentials were available to the release operator.
- Required closure evidence: password login with an existing account, direct
  navigation only through the audited read-only allowlist, tenant isolation and
  browser-console verification, with no production mutation.
- Forbidden closure shortcuts: demo login, OTP, account creation, `/co/[code]`
  or documentary waiver.
- Closure evidence: `docs/evidence/release-phase-2.md`. One canonical synthetic
  password-login account completed authenticated production smoke before
  migration, after deployment under freeze and after unfreeze. Tenant isolation
  passed, allowed read-only routes returned expected responses, and the account
  finished `SUSPENDED` with zero domain rows.

## RISK-RELEASE-A-DELTA-WINDOW

- Owner: Founder
- Due: before production migration
- Status: `CLOSED` on 2026-07-18
- Risk: old application writes between canonical backfill and new-code deployment
  can create leads or artifacts without matching canonical case/event state.
- Required mitigation: enforced mutation/webhook freeze from before migration
  until new deployment and authenticated smoke are green.
- Closure evidence: `docs/evidence/release-phase-2.md`. The reviewed freeze
  blocked representative mutations, server actions, webhooks, demo/OTP and
  `/co/*` throughout migration and deployment. Post-deploy reconciliation was
  zero, and a tenant-local reversible mutation passed only after unfreeze.
