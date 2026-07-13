# Domain event catalog

## Required envelope

Every event carries:

```ts
type DomainEvent<T> = {
  eventId: string;
  eventType: string;
  eventVersion: 1;
  aggregateType: string;
  aggregateId: string;
  organizationId: string;
  actor: { type: "agent" | "client" | "system"; id: string };
  occurredAt: string;
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;
  before: unknown;
  after: unknown;
  payload: T;
};
```

Payloads are versioned. Consumers reject unsupported versions. An idempotency key is
unique inside an organization and command boundary; retries return the original result.

## Pilot events

| Event | Aggregate | Minimum payload | Projection/side effect |
| --- | --- | --- | --- |
| `case.created.v1` | Case | case ID, contact roles | case list |
| `intake.completed.v1` | Case | normalized intake snapshot | next action |
| `scenario.selected.v1` | Case | key, version | document/task checklist |
| `quote.draft_saved.v1` | Quote | draft revision, checksum | agent draft only |
| `quote.published.v1` | Quote | immutable version ID, total, checksum | client pointer; close task once |
| `quote.accepted.v1` | Quote | version ID, client actor/evidence | agreement status |
| `contract.created.v1` | Contract | quote version ID | contract task |
| `contract.sent.v1` | Contract | channel, recipient | timeline |
| `contract.signed.v1` | Contract | signer, signed version/evidence | payment obligation |
| `payment.recorded.v1` | Payment | amount, currency, method, obligation ID | balance projection |
| `payment.corrected.v1` | Payment | original entry ID, signed delta, reason | balance projection |
| `document.version_uploaded.v1` | Document | requirement ID, checksum, storage ID | verification task |
| `document.verified.v1` | Document | document version ID, reviewer | readiness projection |
| `document.rejected.v1` | Document | document version ID, reason | re-upload task |
| `meeting.scheduled.v1` | Meeting | starts at, participants | calendar |
| `meeting.outcome_recorded.v1` | Meeting | outcome, next action | case timeline/tasks |
| `meeting.escalated.v1` | Meeting | scheduled time, reason | attention queue |
| `task.created.v1` | Task | title, due at, source event ID | task list |
| `task.completed.v1` | Task | task ID, completion source | task/case projections |
| `case.closed.v1` | Case | scenario, closing snapshot IDs | archive |
| `access.changed.v1` | Access policy | subject, resource, previous/new scope | access audit projection |

Sensitive content stays in aggregate storage. Events carry references/checksums unless
the field is explicitly approved for the event log.
