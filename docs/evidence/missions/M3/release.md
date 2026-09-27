# M3 release packet

## Current state

`BLOCKED_HUMAN_JUDGMENT`

The product PR is not merged. Production has not changed. The owner conditionally
authorized a closed CPO audit release on a synthetic allowlisted organization,
not a broad agent rollout. Finance, Legal/Privacy, and Ritual SME verdicts are
still `AWAITING_HUMAN_VERDICT` and must not be represented as PASS.

The reviewed runtime is `e98cdbc613321e7c35e65c141dca7edfd20565a1`.
Source CI `https://github.com/gorgerich/TD_agent/actions/runs/36307243331`
passed all technical steps; its overall conclusion was failure solely at the
stale authoritative evidence validator. The evidence-head CI must pass before
merge. No Production write, migration, environment change, or deployment has
been performed.

## Exact Preview

- URL: `https://td-agent-5xbxjbk6y-rics-projects-9baa2793.vercel.app`
- Deployment: `dpl_HhM5s2s64SHrRrkQkXbsfeRSGFLu`, READY at the runtime SHA above.
- Railway Preview DB fingerprint: `545a187f9e9d66b0`, distinct from Production
  `0257665af2dd90a4`.
- Private Preview storage: `store_Ov8erHstuvfJ52Og`.
- Authenticated UAT run: `owner-preview-20260927`, 2 synthetic organizations,
  6 role identities, 2 Cases. Cremation, family-plot burial, document review,
  contract, partial/full payment, refund/reversal, webhook x5, finance/reviewer
  visibility, cross-tenant denial, reconciliation, mobile and 200% zoom PASS.
  Unexpected 5xx=0, skipped=0. Retained synthetic history is not deleted.
- Previous Preview/UAT at `784140db230e8d0c1a566d2e70bbce91162a5587`
  is historical and does not certify the current runtime.

## Release boundary

Full agent rollout remains blocked by three human verdicts. CPO audit release
requires green evidence-head CI, protected merge, verified Production DB/NOX
isolation, fresh encrypted backup with real isolated restore, additive migration
compatibility, rollback target, freeze coverage, and server-side CPO allowlist.
None of these final Production preflight gates may be inferred from Preview UAT.
If any gate fails, do not merge or deploy.

The known P2 Finance Case-detail read restriction is owned by M3 product
engineering, due 2026-10-04 before broad rollout. `RISK-W1-TECH-HUMAN-REVIEW`
remains OPEN. M4 has not started.
