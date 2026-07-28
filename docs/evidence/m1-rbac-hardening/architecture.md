# M1 RBAC Hardening architecture summary

## Decision

M1 RBAC Hardening adds two independent authorization dimensions:

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

## First platform owner activation

Trusted bootstrap may create a platform-only `User` with
`platformRole=SUPER_ADMIN` and `passwordHash=null`. It creates a 30-minute
`PlatformAccountActivation` whose database representation contains only a
SHA-256 token digest. The raw 32-byte token is emitted once to a confirmed
non-CI operator and placed in a URL fragment.

`/setup/platform-admin` removes that fragment immediately, verifies the token
through a rate-limited server route, and uses the existing PBKDF2 password
format. Token consumption, password assignment and audit append commit in one
transaction. The resulting ordinary v2 session redirects to `/platform-admin`.

See [ADR-M1-RBAC-HARDENING](../../adr/ADR-M1-RBAC-HARDENING.md).
