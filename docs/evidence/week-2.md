# Week 2 evidence

- Date started: 2026-07-14
- Branch: `agent/week-2-canonical-case`
- Governance mode: `SOLO_FOUNDER_AI_ASSISTED`
- Candidate commit: `6c0918de5357c999d5750c06d49651ee22a474d7`
- Pull request: https://github.com/gorgerich/TD_agent/pull/19
- CI run: https://github.com/gorgerich/TD_agent/actions/runs/29336719451
- CI job: https://github.com/gorgerich/TD_agent/actions/runs/29336719451/job/87097693552
- `WEEK_STATUS: TECHNICALLY_VERIFIED_GATE_BLOCKED`
- Source: `TD_AGENT_12_WEEK_DELIVERY_GATES.md`, Week 2
- Gate blocker: `RISK-W1-RITUAL-SME` remains `OPEN`

## Candidate scope

| Task | Status | Evidence / blocker |
| --- | --- | --- |
| W2-01 | Implemented, verification pending | `lib/caseService.ts` is the server-side Case command boundary. |
| W2-02 | Implemented, verification pending | `CaseEvent` is append-only; aggregate state and event commit in one serializable transaction. |
| W2-03 | Implemented, verification pending | `Case` requires tenant, owner, scenario and unique public-safe reference. |
| W2-04 | Implemented, verification pending | Target stage is selected only by `CASE_TRANSITION_MATRIX`; transport accepts event, not stage. |
| W2-05 | Implemented, SME blocked | Separate cremation and family-plot closure guards exist. Ritual correctness requires SME validation. |
| W2-06 | Implemented, verification pending | `projectNextAction` returns deterministic action, reason, deadline and owner. |
| W2-07 | Implemented, verification pending | Risk projection covers overdue action, ceremony proximity, missing blocker and stale SLA. |
| W2-08 | Implemented, verification pending | Case attention buckets consume exact risk reasons instead of one universal stale heuristic. |
| W2-09 | Implemented for Week 2 Case commands, verification pending | Create and transition commands require idempotency; retries replay the stored result. |
| W2-10 | Implemented, verification pending | Read-only tenant reconciliation checks count, ownership and minimum stage. |
| W2-11 | Implemented, verification pending | Demo/seed creates canonical cases and advances them through valid commands. |
| W2-12 | Implemented, verification pending | Invalid transitions return a typed domain error before state/event writes. |
| W2-13 | CI verified | Unit matrix coverage and 8 isolated PostgreSQL integration tests pass without skips. |
| W2-14 | Implemented, verification pending | Case list/detail/meetings consume the canonical read model and expose required operational fields. |

## Safety boundary

- Week 2 schema change is additive: canonical `Case`, append-only `CaseEvent` and two enums.
- Existing B2C columns, auth, payment records and public client routes are not removed or rewritten.
- Production/shared database has not been accessed or mutated.
- Production migration is not authorized by this evidence record.
- Baseline adoption and staging dry-run procedure are documented in `docs/db-migrations-runbook.md`.

## Local verification

- `npm run test:unit`: PASS, 38/38, 0 skipped.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `APP_ENCRYPTION_KEY=<local-test> npm run build`: PASS.
- `git diff --check`: PASS.
- PostgreSQL migration/integration: PASS against isolated `td_agent_test`.

First CI dry-run (`29336583863`) correctly failed schema parity because the
handwritten additive migration gave Prisma-managed `Case.updatedAt` a database
default. The default was removed before any shared database deployment; the
backfill already supplies an explicit value. Clean rerun `29336719451` passed.

## GitHub CI verification

Candidate `6c0918de5357c999d5750c06d49651ee22a474d7` completed the `Quality / verify`
job in 2m33s:

- baseline and Week 2 migrations applied to PostgreSQL `td_agent_test`: PASS;
- migration/schema parity: PASS, `No difference detected`;
- lint: PASS;
- typecheck: PASS;
- unit: 38 passed, 0 failed, 0 skipped;
- integration: 8 passed, 0 failed, 0 skipped;
- production build: PASS;
- e2e smoke: PASS;
- Vercel preview check: PASS.

## Gate status

Week 2 is not closed. Independent review is pending. After technical verification,
the gate remains blocked until at
least one active ritual agent or ritual-operations manager validates both pilot
scenarios and the evidence is recorded against the candidate commit.

Week 2 gate: `BLOCKED` by `RISK-W1-RITUAL-SME`.
