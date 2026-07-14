# Week 2 evidence

- Date started: 2026-07-14
- Branch: `agent/week-2-canonical-case`
- Governance mode: `SOLO_FOUNDER_AI_ASSISTED`
- Verified implementation commit: `f49497511035b849e1a7b8fb7c86444741cdb2e7`
- Pull request: https://github.com/gorgerich/TD_agent/pull/19
- CI run: https://github.com/gorgerich/TD_agent/actions/runs/29339480074
- CI job: https://github.com/gorgerich/TD_agent/actions/runs/29339480074/job/87107145749
- Vercel preview check: https://vercel.com/rics-projects-9baa2793/td-agent/3GbXS8sb7JB8uMkHnFyRTTFphEJ2
- Reviewed Preview URL: https://td-agent-6no67xlba-rics-projects-9baa2793.vercel.app
- Vercel Preview deployment ID: `5442025143`
- Deployment SHA: `f49497511035b849e1a7b8fb7c86444741cdb2e7`
- Environment confirmation: Product Owner attestation, 2026-07-14
- `WEEK_STATUS: PASS`
- `SME_IMPLEMENTATION_VALIDATION: PASS`
- Source: `TD_AGENT_12_WEEK_DELIVERY_GATES.md`, Week 2
- Ritual SME record: `docs/evidence/week-2-signoff.md` (`PASS`)
- Release status: merge, production migration, deployment and production smoke
  are `NOT PERFORMED`

## Candidate scope

| Task | Status | Evidence / blocker |
| --- | --- | --- |
| W2-01 | Technically verified | `lib/caseService.ts` is the server-side Case command boundary. |
| W2-02 | Technically verified | `CaseEvent` is append-only; aggregate state and event commit in one serializable transaction. |
| W2-03 | Technically verified | `Case` requires tenant, owner, scenario and unique public-safe reference. |
| W2-04 | Technically verified | Target stage is selected only by `CASE_TRANSITION_MATRIX`; transport accepts event, not stage. |
| W2-05 | PASS | Separate cremation and family-plot closure guards exist; `SME-01` validated both scenarios and terminology against the implementation commit. |
| W2-06 | Technically verified | `projectNextAction` returns deterministic action, reason, deadline and owner. |
| W2-07 | Technically verified | Risk projection covers overdue action, ceremony proximity, missing blocker and stale SLA. |
| W2-08 | Technically verified | Case attention buckets consume exact risk reasons instead of one universal stale heuristic. |
| W2-09 | Technically verified | Create, transition and intake commands require idempotency; retries replay stored results. Concurrent cross-case key collision returns 409 without side effects. |
| W2-10 | Technically verified | Read-only tenant reconciliation checks count, ownership and minimum stage. |
| W2-11 | Technically verified | Demo/seed creates canonical cases and advances them through valid commands. Legacy backfill has six SQL fixtures. |
| W2-12 | Technically verified | Invalid transitions return a typed domain error before state/event writes. |
| W2-13 | CI verified | Unit matrix coverage and 10 isolated PostgreSQL integration tests pass without skips. |
| W2-14 | Technically verified | Case list/detail/meetings consume the canonical read model and expose required operational fields. |

## Acceptance evidence

| Acceptance | Status | Evidence |
| --- | --- | --- |
| AC-W2-01 | PASS | Direct `INTAKE` to payment command returns `INVALID_TRANSITION`; state/event count unchanged. |
| AC-W2-02 | PASS | Sequential replay creates one event; concurrent same-tenant cross-case collision creates one event and returns one 409. |
| AC-W2-03 | PASS | Integration compares persisted, list and detail stage projections. |
| AC-W2-04 | PASS | Reconciliation asserts tenant lead/case counts and document count. |
| AC-W2-05 | PASS | Risk projection and UI expose exact reason and deadline. |
| AC-W2-06 | PASS | Full-chain fixture returns zero reconciliation discrepancies. |

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

Candidate `f49497511035b849e1a7b8fb7c86444741cdb2e7` completed the `Quality / verify`
job in 2m18s:

- legacy pending/signed/paid/completed/viewed backfill fixture dry-run: PASS;
- baseline and Week 2 migrations applied to PostgreSQL `td_agent_test`: PASS;
- migration/schema parity: PASS, `No difference detected`;
- lint: PASS;
- typecheck: PASS;
- unit: 38 passed, 0 failed, 0 skipped;
- integration: 10 passed, 0 failed, 0 skipped;
- production build: PASS;
- e2e smoke: PASS;
- Vercel preview check: PASS.

## Independent review history

- Review 1: `FAIL`. Found aggressive legacy stage import, missing case-ID check in
  P2002 replay recovery and non-atomic intake mutation.
- Corrections: conservative artifact-backed import with SQL fixtures; scoped race
  replay; atomic/idempotent intake command plus integration coverage.
- Review 2: `FAIL`. Production fixes accepted, but sequential collision test did
  not execute the unique-race recovery path.
- Correction: two same-tenant cases now issue the same transition key concurrently;
  CI proves one success, one 409, one event and no loser side effect.
- Review 3 on `02efd788d9e62c9268bb5fb8fe334c8e20e9bbf0`: `PASS`, no P0/P1 findings.
- Evidence rerun `29339212160` exposed a real PostgreSQL `P2034` serialization
  conflict returning 500 under concurrent commands. The service now performs a
  bounded three-attempt retry and re-evaluates idempotency after rollback.
- Review 4 on `f49497511035b849e1a7b8fb7c86444741cdb2e7`: `PASS`, no P0/P1 findings.
- Ritual SME validation was not assessed or simulated by the technical reviewer.

## Gate status

Week 2 technical acceptance is verified. `SME-01`, an active ritual agent with
10 years of experience, validated the cremation and family-plot burial scenarios
against implementation commit `f49497511035b849e1a7b8fb7c86444741cdb2e7` on
2026-07-14. Both scenarios passed, no P0/P1 or P2 findings were reported, and
the workflow and terminology were confirmed as conforming to real practice.
See `docs/evidence/week-2-signoff.md`.

Product Owner confirmed on 2026-07-14 that the SME ran both scenarios on PR #19
Vercel Preview `https://td-agent-6no67xlba-rics-projects-9baa2793.vercel.app`.
GitHub deployment `5442025143` independently binds that Preview deployment to
the exact implementation SHA. This environment evidence supplements the existing
human SME verdict; it does not substitute for it.

Week 2 gate: `PASS`. Merge, production migration, deployment and production
smoke remain separate, unperformed release actions.
