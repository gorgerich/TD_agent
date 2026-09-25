# M3 repair validation, 2026-09-23

This is a factual addendum, not a replacement for the authoritative M3 packet or a release verdict.

- Runtime repair commit: `0c54170e813b078f3f9b8294a2eaa1f3488fcdcd`.
- PR: https://github.com/gorgerich/TD_agent/pull/32, still open.
- Exact-head CI: https://github.com/gorgerich/TD_agent/actions/runs/35871896351.
- CI source gates: migration fixtures, repeated deploy, schema parity, lint, typecheck, unit,
  integration, five targeted repeats, encrypted production-like restore, build and E2E passed.
- CI overall: FAIL only at authoritative mission evidence validation. The existing M3 packet
  identifies implementation SHA `784140db230e8d0c1a566d2e70bbce91162a5587`, which has
  source changes relative to the repair head. It must not be relabeled without new UAT.
- Preview: `dpl_E5Q9dWUXRRkhKsUtphKjN5kBrFvS`,
  https://td-agent-38al00q04-rics-projects-9baa2793.vercel.app, READY on exact repair SHA.
  Public login GET receives protection redirect; authenticated Vercel CLI login GET returned 200.
- Preview DB fingerprint: NOT_VERIFIED for this deployment. Branch-scoped Preview DB variables
  are listed in Vercel metadata, but `vercel env run` did not supply either DB URL to the
  local operator process. No production URL was substituted.
- New exact-SHA authenticated Preview UAT: NOT_RUN. The old UAT at the older SHA remains
  historical only. Synthetic Preview credentials for Agent, Manager, Finance and Reviewer
  were not available to this run.
- Local checks: `git diff --check`, lint, typecheck and 130/130 unit tests passed;
  canonical PostgreSQL integration suites passed with zero skips using the CI-only
  synthetic encryption key. The focused M3 suite passed 7/7 after the final change.
- Local Next.js Turbopack build could not bind an internal CSS worker port in the managed
  sandbox. The exact-head GitHub CI production build and E2E passed.
- Independent scoped repair review found no remaining P0/P1 after the offer-expiry/payment
  priority fix. This is not a replacement for final full-scope adversarial review or human verdicts.
- Finance, Legal/Privacy and Ritual SME verdicts: AWAITING_HUMAN_VERDICT. No reviewer
  credentials were registered or verdicts asserted by this run.
- Production writes, DB/schema changes, merge and deployment: NONE.

The authoritative M3 packet remains stale. Release gates are not complete. PR #32 must not be
merged or deployed until exact-SHA Preview UAT, reviewer attestation, three authentic human
verdicts and a green authoritative evidence validator are complete.
