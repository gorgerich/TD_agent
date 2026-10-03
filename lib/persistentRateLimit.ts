import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { clientIp } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";
import { tryLoginRateLimitRetention } from "@/lib/rateLimitRetention";

export function persistentRateLimitKey(bucket: string, ip: string): string {
  return createHash("sha256").update(`${bucket}:${ip}`).digest("hex");
}

export async function enforcePersistentRateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  const keyHash = persistentRateLimitKey(bucket, clientIp(req));
  return consumePersistentRateLimit(keyHash, limit, windowMs);
}

/** Shared-instance limit for a normalized account or token identity. Only its hash is stored. */
export async function enforcePersistentIdentityRateLimit(
  bucket: string,
  identity: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  const keyHash = persistentRateLimitKey(bucket, identity);
  return consumePersistentRateLimit(keyHash, limit, windowMs);
}

async function consumePersistentRateLimit(
  keyHash: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  const [result] = await prisma.$queryRaw<Array<{ count: number; resetAt: Date; observedAt: Date }>>(Prisma.sql`
    INSERT INTO "SecurityRateLimitBucket" AS bucket ("keyHash", "count", "resetAt", "updatedAt")
    VALUES (${keyHash}, 1,
      (statement_timestamp() AT TIME ZONE 'UTC') + (${windowMs} * interval '1 millisecond'),
      (statement_timestamp() AT TIME ZONE 'UTC'))
    ON CONFLICT ("keyHash") DO UPDATE SET
      "count" = CASE
        WHEN bucket."resetAt" <= EXCLUDED."updatedAt" THEN 1
        ELSE bucket."count" + 1
      END,
      "resetAt" = CASE
        WHEN bucket."resetAt" <= EXCLUDED."updatedAt" THEN EXCLUDED."resetAt"
        ELSE bucket."resetAt"
      END,
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "count", "resetAt", (statement_timestamp() AT TIME ZONE 'UTC') AS "observedAt"
  `);
  if (!result) throw new Error("Persistent rate limiter did not return a bucket");
  if (result.count <= limit) {
    await tryLoginRateLimitRetention();
    return null;
  }
  const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - result.observedAt.getTime()) / 1000));
  return NextResponse.json(
    { error: "Слишком много попыток. Повторите позже." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
