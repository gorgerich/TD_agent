# M2 security contract

## Client-link threat model

- Link tokens carry no name, phone, email, sequential ID or tenant identifier.
- Only a one-way token digest is stored.
- Links are scoped to one immutable published version, expire, can be revoked,
  and are protected by persistent rate limits.
- Unknown and revoked links are indistinguishable (404 / UNAVAILABLE). Expired links report
  an honest state (410) so the family can ask for a current link. A link invalidated by a
  newer version is revoked at publish time and also returns 404. None of these states
  discloses draft data, tenant identity, or organization status. Distinct SUPERSEDED copy is
  a recorded P2 product improvement, not a weaker security boundary.
- If a future client view distinguishes a superseded version, it may disclose only that a
  newer version exists and how to contact the agent; it must never reveal draft data.
- The first release uses possession of the high-entropy link as the client
  capability. OTP is not added without a verified client identity channel.

## Server boundaries

- Operational reads and writes are tenant-scoped from the server session.
- Roles in cookies are not authorization facts.
- Client routes never expose cost, margin, internal audit metadata or case PII.
- All decisions and publishes require correlation and idempotency identities.
- Public routes never read `AgentSession` as quote truth.
- No business error is converted to an empty-success response.
- Internal cost-only rows are identified by a strict source/type/price/relation shape and
  are filtered from presentation and client projections. A billed row remains visible even
  if a caller spoofs the internal source marker.
- Published read models fail closed when snapshot JSON, Quote/version identity or checksum
  does not match. They do not reconstruct family-visible history with current rules.
- A failed canonical Quote read cannot trigger autosave or any manual builder mutation; retry
  restores write controls only after a successful server read.
- Async review, presentation, publish and client-link continuations re-check the exact
  canonical-read authority after every awaited boundary. Unmount, route change and failed
  refresh revoke that authority before any follow-on mutation or stale success state.
- Async error feedback, clipboard completion, delayed toast cleanup and pending-state
  finalizers are guarded by the same authority, preventing cross-route UI state leakage.
- Success and non-success save responses re-check authority after asynchronous body parsing;
  response headers alone cannot retain write or UI authority across a route change.

Status: released threat model verified. Post-release repair unit and integration security
tests PASS; cross-tenant browser smoke PASS; independent repair review recorded in
`review.md`.
