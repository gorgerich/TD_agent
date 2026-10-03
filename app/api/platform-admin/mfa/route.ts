import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUserSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { getCurrentUserSessionFromRequest } from "@/lib/auth";
import {
  decryptPlatformMfaSecret,
  encryptPlatformMfaSecret,
  generatePlatformMfaSecret,
  platformMfaUri,
  verifyPlatformMfaCode,
} from "@/lib/platformMfa";
import { appendPlatformAudit } from "@/lib/platformAudit";
import { appendOperationalAudit } from "@/lib/operationalAudit";
import { prisma } from "@/lib/prisma";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("BEGIN") }).strict(),
  z.object({ action: z.literal("CONFIRM"), code: z.string().regex(/^\d{6}$/) }).strict(),
]);

export async function POST(req: NextRequest) {
  const limited = await enforcePersistentRateLimit(req, "platform-mfa-enrollment", 5, 15 * 60_000);
  if (limited) return limited;
  const session = await getCurrentUserSessionFromRequest(req);
  if (!session) return json({ error: "Unauthorized" }, 401);
  const platformEnrollment = session.platformRole === "SUPER_ADMIN";
  const financeMembership = !platformEnrollment && session.activeMembershipId
    ? await prisma.membership.findFirst({
        where: {
          id: session.activeMembershipId,
          userId: session.userId,
          role: "FINANCE",
          status: "ACTIVE",
          organization: { status: "ACTIVE" },
          agent: { status: "ACTIVE" },
        },
        select: { id: true, organizationId: true },
      })
    : null;
  if (!platformEnrollment && !financeMembership) return json({ error: "Forbidden" }, 403);
  if (session.platformMfaEnabled) return json({ error: "Двухфакторная защита уже включена" }, 409);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Неверный запрос" }, 400);

  if (parsed.data.action === "BEGIN") {
    const secret = generatePlatformMfaSecret();
    await prisma.user.update({
      where: { id: session.userId },
      data: { platformMfaSecretEncrypted: encryptPlatformMfaSecret(secret) },
    });
    return json({ secret, uri: platformMfaUri(secret) });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { platformMfaSecretEncrypted: true, platformMfaEnabledAt: true },
  });
  const secret = user?.platformMfaSecretEncrypted
    ? decryptPlatformMfaSecret(user.platformMfaSecretEncrypted)
    : "";
  if (!secret || user?.platformMfaEnabledAt || !verifyPlatformMfaCode(secret, parsed.data.code)) {
    return json({ error: "Неверный код подтверждения" }, 422);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id: session.userId },
      data: { platformMfaEnabledAt: new Date(), sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
    if (platformEnrollment) {
      await appendPlatformAudit(tx, {
        actorUserId: session.userId,
        action: "PLATFORM_MFA_ENABLED",
        targetType: "user",
        targetId: String(session.userId),
        metadata: { source: "authenticated-enrollment" },
      });
    } else if (financeMembership) {
      await appendOperationalAudit(tx, {
        organizationId: financeMembership.organizationId,
        membershipId: financeMembership.id,
      }, {
        entityType: "membership",
        entityId: financeMembership.id,
        action: "finance.mfa_enabled.v1",
        before: {},
        after: { mfaEnabled: true },
        correlationId: `finance-mfa:${session.userId}:${result.sessionVersion}`,
        idempotencyKey: `finance-mfa-enabled:${session.userId}:${result.sessionVersion}`,
        reason: "Обязательная двухфакторная защита финансовой роли",
        result: { userId: session.userId, membershipId: financeMembership.id },
      });
    }
    return result;
  });
  const redirectTo = platformEnrollment ? "/platform-admin" : "/agent/finance";
  const token = await createUserSession({
    userId: session.userId,
    activeMembershipId: financeMembership?.id ?? session.activeMembershipId,
    mfaVerified: true,
  });
  return setAgentSessionCookie(json({ ok: true, redirectTo, sessionVersion: updated.sessionVersion }), token);
}

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
