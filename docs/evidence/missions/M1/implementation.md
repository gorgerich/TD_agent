# Mission 1 implementation contract

## Existing behavior at contract lock

- `Agent` is the effective data boundary; canonical `Case.tenantId` is derived as
  `agent:<agentId>`.
- Session role is signed into the cookie and is not resolved from a membership on
  each request.
- Open registration creates an `ACTIVE` agent directly.
- `Task` stores title, optional due date and `completedAt`; update and delete are
  direct mutable operations with no source event, outcome or audit record.
- `Meeting` stores an agent, lead, optional time and four statuses; reschedule and
  status updates have no outcome, idempotency key or immutable audit record.
- Agent task and calendar pages turn database failures into empty arrays.
- No manager queue, assignment workflow, saved operational view or cross-entity
  operational search exists.

## Target implementation

1. Add `Organization`, `Membership`, `OperationalAuditEvent` and
   `SavedOperationalView` without replacing existing primary keys.
2. Backfill one organization and one active Agent membership per existing Agent.
   Keep stable links to existing `User`, `Agent`, `Case`, `Task` and `Meeting` rows.
3. Add canonical lifecycle fields to `Task` and `Meeting`; transform legacy
   completion/status data deterministically.
4. Resolve tenant and role from active membership server-side. Cookie role becomes
   a compatibility hint, never authorization truth.
5. Route Task and Meeting mutations through canonical services with ownership,
   role, optimistic version, idempotency and immutable audit enforcement.
6. Project overdue meeting escalation and event-linked tasks idempotently.
7. Deliver agent operational queues, manager control tower, assignment,
   operational search and saved views using the same canonical read model.
8. Replace touched silent failure fallbacks with explicit error/retry states.

## Event and projection rules

- Every accepted business mutation writes one `OperationalAuditEvent` in the same
  transaction as the aggregate change.
- Event identity is unique by organization and idempotency key. A replay returns
  the original result without another mutation or audit event.
- Assignment, reassignment, status, outcome and reschedule events contain actor,
  time, entity, before, after, reason, correlation ID and optional causation ID.
- A source event can own one active projected task. Retry never creates a second
  projection. Supersession records `supersededById`; projected tasks are not
  deleted.
- A past `SCHEDULED` or `CONFIRMED` meeting without outcome projects exactly one
  visible escalation task.
- Completing/cancelling/no-showing the meeting closes or supersedes that escalation
  exactly once.
- Overdue is derived from organization timezone and only for `OPEN` tasks.

## Route and UI ownership

| Surface | Canonical owner |
| --- | --- |
| `/agent/tasks` | Agent Today / Overdue / Upcoming / Waiting-Blocked queue |
| `/agent/meetings` | Canonical Meeting lifecycle and outcome queue |
| `/agent/operations` | Manager Team Control Tower and assignment |
| command palette | Tenant-scoped Case/client/Task/Meeting search |
| case workspace | Contextual Task/Meeting actions and immutable audit timeline |

## Non-goals

- Quote publication/client decision redesign (M2).
- Payment provider, ledger and KKT work (M3).
- Document verification engine (M3).
- Ceremonial 2.5D visualization (M4).
- Production load, penetration, legal or pilot acceptance (M5).
- Production merge, database migration, environment change or deployment.

