# M2 release

Production release is outside this mission authority envelope.

- Production writes: none.
- Production schema changes: none.
- Production deployment: unchanged.
- Owner release authorization: required after `MISSION_RELEASE_READY`.

Status: `IMPLEMENTATION_VERIFIED` at `3807e57ff10c910f1bfdfb1986bddf651a1f4cde`.

`MISSION_RELEASE_READY` is not reachable from an implementation session: it needs
`preview_uat` (a Preview deployment of the exact SHA) and `independent_review`
(P0 = 0 and P1 = 0 from someone other than the implementer). Both are recorded as
open blockers in `mission.yaml`.

## Deployment requirement: SSI predicate lock granularity

Every operational command runs at `SERIALIZABLE`. Postgres tracks that with SSI predicate
locks, and `max_pred_locks_per_page` (default **2**) is the point at which per-tuple locks
on one page collapse into a single page-level lock. Past that point two transactions that
touch different tenants' rows conflict because those rows share a heap or index page, and
the command fails with `P2034` although nothing raced.

Escalation never breaks serializability — it trades precision for memory — but the false
positives it produces are indistinguishable from real conflicts, so at the default the
product returns `409 Конфликт параллельных изменений` on publish, link and accept for
tenants that never contended. Measured on the integration suite: at the default the suite
failed roughly one run in six after the retry budget was exhausted; at 64 it passed eight
consecutive runs.

**Required on every database this ships to, including production:**

```sql
ALTER SYSTEM SET max_pred_locks_per_page = 64;
SELECT pg_reload_conf();
```

`max_pred_locks_per_page` is a `SIGHUP` parameter — no restart, no downtime.

Enforcement status:

- CI configures it before the integration gate (`.github/workflows/quality.yml`).
- `tests/integration/fixtureIsolation.itest.ts` asserts it, so a misconfigured test
  database fails loudly and once rather than flaking elsewhere.
- **Not yet verified on the production Neon instance.** This is recorded as a RECOMMENDED release prerequisite in `test-results.json`, not as a
  blocker in `mission.yaml`: it was measured only under integration-suite density. Bounded jittered retry
  (`lib/serializationBackoff.ts`) limits the blast radius if the setting is not applied,
  but the setting remains recommended: at the default, the retry budget was measured as
  insufficient under integration-suite density. Note that density is a test artifact, not a
  tenant workload, so this is not claimed as a production blocker. Measured at the default under integration-suite density, the
  default under load.
