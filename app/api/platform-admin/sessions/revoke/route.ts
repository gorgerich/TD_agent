import { NextRequest, NextResponse } from "next/server";
import { createVersionBoundUserSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { AuthenticationError } from "@/lib/auth";
import { appendPlatformAudit } from "@/lib/platformAudit";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { prisma } from "@/lib/prisma";
import { requireAppEncryptionKey } from "@/lib/session";

const defaults = { db: prisma, requireAdmin: requirePlatformAdmin, createSession: createVersionBoundUserSession };

export async function POST(req: NextRequest) {
  return handleSessionRevocation(req);
}

export async function handleSessionRevocation(req: NextRequest, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  try {
    requireAppEncryptionKey();
    const context = await deps.requireAdmin(req);
    const claimedVersion = await deps.db.$transaction(async (tx) => {
      const claimed = await tx.user.updateMany({
        where: {
          id: context.userId,
          sessionVersion: context.sessionVersion,
          platformRole: "SUPER_ADMIN",
          platformMfaEnabledAt: { not: null },
        },
        data: { sessionVersion: { increment: 1 } },
      });
      if (claimed.count !== 1) return null;
      const sessionVersion = context.sessionVersion + 1;
      await appendPlatformAudit(tx, {
        actorUserId: context.userId,
        action: "PLATFORM_SESSIONS_REVOKED",
        targetType: "user",
        targetId: String(context.userId),
        metadata: { scope: "all-other-sessions", previousSessionVersion: context.sessionVersion, sessionVersion },
      });
      return sessionVersion;
    });
    if (claimedVersion === null) return json({ error: "Состояние защиты изменилось. Войдите заново" }, 409);
    // Sign only our CAS increment; never adopt a revocation committed after it.
    const token = await deps.createSession({
      userId: context.userId,
      sessionVersion: claimedVersion,
      activeMembershipId: context.activeMembershipId,
      mfaVerified: true,
      name: context.name,
    });
    return setAgentSessionCookie(json({ ok: true }), token);
  } catch (error) {
    if (error instanceof AuthenticationError) return json({ error: error.message }, error.status);
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
