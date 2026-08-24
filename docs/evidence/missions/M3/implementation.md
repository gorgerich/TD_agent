# M3 implementation record

## Contract lock

Mission `M3-FULFILMENT-MONEY-TRUST` is implemented from base
`20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`. The certified source tree is
`a917a1f10b959b80cd4e0a249a2d2281e0bba106`.

Read-only baseline verification identified Production deployment
`dpl_AkdiVtTqDjsvnX4nS3k4yKbez61g`, Production database fingerprint
`0257665af2dd90a4`, and `RELEASE_WRITE_FREEZE=disabled`. Production was not used
for tests and no Production data, schema, environment, or deployment was changed.

## Product outcome

### Family and parties

- A Case owns stable party records and independent role assignments for applicant,
  decision maker, payer, responsible-for-burial, and additional-contact roles.
- One person can hold multiple effective roles without name-based linkage.
- Contact values use the existing encrypted platform adapter. Consent provenance,
  communication preference, validity, and role changes are auditable.
- Religion and other special-category data remain absent and fail closed.

### Scenario requirements and documents

- Versioned policy and rule records produce different requirement sets for cremation
  and burial in a family plot.
- Unapproved rules are not represented as legal truth. Production activation requires
  an explicit reviewed policy command.
- Upload creates a quarantined DocumentVersion. Upload never means verified.
- Scan, review, rejection, expiry, replacement, and supersession preserve history.
- Only the latest applicable clean, reviewer-verified version satisfies a requirement.
- Rejection creates owned follow-up work with reason and deadline.
- Private storage is accessed through server-authorized, audited, short-lived reads;
  permanent object URLs are not returned.

### Contract and money truth

- ContractVersion snapshots one accepted QuoteVersion, parties, payer, terms,
  currency, checksum, and signing evidence boundary.
- Quote acceptance and contract signing are distinct states.
- PaymentObligation is immutable. PaymentLedgerEntry is append-only for obligation,
  payment, refund, correction, and reversal facts.
- Payment status is derived from obligation and ledger. The reference case 176,000 RUB
  less 88,000 RUB is `PARTIALLY_PAID` with an 88,000 RUB balance.
- Corrections and reversals preserve original entries. Sensitive adjustments use a
  persistent two-person approval workflow; requester cannot approve their own entry.
- Manual and webhook paths use persistent idempotency, payload conflict detection,
  evidence references, and signed webhook receipts.

### Workspaces and guards

- Finance and Document Reviewer are separate organization roles and capabilities.
- Finance responses exclude family notes and document content. Reviewer responses
  exclude ledger, margin, and unrelated family context.
- Case stage readiness is derived from approved scenario requirements, verified
  documents, signed contract evidence, immutable obligation, ledger balance, and
  unresolved review/reconciliation blockers.
- Case transitions remain centralized and cannot be opened by upload count or a
  client-provided payment status.
- Reconciliation is diagnostic and fail closed. It does not silently repair financial
  or document truth.

### Failure and command recovery

- API, storage, and canonical-read failures render explicit error or recovery states,
  never empty success, verified, or paid.
- Mutations retain an exact command envelope across an uncertain transport/5xx result.
  The same path, serialized body, and command ID are replayed; non-retryable 4xx
  responses unlock controls and discard the stale envelope.
- Document review uses synchronous single-flight protection so concurrent UI actions
  cannot overwrite another command's recovery state.

## Permission matrix

| Role | Case and party scope | Documents | Finance | Sensitive mutations |
| --- | --- | --- | --- | --- |
| AGENT | own/assigned organization work | upload and read authorized Case status | derived Case summary | no review or ledger approval |
| MANAGER | organization operational scope | requirement status | derived summary | operational assignment only |
| ADMIN | organization administration | policy/read status | derived summary | no reviewer or Finance bypass |
| DOCUMENT_REVIEWER | minimum Case reference only | queue, inspect, verify, reject, escalate | none | document decisions only |
| FINANCE | payer and obligation minimum | evidence reference only | ledger, refunds, adjustments, reconciliation | finance commands with MFA and four-eyes rules |

Every server route derives `organizationId` from a current active Membership loaded from
PostgreSQL. Client-supplied tenant identifiers cannot widen scope.

## Non-goals and human boundaries

Production payment/KKT provider onboarding, legally binding electronic-signature policy,
automatic approval of ritual/legal requirements, religion/special-category processing,
destructive legacy cleanup, and Production release are not part of this implementation.
The technical candidate is complete; Finance, Legal/Privacy, and Ritual SME verdicts remain
human-only gates.
