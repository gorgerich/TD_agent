# M2 Commercial Trust Loop

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
