# ADR M2: Platform Admin and organization RBAC

Status: accepted for isolated implementation  
Date: 2026-07-26

## Context

M1 introduced tenant-scoped `Organization`, `Membership` and operational
authorization. Authentication still assumes every authenticated user has an
`Agent`, and the signed cookie carries an operational role. That model cannot
represent a platform owner without an agent profile and risks treating stale
cookie claims as authorization.

## Decision

Access has three independent server-hydrated contexts:

1. Authenticated user: identity from a signed, expiring cookie, then current
   `User` loaded from PostgreSQL.
2. Platform context: current `User.platformRole`; only `SUPER_ADMIN` receives
   platform capabilities.
3. Operational context: active `Membership`, active `Organization` and active
   `Agent`, all loaded from PostgreSQL for every request.

`MembershipRole.ADMIN` remains an organization role. It never grants platform
capabilities. `PlatformRole.SUPER_ADMIN` does not require an `Agent`,
`Membership` or `Organization`.

Session v2 stores `userId`, optional `activeMembershipId`, version and
timestamps. Legacy session fields remain parseable during rollout, but roles
are never trusted from the cookie.

Platform administration has a separate append-only `PlatformAuditEvent`.
Tenant administration continues to use `OperationalAuditEvent`.

`OrganizationStatus.SUSPENDED` is enforced by operational context hydration,
invitation acceptance, tenant APIs and UI. Suspension preserves all data and
does not affect unrelated B2C users.

## Authorization

- Platform APIs and server components call `requirePlatformAdmin`.
- Tenant APIs call `requireOperationalContext` and a capability check.
- Resource queries always include server-derived `organizationId`.
- Cross-tenant lookups return `404`.
- Last active organization `ADMIN` cannot be demoted or suspended.
- No tenant endpoint accepts or changes `platformRole`.

## Bootstrap

`ops:bootstrap-platform-super-admin` upgrades only an existing User selected by
normalized `PLATFORM_SUPER_ADMIN_EMAIL`. It requires:

- `CONFIRM_PLATFORM_ADMIN_BOOTSTRAP=YES`;
- reviewed `EXPECTED_DATABASE_FINGERPRINT`;
- a direct, writable database target.

It is idempotent, creates one safe platform audit event on the first role
change, and never creates a password or user.

## Rollout

Migration is additive:

- add `PlatformRole` and `User.platformRole` defaulting to `USER`;
- add `OrganizationStatus` and `Organization.status` defaulting to `ACTIVE`;
- add `PlatformAuditEvent`.

Validation runs only against isolated test and preview databases. Production
migration and deployment require a separate owner-authorized release.

## Consequences

- Existing Agent and Manager cookies continue to hydrate while sessions rotate
  to v2.
- Platform administrators can exist without operational data.
- Suspending a membership or organization invalidates operational access on
  the next request, without waiting for cookie expiry.
- Impersonation and sensitive case-content access are intentionally absent.
