#!/usr/bin/env bash
#
# baseline-prod.sh — one-time conversion of the SHARED prod DB from
# `prisma db push` to an auditable `prisma migrate deploy` workflow.
#
# WHAT IT DOES (and does NOT do):
#   * Generates an `0_init` baseline migration from the *actual current prod
#     schema* (read-only introspection — touches no data, no DDL).
#   * Checks for drift between prod and prisma/schema.prisma.
#   * Marks `0_init` as already-applied in prod's _prisma_migrations table
#     (metadata-only write — NO CREATE/ALTER/DROP is executed against prod).
#
#   It NEVER runs `db push`, and NEVER executes the baseline SQL against prod.
#   The B2C tables (User, Order, Payment) are left exactly as they are.
#
# PRECONDITIONS — do not run until ALL are true:
#   1. The DB owner has a VERIFIED, restorable backup of the shared prod DB.
#   2. You are running against the intended DB (double-check the host below).
#   3. No deploy is in flight (the old build still runs `db push` until this
#      branch merges — pause deploys / merge the build-script change first).
#
# Migrations use the UNPOOLED (direct) connection, per schema.prisma directUrl.
set -euo pipefail

MIGRATIONS_DIR="prisma/migrations"
BASELINE="0_init"
BASELINE_DIR="${MIGRATIONS_DIR}/${BASELINE}"

# --- 0. sanity: env --------------------------------------------------------
: "${DATABASE_URL:?DATABASE_URL must be set (pooled URL)}"
: "${DATABASE_URL_UNPOOLED:?DATABASE_URL_UNPOOLED must be set (direct URL for migrations)}"
DIRECT_URL="${DATABASE_URL_UNPOOLED}"

# Print the host we are about to touch so a human can eyeball it.
host="$(printf '%s' "$DIRECT_URL" | sed -E 's#.*@([^/?]+).*#\1#')"
echo ">> Target DB host (UNPOOLED / direct): ${host}"
read -r -p ">> Is a VERIFIED prod backup in hand and is the host correct? [type 'yes']: " ok
[ "$ok" = "yes" ] || { echo "Aborted. Get a backup first."; exit 1; }

# --- 1. generate the baseline from ACTUAL prod (read-only) ------------------
# We baseline from the live DB, NOT from --to-schema-datamodel, because prod was
# previously mutated by `db push`. The baseline must equal reality.
mkdir -p "$BASELINE_DIR"
echo ">> Generating baseline SQL from live prod schema (read-only)…"
npx prisma migrate diff \
  --from-empty \
  --to-url "$DIRECT_URL" \
  --script > "${BASELINE_DIR}/migration.sql"
echo ">> Wrote ${BASELINE_DIR}/migration.sql"

# --- 2. drift check: prod vs prisma/schema.prisma --------------------------
# If this is non-empty, prod does NOT match the target datamodel. Do NOT
# proceed — an additive reconcile migration must be authored & reviewed first.
echo ">> Checking drift between prod and prisma/schema.prisma…"
drift="$(npx prisma migrate diff \
  --from-url "$DIRECT_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script)"

if [ -n "$(printf '%s' "$drift" | grep -vE '^\s*(--.*)?$' || true)" ]; then
  echo "!! DRIFT DETECTED. prod != schema.prisma. NOT marking baseline applied."
  echo "!! Review the statements below. Any ALTER/DROP on User/Order/Payment is a RED FLAG."
  printf '%s\n' "$drift"
  echo "!! Author an additive-only reconcile migration, then re-run after review."
  exit 2
fi
echo ">> No drift. prod matches prisma/schema.prisma."

# --- 3. mark baseline as applied (metadata-only) ---------------------------
# This writes ONE row to _prisma_migrations. It runs NO schema DDL.
read -r -p ">> Mark ${BASELINE} as APPLIED in prod (metadata only, no DDL)? [type 'yes']: " ok2
[ "$ok2" = "yes" ] || { echo "Stopped before resolve. Baseline SQL generated but not applied."; exit 0; }
npx prisma migrate resolve --applied "$BASELINE"

# --- 4. verify -------------------------------------------------------------
echo ">> migrate status:"
npx prisma migrate status
echo ">> Done. Future deploys run 'prisma migrate deploy' (see README)."
