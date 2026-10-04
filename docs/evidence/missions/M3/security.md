## Current Intake Hotfix Validation, 2026-10-04

## Current Reconciliation Repair, 2026-10-04

Source `c0567d11d4a80d1488a1e8bca6dc1815ffc83806`, PR #34, based on main `8deda6c3dbeb79dd15f3897a44ee16a492f55cca`. Exact Preview `dpl_AkHmeuGd4EoQJVTPqEH3qpCeKgUa`, https://td-agent-2z7lvoo1b-rics-projects-9baa2793.vercel.app; Railway fingerprint `545a187f9e9d66b0`, private store `store_Ov8erHstuvfJ52Og`. Fresh synthetic schema `m3_intake_preview_1791111530558`, run `intake-1791111530558`. Both full authenticated journeys PASS, including the new pre-upload reconciliation API regression, document review/replacement, immutable contract/ledger, partial/full/refund/reversal, four-eyes, webhook replay, cross-tenant and failure recovery. Reconciliation=0, unexpected5xx=0, skipped=0, critical/serious accessibility=0, mobile/200% zoom PASS.

Local gate: 143 unit, 92 integration across 15 files, canonical build, all five E2E scripts, migrate/no-op/parity and cleanup PASS. Independent exact-source delta review P0=0/P1=0; inherited Finance P2 remains documented. Source CI https://github.com/gorgerich/TD_agent/actions/runs/37197375921; authoritative evidence-head CI remains a separate pre-merge gate.

Fresh read-only encrypted backup and real isolated restore: receipt `intake-2026-10-04T11-05-23.102Z`, 52 table counts/digests MATCH, parity PASS, no-op, plaintext clone removed. Production during this technical validation remains frozen rollback `dpl_4sFF8Boy1yHkyx2kbb8N3GXVySwo`, source `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`. Earlier committed synthetic Case57 histories and the false reconciliation stop are preserved in reconciliation-incident.md, not erased. No Production migration is needed for this repair. Human verdicts PENDING; broad rollout CLOSED; CPO-only release still requires green final CI and controlled Production smoke.

## Historical Intake Hotfix Validation, Superseded

Historical implementation `4bc03e2f228d64f9d12325cfe21b683ee143d5a1`, PR #33 and its UAT remain preserved in Git history and intake-validation-current.json. They are not new-source executions.

Technical source CI: https://github.com/gorgerich/TD_agent/actions/runs/37159816398. All technical steps passed; overall FAIL at stale authoritative evidence is NOT green overall CI. Green evidence-head CI remains required before merge. Independent exact-source review: P0=0/P1=0, one unchanged documented P2. Human verdicts remain PENDING and broad rollout CLOSED.

Current production remains on verified frozen rollback deployment. Preview-only scoped credentials/resources changed; no Production business/schema/env writes during hotfix validation. Server CPO organization allowlist remains unchanged; production scanner is NOT configured and verification remains fail-closed. No professional verdict is implied by synthetic policies.

## Historical Baseline Security Evidence

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
- Human policy approval cannot be asserted by an application operator alone: authority
  grants require a fresh SUPER_ADMIN session with current TOTP verification, atomic
  persistent throttling, and one-time consumption. Each reviewer key is registered for
  one fixed role, auditable, and permanently revocable.

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
- Human attestation files are bound to exact implementation, deployment, isolated database,
  reviewed policy fingerprint, role-specific trusted key, and canonical Ed25519 signature.
- Actor, timestamp, before/after, correlation, idempotency, and target are recorded for business
  mutations. Passwords, tokens, provider secrets, raw payloads, permanent file URLs, and document
  contents are excluded.

## Review result

Independent review of exact source SHA `ced3fad0fee5e5018bf4dab93cf87f644c0e4a3f`
reported P0=0, P1=0, P2=1. Bounded login-rate-limit retention now has an indexed,
scheduled, authorized cleanup and targeted tests. The remaining P2 is the
Finance Case-detail read restriction recorded in `review.md`; it does not widen
tenant access. Exact Preview
negative tests reported cross-tenant access=0, unexpected 5xx=0, document reconciliation=0,
and payment reconciliation=0.
