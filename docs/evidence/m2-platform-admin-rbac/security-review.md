# M2 security review

- Privilege escalation: no organization or activation endpoint accepts or
  updates `User.platformRole`; bootstrap requires explicit confirmation, direct
  target guard, reviewed fingerprint and protected activation-output
  confirmation for a user without credentials.
- Horizontal tenant escalation: member and invite mutations derive
  `organizationId` from fresh operational context and return 404 for foreign IDs.
- Mass assignment: all new inputs use bounded Zod schemas.
- Cookie role forgery: cookie role is ignored; database roles and statuses are
  reloaded for every context.
- Stale access: membership, organization, agent, and platform-role changes take
  effect on the next request.
- Invite token leakage: list API excludes token hash and raw token; a new raw
  token is returned once only on create/resend.
- Last-admin lockout: demotion or suspension of the final active organization
  ADMIN returns 409.
- Platform overexposure: platform API selects organization, membership, user,
  agent-status, and audit metadata only. It does not select cases, documents,
  payments, password hashes, OTP hashes, or invite hashes.
- Cache leakage: platform pages are `force-dynamic` and each data page performs
  its own server-side platform guard.
- Audit secrets: recursive sanitizer removes password/hash/token/cookie/OTP/
  secret/document/family/deceased keys.
- Activation bearer: 32 random bytes; only SHA-256 stored. Raw value exists
  only in one confirmed operator output and a URL fragment removed immediately
  by the client. It is absent from DB, audit metadata and normal logs.
- Activation replay/enumeration: invalid, expired, revoked and consumed tokens
  receive the same response; token is consumed atomically; verification and
  activation endpoints are separately rate-limited.
- Password setup: server validates length, confirmation and obvious values;
  existing PBKDF2 implementation is reused; password hashing completes before
  the write transaction and plaintext is never persisted.
- Secret scan: no credentials, DSN, session cookie, invite token, or `.env` file
  is tracked by this change.

Independent final diff review found no weaker hashing, role mass assignment,
non-atomic credential write, broad token disclosure or production behavior
outside the activation flow. P0/P1 findings: 0.
