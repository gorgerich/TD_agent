import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { clientIp } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";

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
  const now = new Date();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.securityRateLimitBucket.findUnique({ where: { keyHash } });
        if (!existing || existing.resetAt <= now) {
          const resetAt = new Date(now.getTime() + windowMs);
          await tx.securityRateLimitBucket.upsert({
            where: { keyHash },
            create: { keyHash, count: 1, resetAt },
            update: { count: 1, resetAt },
          });
          return { allowed: true, retryAfter: 0 };
        }
        const updated = await tx.securityRateLimitBucket.update({
          where: { keyHash },
          data: { count: { increment: 1 } },
          select: { count: true, resetAt: true },
        });
        return {
          allowed: updated.count <= limit,
          retryAfter: Math.max(1, Math.ceil((updated.resetAt.getTime() - now.getTime()) / 1000)),
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (result.allowed) return null;
      return NextResponse.json(
        { error: "Слишком много попыток. Повторите позже." },
        { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
      );
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === "P2034" || error.code === "P2002");
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new Error("Persistent rate limiter exhausted retries");
}
