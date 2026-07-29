# Known limitations

- No impersonation. Platform administration does not grant case-content access.
- No UI for assigning or revoking `SUPER_ADMIN`; trusted bootstrap only.
- Activation and MFA enrollment rate limits use persistent database-backed
  buckets and fail closed with a retryable response when the limiter store is
  unavailable.
- One active operational membership is selected per session. Workspace switching
  for users with multiple memberships is deferred.
- Invitation delivery transport is not part of M1 RBAC Hardening. UI produces a one-time secure
  registration link for an administrator to deliver through an approved channel.
- Organization suspension is reversible; destructive organization deletion is
  intentionally absent.
- Production migration and deployment completed through the controlled release
  gate on 2026-07-29.
- The existing real owner completed controlled password recovery and mandatory
  TOTP enrollment in Production. The bearer was delivered only through
  protected local storage and consumed once.
- Operator-created/revoked owner-recovery audit events use the target owner as
  actor because the current audit schema requires a non-null `actorUserId`.
  Metadata records `source=trusted-operator`; a distinct system/operator
  principal is deferred.
- Portfolio mission `M2 Commercial Trust Loop` remains `NOT_STARTED`.
