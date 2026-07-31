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

Status: contract locked; implementation and isolated rehearsal pending.
