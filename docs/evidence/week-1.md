# Week 1 evidence

- Date: 2026-07-13
- Gate status: `BLOCKED`
- Verified candidate commit: `95d6dbd91cecdefeedc722ad27dcebb94ba15e27`
- Pull request: https://github.com/gorgerich/TD_agent/pull/17
- CI run: https://github.com/gorgerich/TD_agent/actions/runs/29282142936
- CI job: https://github.com/gorgerich/TD_agent/actions/runs/29282142936/job/86925686861
- Source: `TD_AGENT_12_WEEK_DELIVERY_GATES.md`, `CURRENT_WEEK: 1`
- CPO baseline: `TD_Agent_CPO_Audit_2026-07-13.docx`, operational readiness 29/100

## Task evidence

| Task | Status | Evidence / blocker |
| --- | --- | --- |
| W1-01 | Proposed | Exactly two scenarios in `pilot-scope.md`; Product/SME approval pending. |
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
| W1-12 | Proposed | ADR 0001 written; Tech Lead acceptance pending. |
| W1-13 | Complete | Ephemeral PostgreSQL `td_agent_test` and in-memory document storage executed 4 integration tests with 0 skipped. |
| W1-14 | Complete | GitHub Actions run `29282142936` passed lint, typecheck, 34 unit tests, 4 integration tests, build and e2e. |
| W1-15 | Complete as executable spec | `PT-001` through `PT-011` include negative cases and run in unit suite. Runtime remediation is not claimed. |
| W1-16 | Blocked on humans | Product Owner, Tech Lead and ritual-operations SME signatures absent. |

## Acceptance evidence

| Acceptance | Status | Evidence |
| --- | --- | --- |
| AC-W1-01 | Spec complete | `status-registry.md` maps every status/filter on all four required routes. |
| AC-W1-02 | Executable spec complete | `PT-005`: 88k / 176k is `PARTIALLY_PAID`. |
| AC-W1-03 | Executable spec complete, SME pending | `PT-010` separately checks proposed cremation and family-plot guards. |
| AC-W1-04 | Spec/test complete | Quote state diagram and `PT-001`. |
| AC-W1-05 | Complete | Contradictions have IDs, expected behavior and future owner. |
| AC-W1-06 | Complete | Clean GitHub checkout used ephemeral PostgreSQL credentials only; run `29282142936` passed. |

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
- Vercel preview: PASS, https://vercel.com/rics-projects-9baa2793/td-agent/CwWusCxVS49vfrgVJGYLsezK3oCF
- Prisma schema: unchanged.
- Production/shared database: not accessed or mutated.

## Gate blockers

1. Product Owner approval of exactly two pilot scenarios.
2. Tech Lead approval of ADR/state/event model.
3. Ritual-operations SME approval of scenario paths and terminology.

## Independent review history

- Review 1: `FAIL`. Found unsafe broad DB allowlist, weak acceptance checks,
  incomplete transition/status registries, non-deterministic integration identities and
  missing audit before/after fields. P0/P1 corrections applied; re-review pending.
- Review 2: `FAIL`. Found risk projection mixed into lifecycle, payment event mismatch,
  incomplete case bucket registry and storage fake not connected to document routes.
  Corrections applied; re-review pending.
- Review 3: `FAIL`. Found payment diagram/matrix guard mismatch and one inaccurate
  bucket derivation description. Corrections applied; re-review pending.
- Review 4: `PASS`. No remaining findings. Human sign-off and remote CI remain external blockers.

Week 2 must not start until these blockers are cleared and the Week 1 gate is explicitly marked `PASS`.

## CI job results for candidate commit

| Job / step | Result |
| --- | --- |
| `Quality / verify` | PASS in 2m47s |
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

No human has signed candidate commit `95d6dbd91cecdefeedc722ad27dcebb94ba15e27`.
Therefore Week 1 gate is `BLOCKED`, not `PASS`.
