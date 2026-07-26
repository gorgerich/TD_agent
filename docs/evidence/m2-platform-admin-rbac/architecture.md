# M2 architecture summary

## Decision

M2 adds two independent authorization dimensions:

- `User.platformRole`: `USER | SUPER_ADMIN`
- `Membership.role`: `AGENT | MANAGER | ADMIN`

`SUPER_ADMIN` can authenticate without `Agent`, `Membership`, or `Organization`.
Organization `ADMIN` remains tenant-scoped and cannot read or mutate platform roles.

## Contexts

1. Authenticated user context identifies the current `User`.
2. Platform context reloads `User.platformRole` from PostgreSQL.
3. Operational context reloads active `Membership`, `Organization`, and `Agent` state from PostgreSQL.

Cookie claims contain selectors only. Roles and statuses are never authorization
sources.

## Suspension

`Organization.status=SUSPENDED` and `Membership.status=SUSPENDED` block operational
context hydration. No tenant data is deleted. Platform administration remains
available only to `SUPER_ADMIN`.

## Audit separation

Global actions use `PlatformAuditEvent`. Tenant actions use
`OperationalAuditEvent`. Secret-bearing metadata keys are removed before global
audit persistence.

See [ADR-M2-PLATFORM-ADMIN-RBAC](../../../adr/ADR-M2-PLATFORM-ADMIN-RBAC.md).
