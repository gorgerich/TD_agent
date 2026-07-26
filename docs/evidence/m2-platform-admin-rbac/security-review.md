# M2 security review

- Privilege escalation: no organization endpoint accepts or updates
  `User.platformRole`; bootstrap requires existing password-enabled user,
  confirmation, direct target guard, and reviewed fingerprint.
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
- Secret scan: no credentials, DSN, session cookie, invite token, or `.env` file
  is tracked by this change.

P0/P1 findings after review: 0.
