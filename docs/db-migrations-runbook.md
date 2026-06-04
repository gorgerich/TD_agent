# DB Migrations Runbook — `prisma db push` → `prisma migrate deploy`

Owner-facing runbook for moving the **shared B2C prod DB** off build-time
`prisma db push` onto auditable migrations. **Nothing here is automated.** Every
prod step is owner-run, with a verified backup in hand.

---

## 🔴 BLOCKER — verify deploy environment BEFORE any further branch pushes/merges

- Current `build` still runs **`prisma db push`** (`package.json`):
  `prisma generate && prisma db push --skip-generate && next build`.
- Vercel **Preview** deployments run the **same** build → previews also `db push`.
- PR #2's Preview deploy (`f6a03a0`) **already succeeded** → `db push` **already
  ran against some live Postgres** at build time.
- **The DB target is UNKNOWN from this session** (no Vercel token here).
- **Owner must verify Vercel env scoping before any more branch pushes/merges.**

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

## Forbidden (always)
- `prisma db push` against prod.
- `prisma migrate dev` / `reset` against prod (recreates DB — data loss).
- `DROP`/`ALTER` of B2C tables (`User`, `Order`, `Payment`) or their columns.
- Flipping `build` to `migrate deploy` before Step 4 (prod baseline) + staging green.
- Any prod action without a verified backup.
