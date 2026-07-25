# Mission 1 security contract

## Permission matrix

| Capability | Agent | Manager / Dispatcher | Admin / Auditor |
| --- | --- | --- | --- |
| Read own assigned operational records | allow | allow | allow |
| Read organization team queue | deny | allow | allow |
| Create/update own task and meeting | allow | allow | deny by default |
| Assign/reassign within organization | deny | allow | deny by default |
| Read immutable operational audit | own context only | organization | organization |
| Manage invitations/memberships | deny | deny | allow |
| Cross-organization access | deny | deny | deny |

Admin/Auditor is read-only for operational records in M1. Reserved future roles do
not receive routes or UI.

## Enforcement rules

- Active `Membership` is loaded from the database for every protected M1 query and
  mutation.
- Resource `organizationId` must match membership organization before role checks.
- Agent read/write scope is additionally limited to assigned records.
- Manager assignment targets must be active memberships in the same organization.
- Denials use safe 403/404 responses and never disclose another tenant's records.
- UI visibility is convenience only; server authorization is authoritative.
- Open production registration cannot create an `ACTIVE` membership or Agent.
- Invitations are single-use, expiry-bound, hashed at rest and tenant-scoped.
- Sensitive values and family notes are excluded from operational audit payloads.

## Required negative tests

- Cross-tenant Task and Meeting reads, writes, assignments and saved-view access.
- Agent attempting manager actions.
- Suspended/inactive membership access.
- Forged cookie role differing from database membership.
- Replay and optimistic-version conflict behavior.
- Invitation reuse, expiry and wrong-recipient attempts.

## Verification result

Status: `PASS` on `a2c1f603e8ae2e506be981de265b75d9373a5387`.

- Cross-tenant, forged-role, inactive-membership and wrong-assignee paths are
  denied by server-side membership context.
- Agent access to Team Control Tower is denied; Manager assignment is constrained
  to active same-organization memberships.
- Invitation and open-registration guards pass their negative tests.
- Optimistic conflict and idempotent replay behavior pass integration and
  authenticated Preview UAT.
- Operational audit stores redacted structured state; secrets and family-sensitive
  free text are not added to immutable payloads.
- Secrets scan found no credentials, connection strings, cookies or tokens.
- `RISK-W1-TECH-HUMAN-REVIEW` remains open and is not waived by M1.
