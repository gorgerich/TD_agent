# Closed CPO audit release preflight, 2026-09-28

This is a pre-release record, not a Production release verdict. Finance,
Legal/Privacy, and Ritual Operations SME verdicts remain pending. Real
organizations remain outside the M3 write allowlist.

## Candidate and infrastructure

- GitHub main: `20b7e0fa58e6a04f1c96630f832455ec3a0f1dc4`.
- PR #32 before this operational change: `df18c9dc3d11f79e23991230d384801186ceef9b`, OPEN, READY, CLEAN, MERGEABLE.
- CI for that head: `https://github.com/gorgerich/TD_agent/actions/runs/36324572350`, PASS, skipped 0.
- Production Vercel deployment: `dpl_AkdiVtTqDjsvnX4nS3k4yKbez61g`, READY. Runtime remains pre-M3.
- Production Railway DB fingerprint: `0257665af2dd90a4`. Railway project `204385e0-1f5d-4711-ac49-74475d0d7093`, Postgres service `32492019-8037-4443-807b-3919626ccc63`.
- Owner-supplied read-only Railway evidence identifies the separate NOX Postgres service `2e1fc8de-1001-4962-abe7-657df44987e7`, distinct endpoints and volumes. This was not independently re-probed in this run.
- A non-existent Production API POST returned 404, so the current runtime's write freeze was inactive. Vercel CLI exposes Sensitive environment variables as empty placeholders; those placeholders were not treated as deployed values.
- Production `CRON_SECRET` is absent in Vercel metadata. The protected scheduled retention endpoint cannot run until configured; login-triggered bounded retention remains active. This requires a Production-only configuration step before release.

## External encrypted backup and isolated restore

- PostgreSQL 18 logical `pg_dump -Fc` was taken from Production through the verified direct connection. No Production write was made.
- AES-256 encrypted artifact, outside Git: `~/Library/Application Support/TD Agent M3 Backups/td-agent-production-20260927-df18c9d.dump.gpg`. File mode 0600; containing directory mode 0700. Key is separate in macOS Keychain under `td-agent-m3-backup-20260927`; no key or DSN is in this record.
- Encrypted SHA-256: `4b7c53e266a3890eb5d41bdd480ba668e242788a14543f42cdb3009b4d4739ee`; `pg_restore --list` found 376 objects.
- Decrypted stream restored into a new local PostgreSQL 18 clone with a Unix socket and no TCP listener. Counts matched Production before M3 migration: User 8, Agent 7, Organization 5, Membership 7, ClientLead 17, Case 17, Task 17, Meeting 16, Quote 12, QuoteVersion 17.
- M3 migration `20260811172829_m3_fulfilment_money_trust`, checksum `270c36a7aebd3ccf0604f87331d83865e6367e9806c27142e5a9d0d996366480`, applied only to that clone in 3 seconds. Repeated deploy was a no-op; schema parity passed. Legacy counts stayed unchanged; new CaseParty, CaseDocumentRequirement, and PaymentLedgerEntry counts remained zero. Checked legacy orphan counts were zero.
- The migration adds M3 types, tables, indexes, constraints and triggers; it does not alter or drop old columns. This supports old-runtime/new-schema compatibility, but a frozen Production cutover still needs final verification.
- The retained Railway restore credential was exposed to tool output in an earlier failed connection attempt. It was not used for this restore and must be rotated before future use. The isolated local clone contains plaintext Production data and must be stopped and removed after the release decision.

## Synthetic CPO organization rehearsal

- New operator script is limited to exact organization `m3-cpo-audit-20260923` and verified Production fingerprint. It stores five role passwords only in a local 0600 file, never in Git or output.
- On the migrated local clone: first provision created one organization and five synthetic identities; replay created no duplicates. All seven requirement rules used canonical Case guard keys. A suspended organization made replay refuse without reactivation. A dummy non-target URL was refused.
- Independent review found and prompted repair of non-canonical guard keys (P1) and inactive-fixture replay (P2). Final review of the latest diff is still pending because the reviewer tool hit its usage limit.
- Sandbox policy rejected an attempted rehearsal using the Production Keychain credential in a write-capable script. No Production provisioning was attempted. Do not route around this denial; release requires a permitted, reviewed execution path.

## Release boundary

No Production freeze, migration, merge, deployment, CPO provisioning or synthetic write smoke has occurred. The encrypted backup and local restore are a rehearsal, not the fresh under-freeze final backup. Do not merge PR #32 until final review, exact-head CI, Production-only cron configuration, fresh under-freeze backup/restore, and the allowed CPO provisioning path are proven. Keep human verdicts pending and full agent rollout disabled.
