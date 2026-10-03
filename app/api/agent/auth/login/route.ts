import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createUserSession, normalizeEmail, setAgentSessionCookie } from "@/lib/agentAuth";
import {
  enforcePersistentIdentityRateLimit,
  enforcePersistentRateLimit,
} from "@/lib/persistentRateLimit";
import {
  decryptPlatformMfaSecret,
  verifyPlatformMfaCode,
} from "@/lib/platformMfa";
import { operationalLanding } from "@/lib/operationalAuth";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().trim().email("Укажите email"),
  password: z.string().min(1, "Укажите пароль"),
  mfaCode: z.string().regex(/^\d{6}$/).optional(),
});

export async function POST(req: NextRequest) {
  const clientLimited = await enforcePersistentRateLimit(req, "login-ip", 10, 60_000);
  if (clientLimited) return clientLimited;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Неверный запрос" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const accountLimited = await enforcePersistentIdentityRateLimit("login-account", email, 10, 60_000);
  if (accountLimited) return accountLimited;
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      passwordHash: true,
      platformRole: true,
      platformMfaSecretEncrypted: true,
      platformMfaEnabledAt: true,
      memberships: {
        where: {
          status: "ACTIVE",
          organization: { status: "ACTIVE" },
          agent: { status: "ACTIVE" },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true },
      },
    },
  });

  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  const activeMembership = user.memberships[0];
  if (user.platformRole !== "SUPER_ADMIN" && !activeMembership) {
    return NextResponse.json({ error: "Рабочий доступ приостановлен или не назначен" }, { status: 403 });
  }

  const mfaRequiredForRole = user.platformRole === "SUPER_ADMIN" || activeMembership?.role === "FINANCE";
  let mfaVerified = false;
  if (mfaRequiredForRole && user.platformMfaEnabledAt) {
    const secret = user.platformMfaSecretEncrypted
      ? decryptPlatformMfaSecret(user.platformMfaSecretEncrypted)
      : "";
    if (!parsed.data.mfaCode) {
      return NextResponse.json({ error: "Введите код подтверждения", mfaRequired: true });
    }
    if (!secret || !verifyPlatformMfaCode(secret, parsed.data.mfaCode)) {
      return NextResponse.json({ error: "Неверный код подтверждения", mfaRequired: true }, { status: 401 });
    }
    mfaVerified = true;
  }

  const token = await createUserSession({
    userId: user.id,
    activeMembershipId: activeMembership?.id,
    mfaVerified,
    name: user.name,
  });
  const redirectTo = mfaRequiredForRole && !user.platformMfaEnabledAt
    ? "/setup/platform-admin-mfa"
    : user.platformRole === "SUPER_ADMIN"
      ? "/platform-admin"
      : operationalLanding(activeMembership!.role);

  return setAgentSessionCookie(NextResponse.json({ ok: true, redirectTo }), token);
}
