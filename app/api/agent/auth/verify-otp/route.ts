import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isDemoMode, ensureDemoAgent, DEMO_CODE, DEMO_PHONE } from "@/lib/demo";
import { enforcePersistentIdentityRateLimit, enforcePersistentRateLimit } from "@/lib/persistentRateLimit";
import { verifyOtp, normalizePhone } from "@/lib/otp";
import { createAgentSession, createVersionBoundUserSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { requireAppEncryptionKey } from "@/lib/session";

export const runtime = "nodejs";
const Body = z.object({ phone: z.string().min(10).max(30), code: z.string().min(4).max(6) });
const defaults = {
  db: prisma,
  rateLimit: enforcePersistentRateLimit,
  identityRateLimit: enforcePersistentIdentityRateLimit,
  createSession: createVersionBoundUserSession,
  demo: ensureDemoAgent,
  createDemoSession: createAgentSession,
};

export async function POST(req: NextRequest) {
  return handleVerifyOtp(req);
}

export async function handleVerifyOtp(req: NextRequest, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  const invalid = () => NextResponse.json({ error: "Неверный или просроченный код" }, { status: 401 });
  try {
    requireAppEncryptionKey();
    const limited = await deps.rateLimit(req, "verify-otp-ip", 10, 60_000);
    if (limited) return limited;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
    const { code } = parsed.data;
    const phone = normalizePhone(parsed.data.phone);
    if (!/^\+7\d{10}$/.test(phone)) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
    const accountLimited = await deps.identityRateLimit("verify-otp-phone", phone, 10, 60_000);
    if (accountLimited) return accountLimited;
    if (isDemoMode() && phone === DEMO_PHONE) {
      if (code !== DEMO_CODE) return invalid();
      const demo = await deps.demo();
      const token = await deps.createDemoSession({ userId: demo.userId, agentId: demo.agentId, name: demo.name });
      return setAgentSessionCookie(NextResponse.json({ ok: true }), token);
    }
    if (!/^\d{6}$/.test(code)) return invalid();
    const otp = await deps.db.otpToken.findFirst({
      where: { phone, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" },
    });
    if (!otp || !verifyOtp(code, phone, otp.codeHash)) return invalid();
    const user = await deps.db.user.findUnique({
      where: { phone },
      include: {
        agent: true,
        memberships: {
          where: { status: "ACTIVE", organization: { status: "ACTIVE" }, agent: { status: "ACTIVE" } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const membership = user?.memberships.find((entry) => entry.agentId === user.agent?.id);
    if (!user?.agent || user.agent.status !== "ACTIVE" || !membership) return invalid();
    // Claim exactly the verified, still-live token. Concurrent attempts cannot both win.
    const consumed = await deps.db.otpToken.deleteMany({
      where: { id: otp.id, phone, codeHash: otp.codeHash, expiresAt: { gt: new Date() } },
    });
    if (consumed.count !== 1) return invalid();
    const token = await deps.createSession({
      userId: user.id, sessionVersion: user.sessionVersion, activeMembershipId: membership.id, name: user.name,
    });
    return setAgentSessionCookie(NextResponse.json({ ok: true }), token);
  } catch {
    return NextResponse.json({ error: "Сервис временно недоступен" }, { status: 503, headers: { "Retry-After": "5" } });
  }
}
