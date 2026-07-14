# DB Migrations Runbook — `prisma db push` → `prisma migrate deploy`

Owner-facing runbook for moving the **shared B2C prod DB** off build-time
`prisma db push` onto auditable migrations. **Nothing here is automated.** Every
prod step is owner-run, with a verified backup in hand.

---

## 🟠 STATE — build no longer mutates DB; Preview/Prod still share env (CONFIRMED)

- **Resolved (hotfix `#3`, merged to main):** `build` = `prisma generate && next build`.
  `prisma db push` removed → **deploy builds no longer mutate the DB.** Verified in
  the production build log (`prisma generate && next build`, no `db push`/`migrate`).
- **CONFIRMED (audit `vercel env ls`):** `DATABASE_URL` and `DATABASE_URL_UNPOOLED`
  are each a **single env entry scoped Production + Preview** → Preview uses the
  **same value as Production**. Neon integration `neon-bole-lamp` is installed, but
  per-preview branching is not evident (static shared URL).
- **Residual risk:** preview-**runtime** still connects to the **production DB**
  (shared env). Builds are now safe; preview *app instances* read/write prod data.
- **History:** PR #2's earlier preview (`f6a03a0`) ran the OLD `db push` build once
  against the prod DB (additive-only, no `--accept-data-loss`; no data loss observed).

### Required before using previews against real flows — isolate Preview DB

CONFIRMED necessary (not hypothetical). See the rule + owner checks below.

### Owner checks (exact)

**1. Vercel → Project `td-agent` → Settings → Environment Variables**
- inspect `DATABASE_URL`
- inspect `DATABASE_URL_UNPOOLED`
- confirm whether **Preview and Production use the same values**
- CLI alt: `vercel env ls` (after `vercel login`)

**2. Neon**
- confirm whether **Vercel Preview Branching is enabled**
  (Neon console → Project → Integrations → Vercel → "Create a branch for each
  preview deployment")
- if **not** enabled **and** Preview env points to prod → **STOP all branch pushes.**

**3. Vercel deployment logs**
- open Preview deploy **`f6a03a0`**
- inspect build logs around `prisma db push`
- identify which **DB host** it connected to, if visible; compare to prod host

### Rule — if Preview DB == Production DB

Before **any** further development:
1. create a Neon **preview/staging branch** DB;
2. set Vercel **Preview** `DATABASE_URL` **and** `DATABASE_URL_UNPOOLED` to the
   **branch** DB;
3. keep **Production** env pointing to prod;
4. only then continue.

Until this is done, every preview build mutates prod via `db push`.

---

## Runbook — steps 0–6

> All steps owner-run. Steps touching prod require a **verified, restorable
> backup**. Migrations use the **UNPOOLED (direct)** URL (`schema.prisma`
> `directUrl = env("DATABASE_URL_UNPOOLED")`); pgBouncer breaks Prisma
> advisory-locks.

### Step 0 — confirm deploy safety (blocker for everything)
Run BLOCKER checks 1–3 above. If Preview uses the prod DB, first isolate it
(enable Neon preview-branching OR set Preview-scoped DB to a branch) so builds
stop touching prod. Do not proceed otherwise.

### Step 1 — verified backup
```bash
pg_dump "$PROD_DATABASE_URL_UNPOOLED" -Fc -f td_prod_$(date +%Y%m%d_%H%M).dump
pg_restore --list td_prod_*.dump | head     # verify the dump opens
```
Do not continue until the dump is verified restorable.

### Step 2 — staging / Neon branch DB
```bash
# Neon console: create branch "staging" off prod (full copy).
export DATABASE_URL=<branch-pooled-url>
export DATABASE_URL_UNPOOLED=<branch-direct-url>
```

### Step 3 — baseline on STAGING branch (dry run)
```bash
./scripts/db/baseline-prod.sh        # against the staging env vars from Step 2
# expect: baseline SQL generated, "No drift", resolve applied
npx prisma migrate status            # expect "Database schema is up to date!"
```
If drift is reported → author an **additive-only** reconcile migration, review
(any `ALTER`/`DROP` on `User`/`Order`/`Payment` is a red flag), repeat. Do not
continue until staging is green.

### Step 4 — owner-gated PROD baseline (only after Step 3 green)
```bash
export DATABASE_URL=<PROD-pooled>
export DATABASE_URL_UNPOOLED=<PROD-direct>
./scripts/db/baseline-prod.sh        # confirms backup+host, drift-gate, resolve --applied (metadata only, no DDL)
npx prisma migrate status            # "up to date"
git add prisma/migrations/0_init
git commit -m "chore(db): commit prod baseline 0_init"
git push
```

### Step 5 — second PR: flip build (only after Step 4)
```diff
- "build": "prisma generate && prisma db push --skip-generate && next build",
+ "build": "prisma generate && prisma migrate deploy && next build",
```
Verify on the staging branch first (`migrate deploy` runs clean), then merge.

### Step 6 — verify prod deploy
After the flip merges, confirm the prod deploy runs `migrate deploy` (no
`db push`) and `npx prisma migrate status` is clean.

---

## Future schema changes (normal cycle, after baseline)
```bash
# 1. edit prisma/schema.prisma — additive only
# 2. against a dev/branch DB (NEVER prod):
npx prisma migrate dev --name <short_name>
# 3. review prisma/migrations/<ts>_<name>/migration.sql:
#    no DROP COLUMN / ALTER TYPE on B2C tables; new B2C cols nullable or DEFAULT
# 4. commit migration → merge → build runs migrate deploy
```

## Week 2 canonical Case migration

Files:

- `20260713000000_baseline`: generated from verified Week 1 schema; metadata
  adoption is required for an existing database.
- `20260714090000_week2_canonical_case`: additive `Case`, `CaseEvent`, enums,
  indexes, foreign keys and deterministic backfill.

CI applies both migrations to a new PostgreSQL `td_agent_test`, then verifies
zero drift against `schema.prisma`. This proves a clean install only. It does not
authorize production deployment.

Existing staging/production database procedure:

```bash
# 1. Verified backup and isolated staging clone are mandatory.
export DATABASE_URL=<staging-pooled>
export DATABASE_URL_UNPOOLED=<staging-direct>

# 2. Confirm existing tables match baseline before metadata adoption.
npx prisma migrate diff \
  --from-url "$DATABASE_URL_UNPOOLED" \
  --to-schema-datamodel /path/to/week-1-schema.prisma \
  --exit-code

# 3. Mark only baseline as already applied; this executes no DDL.
npx prisma migrate resolve --applied 20260713000000_baseline

# 4. Apply Week 2 additive migration on staging.
npx prisma migrate deploy
npx prisma migrate status
```

Forward-fix policy:

- do not delete `Case`/`CaseEvent` after application traffic starts;
- on backfill discrepancy, stop rollout and append a corrective migration;
- never edit an applied migration;
- production execution requires SME gate, backup proof, staging dry-run and
  separate Founder approval.

Rollback before application traffic: restore verified database backup. After
traffic starts: forward-fix only, because `CaseEvent` is append-only audit data.

## Forbidden (always)
- `prisma db push` against prod.
- `prisma migrate dev` / `reset` against prod (recreates DB — data loss).
- `DROP`/`ALTER` of B2C tables (`User`, `Order`, `Payment`) or their columns.
- Flipping `build` to `migrate deploy` before Step 4 (prod baseline) + staging green.
- Any prod action without a verified backup.
