# Mission 1 production release

Date: 2026-07-26

Status: `PASS`

## Release identity

- Release candidate PR: `#22`
- Runtime implementation SHA: `a2c1f603e8ae2e506be981de265b75d9373a5387`
- Final pre-release evidence SHA: `6ab41009de169b9059d17a6ec887ee6c6e3be601`
- Production merge SHA: `ca309644406170618ef7f3abb783ff4835785a43`
- Main CI: `https://github.com/gorgerich/TD_agent/actions/runs/30178376105`
- Main CI result: `PASS`, skipped steps/tests: `0`
- Frozen M1 deployment: `dpl_GrfkAHQssR1LMCDkRGb6H3n5KbgL`
- Final unfrozen deployment: `dpl_EVQ7kfq4MLcoVunrgQ9vvbBQhFQu`
- Production URL: `https://td-agent.vercel.app`
- Final deployment status: `READY`
- Final runtime source: exact redeploy of frozen deployment associated with
  production merge SHA `ca309644406170618ef7f3abb783ff4835785a43`

## Backup and restore

- Fresh PostgreSQL custom-format backup: `PASS`
- Encryption at rest: AES-256-CBC with PBKDF2, `PASS`
- Backup retention ID: `m1-20260726T013758`
- Encryption key: retained separately in macOS Keychain; value was never logged
  or committed.
- `pg_restore --list`: `PASS`
- Real restore to isolated target: `PASS`
- Source/restore schema and aggregate counts: exact match
- Unencrypted dump and temporary credentials: deleted
- Isolated restore resource: retained pending an explicit cleanup decision

## Migration

- Production target fingerprint: reviewed target `MATCH`
- Direct migration connection: verified unpooled production target
- Write freeze during migration: `enabled` and verified
- `20260718090000_m1_operations_control_plane`: applied
- `20260719190000_m1_operations_integrity`: applied
- Migration duration: `12 seconds`
- Repeated `prisma migrate deploy`: no-op
- `prisma migrate status`: up to date, four migrations applied
- Schema parity: `No difference detected`
- Failed or incomplete migrations: `0`

Legacy counts remained stable through migration:

| Entity | Before | After migration |
| --- | ---: | ---: |
| User | 4 | 4 |
| Agent | 3 | 3 |
| ClientLead | 14 | 14 |
| Case | 14 | 14 |
| CaseEvent | 14 | 14 |
| Meeting | 13 | 13 |
| Quote | 10 | 10 |
| Order | 5 | 5 |
| Document | 0 | 0 |

M1 backfill produced three Organizations and three active Memberships. Canonical
past-meeting catch-up created eight `MEETING_ESCALATION` Tasks, eight
OperationalAuditEvents and eight ProjectionReceipts. Two repeated catch-up runs
created zero further rows.

Post-migration duplicate, orphan, owner, membership and tenant mismatch counts:
`0`. Product-truth `PT-001` through `PT-011`: `PASS`. Case and operations
reconciliation discrepancies: `0`.

## Production smoke

Read-only smoke under freeze:

- Agent password login: `200`
- Manager password login: `200`
- Agent Today and read routes: `PASS`
- Manager Control Tower and audit routes: `PASS`
- Agent access to team scope: `403`
- Cross-tenant visibility: `0`
- Representative authenticated mutation: `503` with active freeze response
- Unexpected `5xx`: `0`

Canonical synthetic smoke after unfreeze:

- Organizations: `1`
- Users: `2` (`.invalid` identities)
- Agents/Memberships: `2`, roles Agent and Manager
- ClientLead/Case: `1 / 1`
- Task/Meeting: `1 / 1`
- Documents/Quotes/Orders/Payments: `0 / 0 / 0 / 0`
- Agent Today: `PASS`
- Manager Control Tower: `PASS`
- Assignment and reassignment: `PASS`
- Task final status: `COMPLETED`
- Meeting final status: `COMPLETED`
- Search: `PASS`
- Saved view and idempotent replay: `PASS`
- Audit projection: `PASS`
- Lead, Task and Meeting create replay: `PASS`, no duplicates
- Case final stage: `PLANNING`
- Case and operations reconciliation discrepancies: `0`

Credential rotation passed for both accounts: old passwords returned `401`, new
passwords returned `200`. Both synthetic Memberships and Agent profiles were
then set to `SUSPENDED`; login returned `403`, existing sessions returned `401`.
All plaintext passwords, cookie jars and temporary smoke files were destroyed.
Synthetic business rows remain as an honest terminal audit record and were not
deleted.

## Final production state

- Production deployment: `READY`
- `RELEASE_WRITE_FREEZE`: exact `disabled`
- Login page: `200`
- Unauthenticated app route: expected redirect
- Unauthenticated operational API: `401`
- Unexpected `5xx`: `0`
- Migration status and schema parity: `PASS`
- Global duplicate/orphan/tenant mismatch counts: `0`
- Global case reconciliation discrepancies: `0`
- Global operations reconciliation discrepancies: `0`

Final aggregate counts:

| Entity | Count |
| --- | ---: |
| User | 6 |
| Agent | 5 |
| Organization | 4 |
| Membership | 5 |
| ClientLead | 15 |
| Case | 15 |
| CaseEvent | 17 |
| Task | 14 |
| Meeting | 14 |
| Quote | 10 |
| Order | 5 |
| Document | 0 |
| SavedOperationalView | 1 |
| OperationalAuditEvent | 15 |
| ProjectionReceipt | 9 |

## Production writes

Authorized production writes only:

1. Two additive M1 schema migrations and their deterministic legacy backfill.
2. Canonical catch-up: eight escalation Tasks, eight audit events and eight
   projection receipts.
3. Synthetic smoke: one Organization, two Users, two Agents, two Memberships,
   one ClientLead, one Case, three CaseEvents, one Task, one Meeting, one saved
   view, seven audit events and one projection receipt.
4. Two password rotations.
5. Suspension of two synthetic Memberships and two synthetic Agent profiles.

No production document, quote, order or payment was created. No destructive
schema rollback, data deletion, force push or branch-protection bypass occurred.

## Open risk and retention

- `RISK-W1-TECH-HUMAN-REVIEW`: `OPEN`
- Encrypted release backup: retained pending explicit retention/deletion decision
- Isolated restore resource: retained; cleanup requires explicit owner decision
- No other release blocker remains
