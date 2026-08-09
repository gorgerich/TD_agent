# M2 migration contract

- Additive migrations only; historical migrations and checksums stay unchanged.
- Existing `Quote` and `QuoteVersion` records are preserved.
- Legacy saves become explicit `LEGACY_INCOMPLETE` commercial records unless all
  tenant, Case, owner, scenario, price and version facts can be proven.
- Unknown price or cost is never inferred from legacy zero.
- Tenant, Case, meeting and owner relationships are backfilled only through
  existing canonical foreign keys.
- Production-like fixture must cover legacy draft, viewed and agreed records.
- Rehearsal requires encrypted backup/restore, first deploy, repeated no-op,
  schema parity, stable legacy counts, and zero orphan/duplicate/tenant mismatch.
- Rollback before production is resource reset. Production release, if later
  authorized, uses containment and safe forward-fix; published history is not
  destructively removed.

## Authoritative status

- Release state: `RELEASED`.
- Applied migration: `20260729170000_m2_commercial_trust_loop`.
- Approved checksum:
  `fc82c99f3fa06cd7a74d42917e82638923d543bb19b5150a1a9403183eb6999e`.
- Production database fingerprint: `0257665af2dd90a4`.
- Production migration history: 10 applied migrations, no failed or incomplete record found
  during the read-only post-release audit.
- Production schema parity: PASS, `No difference detected`.
- Repair branch migration files changed: NO.
- Isolated repair database: repeated `prisma migrate deploy` returned no pending migration;
  schema parity PASS.

The earlier contract-lock wording described the pre-release phase and is superseded by this
status. The P1 economics repair is source-only and requires no schema change.
