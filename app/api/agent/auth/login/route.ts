import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordNeedsUpgrade, verifyPasswordForLogin } from "@/lib/password";
import { createVersionBoundUserSession, normalizeEmail, setAgentSessionCookie } from "@/lib/agentAuth";
import { handleApiError } from "@/lib/apiAuth";
import { requireAppEncryptionKey, ApplicationSecurityKeyUnavailableError } from "@/lib/session";
import { EncryptedDataUnavailableError } from "@/lib/crypto";
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

const defaults = {
  db: prisma,
  rateLimit: enforcePersistentRateLimit,
  identityRateLimit: enforcePersistentIdentityRateLimit,
  verifyPassword: verifyPasswordForLogin,
  createSession: createVersionBoundUserSession,
};

export async function POST(req: NextRequest) {
  return handleLogin(req);
}

export async function handleLogin(req: NextRequest, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  try {
    requireAppEncryptionKey();
    const clientLimited = await deps.rateLimit(req, "login-ip", 10, 60_000);
    if (clientLimited) return clientLimited;

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Неверный запрос" }, { status: 400 });
    }

    const email = normalizeEmail(parsed.data.email);
    const accountLimited = await deps.identityRateLimit("login-account", email, 10, 60_000);
    if (accountLimited) return accountLimited;
    const user = await deps.db.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        passwordHash: true,
        sessionVersion: true,
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

    const passwordValid = deps.verifyPassword(parsed.data.password, user?.passwordHash);
    if (!user || !passwordValid) {
      return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
    }

    const activeMembership = user.memberships[0];
    if (user.platformRole !== "SUPER_ADMIN" && !activeMembership) {
      return NextResponse.json({ error: "Рабочий доступ приостановлен или не назначен" }, { status: 403 });
    }

    const mfaRequiredForRole = user.platformRole === "SUPER_ADMIN" || activeMembership?.role === "FINANCE";
    let mfaVerified = false;
    if (mfaRequiredForRole && user.platformMfaEnabledAt) {
      const secret = decryptPlatformMfaSecret(user.platformMfaSecretEncrypted ?? "");
      if (!parsed.data.mfaCode) {
        return NextResponse.json({ error: "Введите код подтверждения", mfaRequired: true });
      }
      if (!secret || !verifyPlatformMfaCode(secret, parsed.data.mfaCode)) {
        return NextResponse.json({ error: "Неверный код подтверждения", mfaRequired: true }, { status: 401 });
      }
      mfaVerified = true;
    }

    if (user.passwordHash && passwordNeedsUpgrade(user.passwordHash)) {
      const upgraded = await deps.db.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash, sessionVersion: user.sessionVersion },
        data: { passwordHash: hashPassword(parsed.data.password) },
      });
      if (upgraded.count !== 1) {
        return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
      }
    }

    const token = await deps.createSession({
      userId: user.id,
      sessionVersion: user.sessionVersion,
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
  } catch (error) {
    if (error instanceof ApplicationSecurityKeyUnavailableError) {
      return handleApiError(error, "auth/login");
    }
    if (error instanceof EncryptedDataUnavailableError) return handleApiError(error, "auth/login");
    return NextResponse.json({ error: "Сервис временно недоступен" }, { status: 503, headers: { "Retry-After": "5" } });
  }
}
