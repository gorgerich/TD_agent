# Current-state inventory and source ownership

Audit date: 2026-07-13. Branch: `redesign/product-audit`.

## Runtime inventory

| Surface | Current implementation | Current owner | Required canonical owner | Gap |
| --- | --- | --- | --- | --- |
| Case list/detail | `/agent/cases`, `/agent/cases/[id]` | `ClientLead` plus derived UI rules | Case aggregate + projections | `ClientLead` is overloaded; no explicit lifecycle/tenant. |
| Meetings | `/agent/calendar`, meeting APIs | `Meeting` | Meeting aggregate/outcome event | Past `SCHEDULED` can remain unresolved. |
| Quote builder | `/agent/meetings/[id]/quote` | `AgentSession.state`, `QuoteVersion.payload` | Quote aggregate with draft/published versions | Draft and publication are not distinct. |
| Client co-view | `/co/[code]`, `/api/co/[code]` | live session preferred over saved version | Published immutable Quote Version | Current read order leaks transient draft. |
| Payments | case payment routes and `CasePayment` | mutable rows | Append-only Payment Ledger | DELETE endpoint exists; paid status can disagree with balance. |
| Documents | case document routes and `Document` | uploaded row | Requirement + immutable version + verification | Upload and verification not represented separately. |
| Tasks | case task routes and `Task` | mutable rows / seed | Task projection from domain events + manual tasks | No source event/idempotency identity. |
| Catalog | agent catalog routes | `AgentCatalogItem` | Versioned catalog policy | Unknown cost defaults to zero. |
| Demo data | `prisma/seed.ts` | destructive scoped reseed, partly random | deterministic isolated fixture set | Random dates/notes and shared DB risk. |

## API mutation inventory

- Auth: register, login, logout, OTP, demo login, onboarding, password/notification settings.
- Cases: create/read lead, update intake, add/delete note, add/update/delete task,
  upload/delete document, add/delete payment.
- Meetings: create/read/update and transient session read/write.
- Quotes: save a new `QuoteVersion`; no explicit publish command.
- Co-view: read live/saved quote, mutate live attributes, agree.
- Catalog: list/create/delete.
- Webhook: order completion.

All mutations currently live in route handlers. There is no canonical domain mutation
service and no shared event envelope.

## Page route inventory

| Area | Routes |
| --- | --- |
| Agent work | `/agent/cases`, `/agent/cases/[caseId]`, `/agent/tasks`, `/agent/documents`, `/agent/estimates` |
| Meetings | `/agent/meetings`, `/agent/meetings/new`, `/agent/meetings/[meetingId]`, `/agent/meetings/[meetingId]/quote` |
| Catalog/configuration | `/agent/catalog`, `/agent/catalog/my`, `/agent/configurator` |
| Account | `/agent/login`, `/agent/settings` |
| Legacy/compatibility | `/agent/dashboard`, `/agent/leads`, `/agent/leads/new`, `/agent/leads/[leadId]`, `/agent/commissions` |
| Client | `/co/[code]` |

## API route inventory

| Method | Route | Direct state touched |
| --- | --- | --- |
| GET, POST | `/api/agent/leads` | `ClientLead` |
| GET | `/api/agent/leads/[leadId]` | `ClientLead` graph |
| PATCH | `/api/agent/cases/[caseId]/intake` | `ClientLead` |
| POST | `/api/agent/cases/[caseId]/notes` | `CaseNote` |
| DELETE | `/api/agent/cases/[caseId]/notes/[noteId]` | `CaseNote` |
| POST | `/api/agent/cases/[caseId]/tasks` | `Task` |
| PATCH, DELETE | `/api/agent/cases/[caseId]/tasks/[taskId]` | `Task` |
| POST | `/api/agent/cases/[caseId]/documents` | Blob storage, `Document` |
| DELETE | `/api/agent/cases/[caseId]/documents/[docId]` | Blob storage, `Document` |
| POST, DELETE | `/api/agent/cases/[caseId]/payments` | `CasePayment` |
| GET, POST | `/api/agent/meetings` | `Meeting` |
| GET, PATCH | `/api/agent/meetings/[meetingId]` | `Meeting` |
| GET, PUT | `/api/agent/meeting/[meetingId]/session` | `AgentSession` |
| POST | `/api/agent/meeting/[meetingId]/quote` | `Quote`, `QuoteVersion` |
| GET, PATCH | `/api/co/[code]` | `AgentSession`, `QuoteVersion`, `Meeting` |
| POST | `/api/co/[code]/agree` | `Meeting` agreement timestamp |
| GET, POST | `/api/agent/catalog` | `AgentCatalogItem` |
| DELETE | `/api/agent/catalog/[id]` | `AgentCatalogItem` |
| GET | `/api/agent/commissions` | `Commission` |
| POST | auth/onboarding/settings routes | `User`, `Agent`, OTP/settings fields |
| POST | `/api/webhooks/order-complete` | order/payment/commission flow |

## Persistence inventory

| Current model/store | Role today | Ownership risk |
| --- | --- | --- |
| `User`, `Order`, `Payment` | Shared B2C order/payment core | Shared-environment coupling; not a Case ledger. |
| `Agent`, `AgentTier` | Agent identity/tier | No organization/tenant aggregate. |
| `ClientLead` | Lead, Case, deceased and intake fields | Overloaded aggregate, agent-scoped only. |
| `Meeting` | Schedule, co-view token, agreement timestamps | Carries quote access and agreement side effects. |
| `Quote`, `QuoteVersion` | Saved quote snapshots | No explicit draft/published/current pointer. |
| `AgentSession` | Encrypted live quote/presentation JSON | Transient state currently leaks into client truth. |
| `Task`, `CaseNote` | Case work and notes | Mutable rows, no event source/version. |
| `CasePayment` | Case payment records | Mutable/deletable, no obligation or reversal. |
| `Document` | Uploaded blob metadata | No requirement/version/verification state. |
| `AgentCatalogItem` | Agent-specific item and pricing | `costPrice` defaults to zero. |
| `Signature`, `Commission`, `Payout` | Secondary commercial flows | Not bound to canonical Case state model. |
| Auth cookie | Agent session | Authentication only; not business state. |
| React component state | Quote builder working UI | Draft/presentation state only. Must not be client truth. |
| Blob storage | Document bytes | Requires immutable version/checksum linkage. |

## Seed inventory

`prisma/seed.ts` deletes and recreates rows scoped to the demo agent. It uses current
time, random IDs and random note presence. It is demonstration data, not a deterministic
test fixture and must not run in CI or production pilot data. Week 1 tests instead use
`tests/fixtures/productTruth.ts`; integration CI creates rows only in ephemeral
`td_agent_test` and removes rows by the `it-` test-agent prefix.

## Required sources of truth

| Projection | Source of truth | Derivation |
| --- | --- | --- |
| Case stage | Case state + selected scenario policy | Guarded transition events only. |
| Next action | Open projected tasks + scenario policy | Highest-priority actionable task, stable tie-break. |
| Risk | Deadline/document/payment/meeting projections | Versioned deterministic rules; no seed-only badge. |
| Payment status | Payment ledger and obligation amount | `paid = sum(valid entries) - reversals`; partial is not paid. |
| Document readiness | Requirements + latest verified document versions | Uploaded alone never satisfies requirement. |
| Quote status | Quote aggregate and published version pointer | Draft, published, accepted and superseded are distinct. |

## Known P0 contradictions

1. `/api/co/[code]` reads `AgentSession` before saved quote: draft leakage.
2. Unknown catalog cost defaults to `0`: false margin.
3. Unknown/display-on-request price can collapse to `0`: false client total.
4. Estimate list total can disagree with opened builder/session state.
5. Quote publication does not idempotently close its related task.
6. Partial advance can coexist with order status `PAID`.
7. `DELETE /api/agent/cases/:caseId/payments` destroys financial history.
8. Uploaded documents have no verification state; counts can disagree by surface.

These are documented, not fixed by this Week 1 inventory. Runtime remediation starts
only after the state model and ADR are approved.
