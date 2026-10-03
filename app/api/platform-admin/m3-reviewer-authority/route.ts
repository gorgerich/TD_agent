import { createHash, randomBytes } from "node:crypto";
import { type Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import {
  M3ReviewerAuthorityGrantMetadata,
  M3ReviewerAuthorityGrantInput,
  runM3ReviewerCredentialTransaction,
} from "@/lib/m3ReviewerCredential";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import { appendPlatformAudit } from "@/lib/platformAudit";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";
import { requirePlatformAdmin, type PlatformContext } from "@/lib/platformAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const AUTHORITY_GRANT_TTL_MS = 15 * 60 * 1_000;
const MAX_AUTHORITY_SESSION_AGE_MS = 15 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 30 * 1_000;

export async function POST(req: Request) {
  try {
    const limited = await enforcePersistentRateLimit(req, "m3-reviewer-authority-grant", 5, 15 * 60_000);
    if (limited) return limited;
    const context = await requirePlatformAdmin(req);
    const parsed = M3ReviewerAuthorityGrantInput.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Некорректная цель reviewer authority grant");
    const grant = await runM3ReviewerCredentialTransaction(
      prisma,
      (tx) => issueReviewerAuthorityGrantFromAuthenticatedRoute(tx, context, parsed.data),
    );
    const response = NextResponse.json({
      authorityGrant: grant.token,
      expiresAt: grant.expiresAt.toISOString(),
      auditEventId: grant.auditEventId,
    }, { status: 201 });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    return handleApiError(error, "platform/m3-reviewer-authority");
  }
}

async function issueReviewerAuthorityGrantFromAuthenticatedRoute(
  tx: Prisma.TransactionClient,
  context: PlatformContext,
  input: { operation: "REGISTER" | "REVOKE"; keyFingerprint: string },
) {
  const now = await databaseNow(tx);
  const sessionIssuedAt = new Date(context.sessionIssuedAtEpochSeconds * 1_000);
  const sessionAgeMs = now.getTime() - sessionIssuedAt.getTime();
  if (sessionAgeMs < -MAX_CLOCK_SKEW_MS || sessionAgeMs > MAX_AUTHORITY_SESSION_AGE_MS) {
    throw new OperationalCommandError(403, "Fresh MFA-verified Platform SUPER_ADMIN session is required");
  }
  const actor = await tx.user.findUnique({
    where: { id: context.userId },
    select: { platformRole: true, platformMfaEnabledAt: true, sessionVersion: true },
  });
  if (
    actor?.platformRole !== "SUPER_ADMIN"
    || actor.platformMfaEnabledAt == null
    || actor.sessionVersion !== context.sessionVersion
    || context.mfaVerified !== true
  ) {
    throw new OperationalCommandError(403, "Current MFA-verified Platform SUPER_ADMIN authority is required");
  }
  const expiresAt = new Date(now.getTime() + AUTHORITY_GRANT_TTL_MS);
  const token = randomBytes(32).toString("base64url");
  const grantFingerprint = createHash("sha256").update(token).digest("hex");
  const event = await appendPlatformAudit(tx, {
    actorUserId: context.userId,
    action: "M3_REVIEWER_AUTHORITY_GRANTED",
    targetType: "m3-reviewer-authority",
    targetId: grantFingerprint,
    metadata: M3ReviewerAuthorityGrantMetadata.parse({
      schemaVersion: 2,
      operation: input.operation,
      keyFingerprint: input.keyFingerprint,
      actorUserId: context.userId,
      actorPlatformRoleAtEvent: "SUPER_ADMIN",
      authoritySessionVersion: context.sessionVersion,
      authorityMfaVerified: true,
      authoritySessionIssuedAt: sessionIssuedAt.toISOString(),
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }),
    createdAt: now,
  });
  return { token, expiresAt, auditEventId: event.id };
}

async function databaseNow(tx: Prisma.TransactionClient) {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  if (!clock?.now) throw new OperationalCommandError(503, "Database clock is unavailable");
  return clock.now;
}
