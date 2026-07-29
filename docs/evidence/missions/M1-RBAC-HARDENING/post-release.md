# M1 RBAC Hardening production release

Date: 2026-07-29

Status: `PASS`

Portfolio mission `M2 Commercial Trust Loop`: `NOT_STARTED`

## Release identity

- Initial main SHA: `7e305d28d2a1c15a147a712062f30323acde98c1`.
- Product implementation SHA: `be37d89fc1718744a9aa6896261552f0bd689c35`.
- PR #24 evidence head: `8876a8a9e4f1ea47b9e987a572f826e52a6798ae`.
- PR #24 merge SHA: `0fcd7e188abc34b4312ebfe5992613468911f09a`.
- Owner recovery implementation SHA:
  `934e7ff7ae82925418dfce588004a11fd0b080df`.
- PR #25 evidence head: `2e51c9db4e80db49d587b83a640db190fdfa34e6`.
- PR #25 merge SHA: `16114cc9943f77412b5704774591240eb30c0244`.
- Runtime crypto repair SHA: `ee66888142a791aa5573fe7463fb004c992ceb45`.
- PR #26 merge and final runtime SHA:
  `d594ad21a5f2d07cea57a2d3355f7190c43e81a5`.
- Final main CI:
  `https://github.com/gorgerich/TD_agent/actions/runs/30454919991`,
  `PASS`, skipped `0`.
- Final frozen deployment: `dpl_HVPnw1z5zpE6Bkvv8gsbZRouJDkm`, READY.
- Final unfrozen deployment: `dpl_CdK4ZkoJaEMesGqdMGSCaN6uw9v5`, READY.
- Production URL: `https://td-agent.vercel.app`.
- Final deployment source: exact production redeploy of the frozen deployment
  associated with final runtime SHA
  `d594ad21a5f2d07cea57a2d3355f7190c43e81a5`.

## Database and migration

- Production target fingerprint: `0257665af2dd90a4`, MATCH.
- Direct and pooled endpoints: same production database identity.
- Migration target: verified direct connection.
- Additive migrations applied: five.
- Total applied migrations after release: nine.
- Failed or incomplete migrations: zero.
- Migration duration: 15 seconds.
- Repeated deploy: no-op.
- Schema parity: PASS.
- Legacy counts, tenant ownership, duplicates and orphans: PASS.
- Reconciliation discrepancies: zero.

Final aggregate counts:

| Entity | Count |
| --- | ---: |
| User | 6 |
| Agent | 5 |
| Organization | 4 |
| ClientLead | 15 |
| Case | 15 |
| Task | 14 |
| Meeting | 14 |

## Backup and restore

- Fresh production backup: PASS.
- Format: PostgreSQL custom format.
- Encryption: AES-256-CBC with PBKDF2, 200000 iterations.
- `pg_restore --list`: PASS.
- Real isolated restore: PASS.
- Source and restore counts: exact match.
- Final recovery release backup retention ID:
  `m1-owner-recovery-final-20260729T123717Z`.
- Encrypted backup and separately stored key are retained pending explicit
  deletion authorization.
- Isolated restore resource remains retained pending explicit cleanup.
- Unencrypted temporary dumps, local bearer files, cookies and temporary
  credentials were removed.

## Platform owner recovery

- Exact owner record: one.
- Active Platform SUPER_ADMIN records: one.
- No additional User, Agent or Organization was created.
- Recovery bearer: hash-only in PostgreSQL, 15-minute maximum lifetime,
  single-use and consumed.
- Raw bearer delivery: protected local file only; never written to chat, CI,
  GitHub, evidence or application logs.
- Password was entered by the owner and never handled by the release operator.
- TOTP enrollment was completed by the owner.
- Password, MFA secret, activation consumption, audit and `sessionVersion`
  update committed atomically.
- Active recovery records after completion: zero.
- Mandatory MFA login: PASS.
- Stale-session invalidation: PASS.
- Platform role remained `SUPER_ADMIN`.

## Production smoke

Under freeze:

- Login and read-only routes: PASS.
- Platform Admin dashboard, organizations, users and audit: PASS.
- Representative business mutation: `503`, freeze header and `Retry-After`
  present.
- Unexpected `5xx`: zero.

After unfreeze:

- Authenticated Platform Admin dashboard, organizations, users and audit: PASS.
- Operational workspace access for the owner's AGENT membership: PASS.
- Organization team administration for the AGENT membership: denied as
  expected. Platform SUPER_ADMIN did not gain tenant ADMIN rights.
- Agent and Manager regressions: PASS in final CI.
- Cross-tenant negative tests: PASS in final CI.
- Browser console errors and warnings: zero.
- Reversible mutation: `Agent.notifyEnabled` changed from `true` to `false`
  through the application route and restored to `true`.
- Domain row counts remained unchanged.
- Final `RELEASE_WRITE_FREEZE`: exact `disabled`.

## Authorized production writes

1. Five additive RBAC, activation, MFA and owner-recovery migrations.
2. One owner recovery activation record and secret-free audit record.
3. Atomic owner password hash, encrypted MFA secret, activation consumption,
   session-version increment and secret-free recovery audit.
4. Persistent recovery rate-limit bucket updates.
5. One reversible `notifyEnabled` check and restoration to its original value.

No client, case, task, meeting, document, quote, order or payment was created,
deleted or modified by this release smoke. No destructive schema rollback,
force push or branch-protection bypass occurred.

## Open risk and retention

- `RISK-W1-TECH-HUMAN-REVIEW`: `OPEN`.
- Encrypted release backups: retained pending an explicit retention decision.
- Isolated restore database: retained pending explicit cleanup authorization.
- Platform owner account: ACTIVE.
- `M2 Commercial Trust Loop`: `NOT_STARTED`.
