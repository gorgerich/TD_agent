# M2 Commercial Trust Loop

Status: `RELEASED`. The inventory below is the historical contract-lock analysis that led
to the released aggregate.

## Contract lock

M2 owns the commercial path from an operational Case to an immutable client
decision. It absorbs Week 4 and Week 5 acceptance requirements. Platform Admin
and organization RBAC remain released under `M1-RBAC-HARDENING` and are not
reimplemented here.

## Current-state inventory

| Surface | Current source | Contract defect |
| --- | --- | --- |
| Estimate registry | latest `QuoteVersion` plus `Order` | Agent-scoped query, silent empty fallback, latest save treated as sent |
| Builder | client state plus `calculationUtils` | client supplies total, every save creates a version, local-only snapshots |
| Live presentation | `AgentSession` by meeting code | presentation and client truth share a public route |
| Client view | `AgentSession`, then latest `QuoteVersion` | unpublished draft can win; client recomputes totals |
| Accept | `Meeting.coAgreedAt` | not bound to version, no immutable receipt or correlation |
| Catalog | `AgentCatalogItem` | tenant is Agent, unknown price/cost represented as zero, no source version |
| Case | `publishedQuoteVersionId` | pointer exists without canonical lifecycle service |
| Print/PDF | no stable commercial snapshot | no version-bound reproducible output |

## Locked aggregate

- `Quote` is tenant- and Case-owned and carries scenario and lifecycle.
- One mutable active draft belongs to a Quote.
- `QuoteVersion` is the immutable published snapshot and receives a sequential
  version number.
- `QuoteLineItem` snapshots description, quantity, unit, price state, cost state,
  source version and package/replacement semantics.
- Published totals are computed from line-item minor units on the server.
- Client links are opaque, hash-only, version-bound, expiring and revocable.
- Client decisions are append-only, version-bound and idempotent.
- Presentation state is explicit and never publishes or mutates a published
  version.

## Lifecycle

`DRAFT -> IN_REVIEW -> PUBLISHED -> ACCEPTED | REJECTED | EXPIRED | SUPERSEDED`

Only the canonical domain service may execute transitions. Publishing is
blocked by unknown client prices and incompatible scenario items. Unknown cost
does not block publication but suppresses margin.

## Mutation ownership

| Action | Agent | Manager | Admin | Client link |
| --- | --- | --- | --- | --- |
| Read own/assigned commercial work | yes | tenant-wide | tenant-wide | published version only |
| Edit draft | own/assigned | tenant-wide | tenant-wide | no |
| Review/publish | own/assigned | tenant-wide | tenant-wide | no |
| Revoke/share link | own/assigned | tenant-wide | tenant-wide | no |
| Accept/request changes | no | no | no | exact published version |
| Read cost/margin | own/assigned | tenant-wide | tenant-wide | never |

All server queries derive `organizationId` from operational context. Client
input cannot select a tenant.

## Non-goals

- Marketplace, vendor settlement and procurement automation.
- Contract and payment redesign.
- Platform-admin access to sensitive case contents.
- Production migration or release in this implementation mission.

## Post-release economics truth repair

Audit base: `f6f3f17e984d7b1baaff619c9bcf063933e63e05`.

Repair source: `12cf2b3b6950cd320b237954871e8fbe44c70d2c`.

- `calculateCommercialEconomics` is now the shared internal projection for total, cost,
  margin, and per-line economics.
- Unknown price keeps the client total and margin unknown; a partial subtotal is diagnostic
  only and never becomes the displayed total.
- Margin-only external expenses remain canonical cost lines with zero client contribution.
- A strict source/type/price/relation shape identifies internal cost-only lines; billed lines
  cannot be hidden by the source marker alone.
- Internal cost-only lines are omitted from presentation and client projections.
- Builder economics hydrates from the server QuoteVersion when local editor state is
  unchanged, so incomplete legacy editor JSON cannot invent a different total.
- The Versions tab reads immutable QuoteVersion rows. Local deletable snapshots were removed.
- Published history and client projection verify the stored snapshot checksum and read totals,
  lines and editor state from that immutable payload. Current calculator rules cannot rewrite
  an already published version.
- A failed canonical Quote read hides the local total and blocks autosave, manual save, review
  and presentation. A visible retry restores writes only after a successful canonical read.
- Every staged commercial action is bound to the successful canonical-read generation that
  authorized it. Route change, unmount, retry, or failed post-publish refresh invalidates that
  generation before a second mutation or a stale client-link action can run.
- Async failure/success feedback and pending-state cleanup use the same authority check, so a
  rejected request from a previous route cannot show a false toast or clear state on the next
  Quote.
- Save responses re-check authority after asynchronous response-body parsing on both success
  and non-success branches. Receiving headers is not treated as lasting write authority.
- Requested or otherwise unconfirmed secondary prices cannot surface a subtotal or tariff
  delta from stale editor values.
- The four calculator tabs use stable responsive tracks; the save action and icon-first mobile
  dock remain separate and visible at a 195 px CSS viewport, equivalent to 200 percent browser
  zoom on a 390 px device.
- No migration, schema, authentication, tenant, or production behavior outside the
  commercial read/write model was changed.
