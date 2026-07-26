# Known limitations

- No impersonation. Platform administration does not grant case-content access.
- No UI for assigning or revoking `SUPER_ADMIN`; trusted bootstrap only.
- Activation rate limiting is per serverless instance. High-entropy,
  single-use, short-lived tokens remain the primary control; a distributed
  rate-limit store is deferred.
- One active operational membership is selected per session. Workspace switching
  for users with multiple memberships is deferred.
- Invitation delivery transport is not part of M2. UI produces a one-time secure
  registration link for an administrator to deliver through an approved channel.
- Organization suspension is reversible; destructive organization deletion is
  intentionally absent.
- Production migration and production deployment are explicitly out of scope for
  this mission and require a separate owner-authorized release gate.
- The real first owner account has not been provisioned or activated in
  Production. That operation remains blocked pending separate approval.
