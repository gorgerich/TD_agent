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
- Production migration and deployment are authorized only through the controlled
  release gate; they remain not performed at this evidence head.
- The existing real owner has not yet completed controlled password recovery
  and TOTP enrollment in Production. The operation remains gated by migration,
  deployment and protected local bearer delivery.
- Operator-created/revoked owner-recovery audit events use the target owner as
  actor because the current audit schema requires a non-null `actorUserId`.
  Metadata records `source=trusted-operator`; a distinct system/operator
  principal is deferred.
- Portfolio mission `M2 Commercial Trust Loop` remains `NOT_STARTED`.
