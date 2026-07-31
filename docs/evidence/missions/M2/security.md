# M2 security contract

## Client-link threat model

- Link tokens carry no name, phone, email, sequential ID or tenant identifier.
- Only a one-way token digest is stored.
- Links are scoped to one immutable published version, expire, can be revoked,
  and are protected by persistent rate limits.
- Unknown and revoked links are indistinguishable (404 / UNAVAILABLE). Expired and superseded links report an honest state (410 / 409) so the family can ask for a current link; neither discloses draft data, tenant identity or organization status. Acceptance M2-W5-06 requires exactly this distinction, so equivalence would be a defect, not a hardening.
- A superseded link may disclose only that a newer version exists and how to
  contact the agent; it never reveals draft data.
- The first release uses possession of the high-entropy link as the client
  capability. OTP is not added without a verified client identity channel.

## Server boundaries

- Operational reads and writes are tenant-scoped from the server session.
- Roles in cookies are not authorization facts.
- Client routes never expose cost, margin, internal audit metadata or case PII.
- All decisions and publishes require correlation and idempotency identities.
- Public routes never read `AgentSession` as quote truth.
- No business error is converted to an empty-success response.

Status: threat model locked; adversarial verification pending.
