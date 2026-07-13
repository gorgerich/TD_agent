# ADR 0001: canonical domain mutations

- Status: Proposed, awaiting Week 1 sign-off
- Date: 2026-07-13

## Context

Current route handlers mutate Prisma models directly. Stage, quote, payment, document
and task meaning is then reconstructed independently by APIs and UI. The CPO audit
found contradictory totals, statuses and client-visible state.

## Decision

All business mutations must enter one application/domain service boundary:

`route/server action -> authorization -> command service -> aggregate guards -> transaction -> event/outbox -> projections`

Rules:

1. UI never writes stage, payment status, document readiness or published quote state.
2. Routes validate transport/auth only and call typed commands.
3. Commands require organization, actor, idempotency and correlation context.
4. Aggregate guards reject invalid transitions.
5. State and event/outbox record commit atomically.
6. Read models are projections, not alternate truth.
7. Payment corrections append entries. Quote publication appends immutable versions.

## Consequences

- Week 2 introduces the service boundary and event contract before feature expansion.
- Existing routes migrate incrementally behind characterization tests.
- Prisma changes, if needed later, require reviewed migration and isolated test proof.
- Temporary dual-write is allowed only with reconciliation and an explicit removal date.

## Rejected alternatives

- More UI heuristics: preserves contradictions.
- One service per page: duplicates domain decisions.
- Treating `AgentSession` as quote truth: leaks transient presentation state.
- Direct Prisma calls with shared helper functions: still lacks transactional command/event semantics.
