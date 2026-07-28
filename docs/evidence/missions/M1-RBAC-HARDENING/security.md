# Platform Admin RBAC security evidence

- Platform role and organization role are separate authorization dimensions.
- Cookie payload does not grant platform or organization capabilities.
- Every protected request reloads current database role and status.
- Every SUPER_ADMIN request requires a current database role and an
  MFA-verified session.
- Platform-role elevation increments `sessionVersion`, invalidating sessions
  issued before the trusted bootstrap.
- Explicit session revocation increments `sessionVersion`.
- Platform endpoints require server-side SUPER_ADMIN authorization.
- Organization mutations derive tenant scope from server context.
- Client-controlled `organizationId` and `platformRole` are rejected.
- Last-active-ADMIN invariant is enforced server-side.
- Invite and activation tokens are stored only as hashes.
- Invitation bearer transport uses the URL fragment and is removed before
  application navigation.
- Activation and MFA enrollment rate limits are persisted as one-way bucket
  hashes in the database.
- Raw activation token is emitted only through confirmed non-CI operator output.
- Activation errors do not reveal token state.
- Passwords, hashes, cookies, tokens and sensitive case content are excluded from
  audit metadata and logs.
- Platform administration does not grant global access to case contents.
- Activation infrastructure failures return retryable `503` without consuming
  retry context.
- Independent review result for runtime commit: P0 `0`, P1 `0`.
