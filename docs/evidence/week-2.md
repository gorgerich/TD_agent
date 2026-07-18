# Week 2 evidence

- Date started: 2026-07-14
- Branch: `agent/week-2-canonical-case`
- Governance mode: `SOLO_FOUNDER_AI_ASSISTED`
- Verified implementation commit: `f49497511035b849e1a7b8fb7c86444741cdb2e7`
- Integration isolation repair commit: `b95483b4f8a635fed036aa8a7f09ffc18a383905`
- Repair CI run: https://github.com/gorgerich/TD_agent/actions/runs/29639492358
- Repair Preview: https://td-agent-12p8yv8y0-rics-projects-9baa2793.vercel.app
- Repair Preview deployment ID: `5500617386`
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
- Release Gate A: `BLOCKED`; migration rehearsal passed, but Week 1 authenticated
  production smoke lacks existing password credentials. See
  `docs/evidence/release-gate-a.md`.

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
| W2-13 | CI verified | Unit matrix coverage and 12 isolated PostgreSQL integration tests pass without skips, including concurrent fixture cleanup regression coverage. |
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

## Release Phase 1 closure

- Ops controls from `main` commit `c02511d463f8139146e4fc31b0be02050eb8354f`
  were integrated by merge commit `67e94df7624122225a9d9a6fc28068bc3a6bd41e`.
- Combined CI: https://github.com/gorgerich/TD_agent/actions/runs/29410280422
  (`PASS`, no skipped steps).
- Protected Preview: https://td-agent-69ayidr7z-rics-projects-9baa2793.vercel.app
- Preview deployment and implementation SHA:
  `67e94df7624122225a9d9a6fc28068bc3a6bd41e`.
- Deployment Protection method: authenticated Vercel CLI `vercel curl` using a
  temporary link to the verified existing `td-agent` project.
- Read-only GET smoke: login `200`, root `307`, unauthenticated agent page `307`,
  unauthenticated agent API `401`; no 5xx or release-freeze response observed.
- The disposable link directory was removed after verification; no link was
  created in the PR worktree.
- `RELEASE_PHASE_1: PASS`.
- `PRODUCTION_WRITES: NONE`.
- `PRODUCTION_DB_CHANGES: NONE`.

PR #19 production migration, merge and deployment remain `NOT RUN`.

## Integration isolation repair

Release rehearsal on 2026-07-18 exposed cross-suite interference in the
integration harness. The production implementation was not implicated:

- the full Case transition chain passed 3/3 when run alone;
- the unmodified full suite failed 3/3 under normal Node test-file concurrency;
- `cleanup()` selected every integration user through the shared `it-` email
  prefix, allowing one suite to delete another suite's Case before transition;
- the same broad cleanup attempted to delete a User while a concurrently-created
  Agent still referenced it, producing `Agent_userId_fkey` failures.

Repair commit `b95483b4f8a635fed036aa8a7f09ffc18a383905` replaces prefix discovery
with per-suite random run IDs, exact User/Agent root registries and reverse-FK
scoped cleanup. It adds a parallel two-context regression test. No test was
skipped, serialized, weakened or given a larger timeout. No production source,
configuration, schema, migration or workflow file changed.

Local repair gate:

- targeted full transition chain: 5/5 PASS;
- full integration suite: 5 consecutive runs, each 12/12 PASS, 0 skipped;
- test-owned User/Agent/domain residue after every full run: 0;
- parallel independent fixture contexts: PASS;
- foreign-key cleanup errors and unexpected transition 404 responses: 0;
- unit: 47/47 PASS, including PT-001 through PT-011;
- migration fixture, migration/schema parity, lint, typecheck, build and e2e: PASS;
- approved migration checksums unchanged.

GitHub repair CI `29639492358` ran the same `tests/integration/*.itest.ts`
command and discovered all four integration files and 12 tests. Result: 12
passed, 0 failed, 0 skipped. Vercel Preview deployment `5500617386` completed
for exact repair SHA `b95483b4f8a635fed036aa8a7f09ffc18a383905`.

Release Phase 2 remained stopped during repair. `PRODUCTION_WRITES: NONE` and
`PRODUCTION_DB_CHANGES: NONE` for the repair window.
