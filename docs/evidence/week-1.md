# Week 1 evidence

- Date: 2026-07-13
- Governance mode: `SOLO_FOUNDER_AI_ASSISTED`
- `WEEK_STATUS: PASS`
- Verified candidate commit: `95d6dbd91cecdefeedc722ad27dcebb94ba15e27`
- Accepted gate baseline: `1fcdd9beea0f95fcec6c08ea40cf2ad8be9b0a5f`
- Pull request: https://github.com/gorgerich/TD_agent/pull/17
- CI run: https://github.com/gorgerich/TD_agent/actions/runs/29282454544
- CI job: https://github.com/gorgerich/TD_agent/actions/runs/29282454544/job/86926736687
- Source: `TD_AGENT_12_WEEK_DELIVERY_GATES.md`, `CURRENT_WEEK: 1`
- CPO baseline: `TD_Agent_CPO_Audit_2026-07-13.docx`, operational readiness 29/100

## Task evidence

| Task | Status | Evidence / blocker |
| --- | --- | --- |
| W1-01 | Accepted | Founder / Product Owner accepted exactly two scenarios: cremation and family/related-plot burial. SME validation remains due before the Week 2 Gate. |
| W1-02 | Complete in spec | End-to-end paths documented for both scenarios. |
| W1-03 | Complete in spec | Twelve-week out-of-scope boundary documented. |
| W1-04 | Complete in spec | Glossary contains all required terms. |
| W1-05 | Complete | Routes, mutations, schema/state owners and seed risks inventoried. |
| W1-06 | Complete in target model | Stable IDs/relations defined; current gaps explicitly listed. |
| W1-07 | Complete in spec | Seven state diagrams included. |
| W1-08 | Complete in spec | Transition matrix includes from/event/guard/to/side effect/audit. |
| W1-09 | Complete in spec | Versioned event envelope and pilot catalog included. |
| W1-10 | Complete in spec | Eleven impossible states mapped to test ID and future owner. |
| W1-11 | Complete in spec | Canonical source for six required projections documented. |
| W1-12 | Provisional pass | ADR 0001 written; four independent reviews and GitHub CI passed. Human technical review is deferred under `RISK-W1-TECH-HUMAN-REVIEW`. |
| W1-13 | Complete | Ephemeral PostgreSQL `td_agent_test` and in-memory document storage executed 4 integration tests with 0 skipped. |
| W1-14 | Complete | GitHub Actions run `29282454544` passed lint, typecheck, 34 unit tests, 4 integration tests, build and e2e. |
| W1-15 | Complete as executable spec | `PT-001` through `PT-011` include negative cases and run in unit suite. Runtime remediation is not claimed. |
| W1-16 | Complete under recorded governance | Product Owner decision is PASS. Technical review is `PROVISIONAL_PASS`; Ritual Operations validation is `DEFERRED`. Neither deferred human signature is claimed. |

## Acceptance evidence

| Acceptance | Status | Evidence |
| --- | --- | --- |
| AC-W1-01 | Spec complete | `status-registry.md` maps every status/filter on all four required routes. |
| AC-W1-02 | Executable spec complete | `PT-005`: 88k / 176k is `PARTIALLY_PAID`. |
| AC-W1-03 | Executable spec complete, SME deferred | `PT-010` separately checks cremation and family-plot guards. Operational validation blocks Week 2 closure. |
| AC-W1-04 | Spec/test complete | Quote state diagram and `PT-001`. |
| AC-W1-05 | Complete | Contradictions have IDs, expected behavior and future owner. |
| AC-W1-06 | Complete | Clean GitHub checkout used ephemeral PostgreSQL credentials only; run `29282454544` passed. |

## Verification log

- `npm run test:unit`: PASS, 34/34 after Week 1 contract, DB guard and isolated-storage tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `APP_ENCRYPTION_KEY=<local-test> npm run build`: PASS; route manifest generated and 32 pages statically processed.
- `npm run test:e2e` against local production server: PASS.
- `npm audit --omit=dev --audit-level=high`: PASS; no High/Critical advisories. Two Moderate PostCSS advisories remain because offered fix downgrades Next to 9.3.3.
- Clean local `npm ci`: PASS.
- GitHub PostgreSQL integration: PASS, 4/4 executed, 0 skipped.
  - lead PII encrypt/decrypt: PASS;
  - cross-agent meeting IDOR guard: PASS;
  - quote auth/ownership guard: PASS;
  - isolated document upload/delete storage: PASS.
- GitHub production build: PASS.
- GitHub e2e smoke: PASS.
- Vercel preview: PASS, https://vercel.com/rics-projects-9baa2793/td-agent/3FvovsqK5fA3chCJACdGN4wH6AH5
- Prisma schema: unchanged.
- Production/shared database: not accessed or mutated.

## Gate decision and deferred blocking milestones

The Founder / Product Owner accepted the implementation, exactly two pilot
scenarios and the solo-founder governance risk. Week 1 is therefore `PASS`.

The following controls remain open and are not represented as completed human
signatures:

1. `RISK-W1-TECH-HUMAN-REVIEW`: human technical review before the Week 10 Gate
   and before any production pilot using real personal data or payments.
2. `RISK-W1-RITUAL-SME`: validation by at least one active ritual agent or
   operations manager before the Week 2 Gate can close; two experts are the
   target.

## Independent review history

- Review 1: `FAIL`. Found unsafe broad DB allowlist, weak acceptance checks,
  incomplete transition/status registries, non-deterministic integration identities and
  missing audit before/after fields. P0/P1 corrections applied; re-review pending.
- Review 2: `FAIL`. Found risk projection mixed into lifecycle, payment event mismatch,
  incomplete case bucket registry and storage fake not connected to document routes.
  Corrections applied; re-review pending.
- Review 3: `FAIL`. Found payment diagram/matrix guard mismatch and one inaccurate
  bucket derivation description. Corrections applied; re-review pending.
- Review 4: `PASS`. No remaining findings. Human technical and ritual SME
  reviews remain deferred controls under the risk register.

Week 2 is not implemented in this closure. It may start after closure, but its
gate cannot pass without `RISK-W1-RITUAL-SME` closure evidence.

## CI job results for candidate commit

| Job / step | Result |
| --- | --- |
| `Quality / verify` | PASS in 2m22s |
| PostgreSQL service + `prisma db push` | PASS against ephemeral `td_agent_test` only |
| `npm ci` | PASS on Node 24 |
| lint | PASS |
| typecheck | PASS |
| unit | 34 passed, 0 failed, 0 skipped |
| integration | 4 passed, 0 failed, 0 skipped |
| production build | PASS |
| Playwright install | PASS |
| e2e smoke | PASS |
| Vercel preview | PASS |

Product Owner decision: `PASS`, under Founder/Product Owner risk-acceptance
authority. Technical review: `PROVISIONAL_PASS`. Ritual Operations validation:
`DEFERRED`. The latter two are not human signatures and remain explicit risks.

Week 1 gate: `PASS` under `SOLO_FOUNDER_AI_ASSISTED` governance.
