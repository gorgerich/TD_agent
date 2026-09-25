import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isReleaseWriteFreezeActive } from "@/lib/releaseWriteFreeze";

export const RATE_LIMIT_RETENTION_BATCH = 128;
const CADENCE_KEY = "rate-limit-retention-cadence-v1";
let nextLocalAttempt = 0;

/** Row locks serialize renewal with deletion; locked buckets are left for a later run. */
export async function cleanupExpiredRateLimitBuckets(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
    const rows = await tx.$queryRaw<Array<{ keyHash: string }>>(Prisma.sql`
      WITH expired AS (
        SELECT "keyHash" FROM "SecurityRateLimitBucket"
        WHERE "resetAt" <= (statement_timestamp() AT TIME ZONE 'UTC')
          AND "keyHash" <> ${CADENCE_KEY}
        ORDER BY "resetAt"
        LIMIT ${RATE_LIMIT_RETENTION_BATCH}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "SecurityRateLimitBucket" AS bucket
      USING expired
      WHERE bucket."keyHash" = expired."keyHash"
        AND bucket."resetAt" <= (statement_timestamp() AT TIME ZONE 'UTC')
      RETURNING bucket."keyHash"
    `);
    return rows.length;
  }, { maxWait: 500, timeout: 2000 });
}

export async function tryRateLimitRetention(): Promise<number | null> {
  try {
    return await cleanupExpiredRateLimitBuckets();
  } catch {
    // Fixed message only: Prisma errors can contain connection details.
    console.warn("RATE_LIMIT_RETENTION_FAILED");
    return null;
  }
}

export async function tryLoginRateLimitRetention(): Promise<void> {
  if (isReleaseWriteFreezeActive()) return;
  if (performance.now() < nextLocalAttempt) return;
  nextLocalAttempt = performance.now() + 60_000;
  try {
    if (await claimRateLimitRetentionCadence()) await tryRateLimitRetention();
  } catch {
    console.warn("RATE_LIMIT_RETENTION_FAILED");
  }
}

/** Commit the lease separately so cleanup failure cannot erase fleet-wide backoff. */
export async function claimRateLimitRetentionCadence(keyHash = CADENCE_KEY): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
    const rows = await tx.$queryRaw<Array<{ keyHash: string }>>`
      INSERT INTO "SecurityRateLimitBucket" AS lease ("keyHash", "count", "resetAt", "updatedAt")
      VALUES (${keyHash}, 1, (statement_timestamp() AT TIME ZONE 'UTC') + interval '1 minute', (statement_timestamp() AT TIME ZONE 'UTC'))
      ON CONFLICT ("keyHash") DO UPDATE
        SET "resetAt" = EXCLUDED."resetAt", "updatedAt" = EXCLUDED."updatedAt"
        WHERE lease."resetAt" <= (statement_timestamp() AT TIME ZONE 'UTC')
      RETURNING "keyHash"
    `;
    return rows.length === 1;
  }, { maxWait: 500, timeout: 2000 });
}

export async function drainRateLimitRetention() {
  const started = performance.now();
  let deleted = 0;
  for (let batch = 0; batch < 32 && performance.now() - started < 8_000; batch += 1) {
    const count = await tryRateLimitRetention();
    if (count === null) return null;
    deleted += count;
    if (count < RATE_LIMIT_RETENTION_BATCH) return { deleted, budgetExhausted: false };
  }
  // A full final batch is a continuation signal, never a claim that the backlog is empty.
  console.warn("RATE_LIMIT_RETENTION_BUDGET_EXHAUSTED");
  return { deleted, budgetExhausted: true };
}
