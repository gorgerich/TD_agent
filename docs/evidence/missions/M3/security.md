# M3 security evidence

## Tenant and role boundaries

- Every M3 route starts from a server-hydrated operational context. Current Membership role,
  status, Organization status, and Agent status are read from PostgreSQL.
- Organization identity is not accepted as authority from client input.
- Cross-tenant Case, document, party, contract, obligation, ledger, reviewer, Finance, and
  reconciliation access returns a safe denial without revealing foreign data.
- `DOCUMENT_REVIEWER` and `FINANCE` are purpose-specific organization roles. Reviewer responses
  omit ledger, family notes, and commercial economics; Finance responses omit document content
  and unrelated family notes.
- Finance mutation login requires the existing MFA boundary.

## Document boundary

- Storage keys are private and tenant/Case scoped. Permanent file URLs are not returned.
- Reads pass server authorization and create an access event before streaming/proxying data.
- Upload checks size, type, sanitized filename, and checksum, then enters quarantine.
- Missing or failed malware scanning is fail closed. The local/Preview scanner proves the
  contract, but no Production malware-provider PASS is claimed.
- Reject, expiry, and supersede preserve all previous versions.

## Ledger and provider boundary

- Business UPDATE/DELETE operations for ledger history do not exist.
- Manual entries require role, payer, source/evidence, reason, occurrence time, correlation,
  and idempotency.
- Webhooks require signature verification, event version, and a persistent replay receipt.
- Same key with changed payload is a conflict. Concurrent or repeated identical commands create
  one domain result and one side-effect set.
- Correction/reversal approval is persistent and two-person. An absent human-approved threshold
  leaves sensitive actions pending rather than inventing a policy.

## Client recovery and audit

- Uncertain transport/5xx responses retain the exact path/body/command ID and label the commit
  state unconfirmed. Retry sends that exact envelope.
- Non-retryable 4xx responses clear recovery and unlock editing.
- Document mutations are single-flight so one command cannot replace another command's recovery.
- Actor, timestamp, before/after, correlation, idempotency, and target are recorded for business
  mutations. Passwords, tokens, provider secrets, raw payloads, permanent file URLs, and document
  contents are excluded.

## Review result

Independent review of exact source SHA `a917a1f10b959b80cd4e0a249a2d2281e0bba106`
reported P0=0, P1=0, P2=0. Exact Preview negative tests reported cross-tenant access=0,
unexpected 5xx=0, document reconciliation=0, and payment reconciliation=0.
