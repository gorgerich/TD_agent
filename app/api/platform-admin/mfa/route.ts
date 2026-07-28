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
  if (session.platformRole !== "SUPER_ADMIN") return json({ error: "Forbidden" }, 403);
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
    await appendPlatformAudit(tx, {
      actorUserId: session.userId,
      action: "PLATFORM_MFA_ENABLED",
      targetType: "user",
      targetId: String(session.userId),
      metadata: { source: "authenticated-enrollment" },
    });
    return result;
  });
  const token = await createUserSession({ userId: session.userId, mfaVerified: true });
  return setAgentSessionCookie(json({ ok: true, redirectTo: "/platform-admin", sessionVersion: updated.sessionVersion }), token);
}

function json(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
