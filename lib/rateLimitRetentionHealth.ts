import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { drainRateLimitRetention } from "@/lib/rateLimitRetention";

export const RETENTION_JOB_KEY = "rate-limit-retention-v1";
// Hobby cron has hourly precision. Allow a full day plus that window and dispatch delay.
export async function getRateLimitRetentionHealth() {
  const rows = await prisma.$queryRaw<Array<{
    lastAttemptAt: Date; lastCompletedAt: Date | null; lastSuccessAt: Date | null;
    lastFailureAt: Date | null; lastOutcome: string; lastDeleted: number | null;
    budgetExhausted: boolean; stale: boolean; attemptOverdue: boolean;
  }>>`
    SELECT "lastAttemptAt", "lastCompletedAt", "lastSuccessAt", "lastFailureAt",
      "lastOutcome", "lastDeleted", "budgetExhausted",
      ("lastSuccessAt" IS NULL OR "lastSuccessAt" <
        (statement_timestamp() AT TIME ZONE 'UTC') - interval '26 hours') AS stale,
      ("lastOutcome" = 'RUNNING' AND "lastAttemptAt" <
        (statement_timestamp() AT TIME ZONE 'UTC') - interval '1 minute') AS "attemptOverdue"
    FROM "MaintenanceJobState" WHERE "key" = ${RETENTION_JOB_KEY}
  `;
  return rows[0] ?? { lastOutcome: "NEVER_OBSERVED", stale: true };
}

export async function runObservedRateLimitRetention() {
  const runId = randomUUID();
  // No scheduler claim: an authenticated manual request can call the same endpoint.
  await prisma.$executeRaw`
    INSERT INTO "MaintenanceJobState" ("key", "activeRunId", "lastAttemptAt", "lastOutcome", "budgetExhausted")
    VALUES (${RETENTION_JOB_KEY}, ${runId}, (statement_timestamp() AT TIME ZONE 'UTC'), 'RUNNING', false)
    ON CONFLICT ("key") DO UPDATE SET "lastAttemptAt" = EXCLUDED."lastAttemptAt",
      "activeRunId" = EXCLUDED."activeRunId", "lastOutcome" = 'RUNNING',
      "lastDeleted" = NULL, "budgetExhausted" = false
  `;
  let result: Awaited<ReturnType<typeof drainRateLimitRetention>> = null;
  try {
    result = await drainRateLimitRetention();
    return result;
  } finally {
    const outcome = result === null ? "FAILED" : result.budgetExhausted ? "BACKLOG_REMAINS" : "SUCCEEDED";
    await prisma.$executeRaw`
      UPDATE "MaintenanceJobState" SET
        "lastCompletedAt" = CASE WHEN "activeRunId" = ${runId} THEN (statement_timestamp() AT TIME ZONE 'UTC') ELSE "lastCompletedAt" END,
        "lastSuccessAt" = CASE WHEN ${result !== null} THEN (statement_timestamp() AT TIME ZONE 'UTC') ELSE "lastSuccessAt" END,
        "lastFailureAt" = CASE WHEN ${result === null} THEN (statement_timestamp() AT TIME ZONE 'UTC') ELSE "lastFailureAt" END,
        "lastOutcome" = CASE WHEN "activeRunId" = ${runId} THEN ${outcome} ELSE "lastOutcome" END,
        "lastDeleted" = CASE WHEN "activeRunId" = ${runId} THEN ${result?.deleted ?? null} ELSE "lastDeleted" END,
        "budgetExhausted" = CASE WHEN "activeRunId" = ${runId} THEN ${result?.budgetExhausted ?? false} ELSE "budgetExhausted" END
      WHERE "key" = ${RETENTION_JOB_KEY}
    `;
    console.info(JSON.stringify({ event: "RATE_LIMIT_RETENTION_COMPLETED", trigger: "AUTHENTICATED_ENDPOINT", outcome, deleted: result?.deleted ?? null }));
  }
}
