import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createVersionBoundUserSession, setAgentSessionCookie } from "@/lib/agentAuth";
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
import { EncryptedDataUnavailableError } from "@/lib/crypto";
import { handleApiError } from "@/lib/apiAuth";
import { ApplicationSecurityKeyUnavailableError, requireAppEncryptionKey } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("BEGIN") }).strict(),
  z.object({ action: z.literal("CONFIRM"), code: z.string().regex(/^\d{6}$/) }).strict(),
]);

const defaults = { db: prisma, rateLimit: enforcePersistentRateLimit, getSession: getCurrentUserSessionFromRequest };

export async function POST(req: NextRequest) {
  return handleMfaEnrollment(req);
}

export async function handleMfaEnrollment(req: NextRequest, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  try {
    requireAppEncryptionKey();
    const limited = await deps.rateLimit(req, "platform-mfa-enrollment", 5, 15 * 60_000);
    if (limited) return limited;
    const session = await deps.getSession(req);
    if (!session) return json({ error: "Unauthorized" }, 401);
    const platformEnrollment = session.platformRole === "SUPER_ADMIN";
    const financeMembership = !platformEnrollment && session.activeMembershipId
      ? await deps.db.membership.findFirst({
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

    const user = await deps.db.user.findUnique({
      where: { id: session.userId },
      select: { platformMfaSecretEncrypted: true, platformMfaEnabledAt: true },
    });
    const conflict = () => json({ error: "Состояние защиты изменилось. Войдите заново" }, 409);
    if (!user || user.platformMfaEnabledAt) return conflict();
    const enrollmentGuard = {
      id: session.userId,
      sessionVersion: session.sessionVersion,
      platformMfaSecretEncrypted: user.platformMfaSecretEncrypted,
      platformMfaEnabledAt: null,
    };

    if (parsed.data.action === "BEGIN") {
      const secret = generatePlatformMfaSecret();
      const result = await deps.db.user.updateMany({
        where: enrollmentGuard,
        data: { platformMfaSecretEncrypted: encryptPlatformMfaSecret(secret) },
      });
      if (result.count !== 1) return conflict();
      return json({ secret, uri: platformMfaUri(secret) });
    }

    const secret = decryptPlatformMfaSecret(user.platformMfaSecretEncrypted ?? "");
    if (!verifyPlatformMfaCode(secret, parsed.data.code)) {
      return json({ error: "Неверный код подтверждения" }, 422);
    }
    const updated = await deps.db.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: enrollmentGuard,
        data: { platformMfaEnabledAt: new Date(), sessionVersion: { increment: 1 } },
      });
      if (claimed.count !== 1) return null;
      // The CAS increment determines this version; never adopt a later revocation.
      const result = { sessionVersion: session.sessionVersion + 1 };
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
    if (!updated) return conflict();
    const redirectTo = platformEnrollment ? "/platform-admin" : "/agent/finance";
    const token = await createVersionBoundUserSession({
      userId: session.userId,
      sessionVersion: updated.sessionVersion,
      activeMembershipId: financeMembership?.id ?? session.activeMembershipId,
      mfaVerified: true,
    });
    return setAgentSessionCookie(json({ ok: true, redirectTo, sessionVersion: updated.sessionVersion }), token);
  } catch (error) {
    if (error instanceof EncryptedDataUnavailableError || error instanceof ApplicationSecurityKeyUnavailableError) {
      return handleApiError(error, "auth/mfa");
    }
    return json({ error: "Сервис временно недоступен" }, 503);
  }
}

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (status === 503) response.headers.set("Retry-After", "5");
  return response;
}
