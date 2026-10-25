# Proposed Finance, Legal/Privacy And Ritual Decisions

October25 current engineering context: source87 / deployment `dpl_BEWbq9cvrLidRFhdDXKu5gsGNPP6`; see [fresh scoped native evidence](pr39-87-preview.json). The48/8a binding below records the original dated draft, not fresh acceptance or a signed policy. Recommendations remain DRAFT_UNAPPROVED; no professional identities, fingerprints or signatures have been registered by this update.

Status: DRAFT_UNAPPROVED. Prepared for qualified review, not a verdict, signature, policy activation or rollout instruction. Every recommendation below remains unapproved. This file changes no policy, application setting, human attestation or gate.

Binding: PR39; executable candidate `48eef7cd34b4cc2f9898dadf4506a32da8699962`; final evidence head `8a7115e1ffe9d06dd14c47d3e52595bd3de7ef78`; base `91ae4fb23b8f87c0574ccec23708daeabdc50fc9`. The final evidence head has the same executable tree as candidate48. These recommendations are not the policies used by synthetic fixtures and do not authorize real records.

## Decision Authority

The owner can choose supported product scope, staffing, operating channels, customer offer and authorized infrastructure budget. Qualified Finance must validate accounting treatment and financial controls. Legal/Privacy must determine applicable jurisdiction, purposes, legal bases, signing meaning, disclosure and retention/rights obligations. The Ritual SME must validate operational evidence and scenario workflows, with Legal resolving legal meaning. None can substitute for another specialist's remit. Implementation feasibility is engineering's responsibility, not evidence that a proposed rule is professionally correct.

Recommended decision: accept the conservative operating proposals below as the starting discussion, revise any unsuitable rule explicitly, and keep real activation closed until exact versioned content has genuine qualified review and the other release conditions are met. An owner business choice alone does not supply specialist approval. Do not populate reviewer identities, dates, keys or attestations from this draft.

## Finance: Recommended Rules

### Entry Meaning And Evidence

- `OBLIGATION`: the amount owed under an exact current accepted quote/contract version, not a receipt of money. Retain the immutable version linkage; a later quote draft must not rewrite it. Contract acceptance, issuance, signing evidence and cash receipt are separate events.
- `PAYMENT`: a confirmed receipt, appended as a credit against the identified obligation in its currency. Require the actual amount, occurrence time, supported payment method, payer attribution and a controlled evidence reference. A promise to pay, uploaded screenshot alone, or agent note is not confirmation. Recommended manual fallback: Finance verifies against the approved source record, records a non-secret reference and reason, and resolves uncertain receipts as exceptions rather than inventing payment. The existing reference-length checks do not themselves verify evidence authenticity.
- `REFUND`: a debit linked to an effective original payment and limited by its remaining refundable capacity, including relevant adjustments/reservations. Record actual return evidence; a proposed refund is not completed money movement. Never represent a correction of an input error as a real refund, or use reversal to hide a real refund.
- `CORRECTION`: a linked append-only rectification with explicit debit/credit direction, reason and evidence. `REVERSAL`: a linked opposite-direction undo of an erroneous entry within remaining source capacity. Preserve the original and all decisions. Neither creates authority to cancel the underlying contract or rewrite its obligation.
- Recommend no manual status override, deletion of posted entries, fabricated legacy balances, or automatic reconciliation repair. Retry the same command envelope after a lost response; changed payload must use a new authorized command, not silently reuse the old key.

Alternative: accept less documentary evidence for a restricted pilot. Consequence: Finance and Legal must specify the exact accepted source and accountability before use; this draft grants no exemption. No unverified receipt becomes money merely because the pilot is small.

### Four-Eyes Control

Recommended unapproved rule: every `CORRECTION` and `REVERSAL` requires a distinct authorized approver, regardless of amount, until qualified Finance approves a narrower versioned policy. The requester cannot approve their own change. Pending or rejected adjustments do not become effective; pending adjustments continue to block fulfilment. Preserve approver identity, policy version, decision and audit history.

No monetary exemption is proposed. The actual predicate uses `amountKopecks >= thresholdKopecks` and valid entries are positive integer minor units. The proposed no-exemption rule can therefore be represented by `correctionThresholdKopecks=1`: every positive correction/reversal requires approval. This is the technical encoding of the recommendation, not a Finance-approved monetary risk threshold. Finance must explicitly approve this rule before activation. The service evaluates cumulative relevant adjustment amounts, not only the latest amount. Missing policy conservatively requests approval but cannot authorize approval execution. A later exemption requires explicit qualified approval and regression coverage for splitting, cumulative amounts and concurrent requests.

`REFUND` is not included in the current correction/reversal approval predicate. Recommended business control: Finance confirms recipient, original receipt and remaining capacity before return. If a distinct automated refund approver is required, that is additional implementation work, not existing enforcement.

### Amounts, Refunds And Fulfilment

Recommend retaining the current integer minor-unit projection, subject to Finance validation:

- Obligation = sum of effective `OBLIGATION` debits. Effective non-obligation credits increase net paid; effective debits decrease it. Pending/rejected approval-dependent entries do not contribute to effective totals.
- Balance = obligation minus net paid. Refund totals include linked corrections/reversals of refund descendants; summing raw refund rows alone is incorrect. Capacity is checked through the adjustment graph, including reservations, not against one payment amount in isolation.
- With no proven obligation, display `LEGACY_INCOMPLETE`, not a guessed unpaid or paid amount. With a known obligation, derive `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERPAID`, `PARTIALLY_REFUNDED` or `REFUNDED`; a remaining effective refund takes precedence over ordinary partial-payment labeling when net paid is below the obligation.
- Example only, not a tariff: 176,000 RUB obligation and 88,000 RUB received gives 88,000 RUB remaining. A refund can reopen a balance; it does not automatically reduce the contractual obligation. Overpayment is not earned revenue or permission to retain excess funds.
- Recommend retaining the current fulfilment boundary: known positive obligation, balance no greater than zero, no pending financial adjustments, valid signed-contract evidence, applicable verified documents and no reconciliation discrepancy. Credit/deposit/partial-payment execution is an alternative business model requiring Finance/Legal review and implementation changes; this draft does not enable it.

### Payers, Exports And Exceptions

Recommend allowing multiple people to hold effective `PAYER` roles when justified by the case; do not impose an unsupported one-payer-per-family rule. The current contract version and its obligation each bind a selected payer; manual payment rejects a different payer for that obligation. Therefore split liabilities or third-party remittances need an explicit attribution decision and supported workflow. Do not relabel a third party as the selected payer merely to bypass validation, duplicate the obligation, or promise split-payer support that the current command does not provide.

Recommended Finance export scope: authorized organization/case reference, obligation/contract version IDs, currency, amount, occurrence date, entry type/direction, related-entry ID, controlled evidence reference, approval state and derived balance/reconciliation result. Include payer identity/contact only where the approved purpose needs it; exclude unrelated family contacts, document contents, religion and secrets. This is a proposed export allowlist, not a claim that a new export exists.

Recommended exception ownership: Finance investigates money/source mismatches; Admin coordinates integrity exceptions; Agent informs the case owner without changing ledger truth. Unresolved discrepancy remains visible and blocks dependent execution. No fabricated response-time SLA is set. The owner should resource escalation; Finance must accept the handling rule.

No implicit commission, agent remuneration, markup, tax or margin policy follows from ledger amounts. Quote `margin` and any separate commission/payout models are not equivalent to cash received or distributable earnings. Recommend no new commission accrual/payout rule in this M3 decision; a separate explicit commercial/accounting decision is required.

## Legal/Privacy: Recommended Choices

These are operational proposals, not assertions about applicable law. The jurisdiction, controller/processor roles and actual lawful bases must be established by the qualified reviewer. Do not assume consent is the only possible basis or that a staff-entered consent flag proves one.

### Purpose, Party Role And Contact Channel

Recommend collection limited to case coordination, approved document review, contracting, payment and necessary audit. No marketing, religious profiling, unrelated family dossier, or new processor transfer is included. One person can hold several supported roles: `APPLICANT`, `DECISION_MAKER`, `PAYER`, `RESPONSIBLE_FOR_BURIAL`, `ADDITIONAL_CONTACT`. A role does not by itself establish authority to act for another person, receive all documents or consent on their behalf.

Recommended channel policy: start with `NONE` until the permitted contact route and purpose are confirmed. Use `IN_PERSON` for recorded in-person coordination; permit `PHONE` or `EMAIL` only for the confirmed purpose and correct recipient. Keep `MESSENGER` disabled as an operating choice until Legal approves the actual provider, account, disclosures and permissible content; do not send document attachments or sensitive case detail through an unapproved channel. The owner may choose a narrower channel set but cannot certify its lawful basis.

Code currently stores one `preferredChannel` and one consent status per party, not per-purpose/per-channel consents. `EMAIL` requires an address; `PHONE`/`MESSENGER` require a phone. These checks establish neither contact permission nor destination ownership. Recommended separate operational verification of recipient and purpose; do not claim the app automatically enforces all these proposed communication restrictions.

Recommended handling of existing consent states:

| State | Proposed handling, unapproved |
| --- | --- |
| `UNKNOWN` / `NOT_REQUESTED` | Do not infer consent or initiate optional outreach; obtain the required permission or a documented alternative basis validated by Legal. Do not erase necessary records solely because consent is absent. |
| `GRANTED` | Record `consentSource` and non-future `consentAt`, purpose/scope and relevant channel evidence. The code requires source/time but does not model the complete purpose/channel record. Do not backdate or fabricate it; source/time are reported by the actor. |
| `WITHDRAWN` | Stop consent-dependent optional contact; escalate remaining necessary processing and retention to Legal. Withdrawal does not itself cancel a contract, authorize ledger deletion, or prove every other lawful basis absent. |
| `RESTRICTED` | Confirm the precise restriction with Legal before further disclosure/contact. The enum alone does not encode or enforce a granular restriction. |

Alternative: support separate purpose/channel permissions and verified authority in the product. Consequence: define and implement a structured model and server enforcement before representing those controls as available. Do not overload free-text `consentSource` with passports, secret links or a purported legal opinion.

### Visibility, Signing And Metadata

Recommend case-team access limited to assigned operational need; Finance sees obligation/payer/evidence metadata needed for money work, not the unrelated family file; Document Reviewer sees assigned requirements and necessary document/identity context, not the ledger or broad family contacts. Preserve server tenant/role checks regardless of UI labels. `CASE_TEAM`, `FINANCE_LIMITED`, `REVIEWER_REDACTED` are supported visibility values, not proof that selecting an enum supplies every proposed disclosure rule. Validate actual projections with Legal before real use.

Recommended signing position: a recorded technical signing event is evidence under a specific approved `ContractSigningPolicy`, not a general claim of legally effective electronic signature. Require an exact allowed evidence type/reference and policy version, current issued contract, accepted immutable published quote and current payer attribution. Recommended initial review option: controlled reference to a verified executed paper document; alternatives include an approved electronic-signing process with its identity, integrity and authority requirements. Neither option is activated here; the code's arbitrary evidence-type strings do not implement an external signing provider. `paymentTerms` is bounded structured data, not a validated legal contract template.

Recommend filenames, rejection reasons and logs contain only task-relevant information; use safe document-type labels and controlled references instead of personal names, diagnoses or bearer URLs. Use structured non-secret rejection reasons plus a next action, not unrestricted sensitive narratives. Preserve private storage, short-lived authorized access and access audit. Malware cleanliness is not authenticity, legal sufficiency or professional document verification. No real upload processing is authorized while the Production scanner remains unimplemented/unaccepted.

### Retention, Access Requests And Correction

Recommend purpose-specific retention, not one invented universal period. Before real processing, Legal must approve a schedule with record class, purpose/basis, start event, actual period, hold authority, deletion/anonymization action and backup treatment. No number of days or statutory retention duty is asserted here.

| Record class | Recommended trigger and handling, unapproved |
| --- | --- |
| Party contact and coordination data | Review necessity when the case closes or the contact purpose ends; remove unnecessary contact details under the approved schedule while preserving only justified links/history. Withdrawal triggers a processing review, not automatic destruction of financial evidence. |
| Document binaries and rejected/replaced versions | Separate operational expiry (`expiresAt`, affects fulfilment) from retention expiry. At purpose end, apply the approved schedule and holds; retain only justified versions. A rejected file does not justify indefinite storage. Version history must not be silently rewritten. |
| Contracts, obligations, ledger and audit | Establish the actual contractual/accounting/dispute retention basis with Finance/Legal. Preserve append-only originals and use linked correction; do not promise unrestricted hard deletion or indefinite retention. Any lawful erasure/anonymization workflow must reconcile immutable references first. |
| Access/security logs and transient credentials | Keep credentials out of logs/evidence; apply existing credential expiry/revocation controls. Define separate minimal metadata retention with Legal. The rate-limit bucket cleanup is not a document/contact/ledger retention engine. |
| Backups and exports | Include expiry, restricted access, holds and handling of restored deleted data in the approved schedule. A synthetic restore does not establish Production retention/erasure compliance. |

Recommended rights-request workflow: verify requester and scope; route to Legal; provide a purpose-limited export without unrelated parties; correct mutable contacts with provenance; preserve linked corrections for immutable financial/contract history; document any justified restriction or hold and its review. This is a proposed controlled workflow, not an existing generalized export/deletion engine. Until periods and enforceable handling are approved, do not initiate real collection on the theory that keeping everything is safer.

## Ritual Operations: Distinct Proposed Rules

The following adopts the code's `DRAFT_POLICY` blueprints as a conservative review starting point, not as legal requirements. Legal and the Ritual SME must confirm which documents genuinely establish each fact and whether alternatives are acceptable. Codes below are proposed document-type identifiers already present in draft blueprints, not references to an approved live type/version.

For every row recommend `kind=REQUIRED`, `conditionKey=null`, `ownerRole=DOCUMENT_REVIEWER`, `blockingStage=EXECUTION`, `dueOffsetHours=null`. Null due offset avoids inventing a statutory or operational deadline; the owner and SME must agree staffing/escalation before real operation. Candidate real activation permits only `DOCUMENT_REVIEWER` as rule owner and only `EXECUTION`/`CLOSED` as blocking stages. Old synthetic fixtures using `AGENT` ownership or a 24-hour offset are not authority for real policy.

| Scenario | Stable requirement key | Proposed accepted type | Proposed review questions, all unapproved |
| --- | --- | --- | --- |
| `CREMATION_V1` | `identity-record` | `APPLICANT_IDENTITY` | Legible; matches the intended applicant/context; permitted identity scope and authority confirmed without copying unnecessary identifiers. |
| `CREMATION_V1` | `death-record` | `DEATH_RECORD` | Legible; relevant person/context correspondence; document category and issuer acceptable under the specialist-approved rule. |
| `CREMATION_V1` | `cremation-authorization` | `CREMATION_AUTHORIZATION` | Legible; correct person and proposed operation; issuing/decision authority and applicability established by the SME/Legal-approved rule. |
| `FAMILY_PLOT_BURIAL_V1` | `identity-record` | `APPLICANT_IDENTITY` | Same proposed identity checks, scoped to this scenario's applicant. |
| `FAMILY_PLOT_BURIAL_V1` | `death-record` | `DEATH_RECORD` | Same proposed correspondence/category checks for this scenario. |
| `FAMILY_PLOT_BURIAL_V1` | `plot-entitlement` | `PLOT_ENTITLEMENT` | Identifies the intended plot and relevant right/authority; acceptable category, holder and scope decided by SME/Legal. |
| `FAMILY_PLOT_BURIAL_V1` | `relationship-evidence` | `RELATIONSHIP_EVIDENCE` | Shows the particular connection required by the approved plot workflow; discrepancies/alternative grounds escalated rather than invented. |

Recommended checklist content translates the above into explicit boolean review items such as `readable`, `identity_match` and `authority` only where meaningful. The actual approved policy must spell out what each means, accepted issuer/document alternatives, mismatch handling and independent review. A tick does not establish authenticity by itself. Applicant identity, responsible-for-burial role and payer identity are not interchangeable.

### Conditional Facts And Alternatives

The real policy parser and evaluator support exactly these `conditionKey` values:

| Key | Actual supported fact | Recommended use or rejection |
| --- | --- | --- |
| `HAS_PAYER` | A case party has an applicable `PAYER` role. | Use only for a genuinely payer-dependent supplementary requirement approved by the specialists. It does not establish payment, consent, signer identity or a legal duty. Do not make the core death/operation documents disappear when no payer is recorded. |
| `HAS_RESPONSIBLE_FOR_BURIAL` | A case party has an applicable `RESPONSIBLE_FOR_BURIAL` role. | Consider only for an approved role-specific supplementary check; not proof of plot entitlement or kinship. Missing role must not serve as an exemption from otherwise required evidence. |
| `CEREMONY_DATE_SET` | `lead.ceremonyAt` is non-null. | Can condition a scheduling-specific supplementary check, not legal validity or a computed lead-time rule. It does not derive a due date relative to the ceremony. |

Recommended current choice: keep the core scenario rows unconditional until the specialists justify a supported conditional alternative. In particular, the draft relationship row has an explanatory note about unapproved conditional grounds but is presently `required=true`; do not silently turn that prose into an executable condition. Kinship degree, municipal eligibility, plot ownership, permit validity, consent authority and religion are not supported condition facts. A policy depending on them requires an explicit reviewed representation/engine change or controlled specialist workflow before activation, not a fabricated `conditionKey`.

Alternative stage choice: a genuinely post-execution administrative item could block only `CLOSED` after SME/Legal review. Consequence: it would no longer prevent execution, so do not move safety/authority evidence there to remove a blocker. Earlier-stage blocking or event-relative deadlines are not supplied by this activation contract.

### Types, Verification And Replacement

Recommend initial operational formats PDF, JPEG and PNG only after actual scanner/parser acceptance; HEIC and WebP are additional schema-supported choices, not automatically validated pipeline capabilities. The activation schema permits a positive per-type `maxBytes` up to 10 MiB. That cap is an implementation bound, not an approved professional size policy or a claim that every file below it is valid. Specialists and engineering must choose accepted originals/copies and tested limits; avoid adding a format solely to clear a blocked upload.

Recommended sequence: upload remains quarantined until a trusted scan result and independent authorized review; verify only when all approved checklist items and applicable expiry checks are satisfied. `PENDING`, `ERROR`, infected, rejected, expired and unverified evidence cannot satisfy a requirement. The uploader must not verify their own upload. A replacement creates a new immutable version; do not silently invalidate a still-applicable verified prior version merely because a newer draft/rejected version exists. A genuinely expired or no-longer-applicable version must not satisfy the current rule. Rejections identify the failed criterion and owner/next action without unnecessary personal detail.

Keep both scenario policies separately versioned and genuinely distinct. Scenario changes must use the supported correction/reconciliation flow, preserve old applicable history and recompute current blockers; no retroactive assertion that an old file was verified under a new policy. No real scenario activation until current genuine credentials, exact policy content and candidate-bound proof are available.

## Concrete Disposition Proposed To The Reviewers

Recommended business starting choice: both existing scenarios only; no religious/special-category expansion; no optional marketing; no implicit commission policy; conservative all-adjustment distinct approval; confirmed-purpose contact only; private document processing only after real scanner acceptance. Keep uncertain payments and document authority as visible exceptions instead of overriding truth. Keep real rollout blocked while commercial hosting, scanner, observed scheduled maintenance, native release prerequisites and genuine professional decisions remain incomplete.

Each qualified reviewer should return an explicit acceptance or replacement of the rules in their remit, the exact policy content/version and reasons for deviations. Missing jurisdictional rules, retention periods, signing evidence definitions or financial policy representation are unresolved decisions, not empty fields to populate with guesses. This draft supplies recommendations, not professional conclusions or an importable approved activation bundle.

## Fact Sources Read

- Current packets: `docs/evidence/missions/M3/finance.md`, `privacy.md`, `ritual-rules.md`; current rollout boundaries in `release.md` and `technical-readiness/human-decisions.md`.
- `lib/m3PolicyActivation.ts`: strict real policy bundle, scenario distinction, allowed rule fields/conditions/formats, positive financial threshold and genuine attestation boundary.
- `lib/m3Domain.ts`: draft scenario blueprints, document truth, exact ledger projection/refund graph, four-eyes predicate and fulfilment blockers.
- `lib/documentRequirementService.ts`: actual conditional evaluator and requirement projection; `lib/documentService.ts`: independent reviewer/checklist, scan and expiry boundaries.
- `lib/contractLedgerService.ts`: contract/current payer and immutable accepted-quote binding, policy-controlled signing evidence, payment attribution, refunds, cumulative adjustment approval and audit/replay.
- `lib/casePartyService.ts` and `prisma/schema.prisma`: supported roles/channels/consent/visibility, reported consent provenance and current storage model.
- `lib/contractTerms.ts`: bounded payment-terms structure, not substantive legal validation; `lib/commercialQuoteService.ts`: distinct quote margin field.
- `lib/rateLimitRetention.ts`: expiry cleanup for rate-limit buckets only, not a general records-retention or erasure service.

No external legal requirement, monetary exemption, retention duration, signature or professional verdict is supplied by this document. No infrastructure action or transfer of customer documents was performed to prepare it.
