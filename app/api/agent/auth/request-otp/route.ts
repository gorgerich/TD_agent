import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { enforcePersistentIdentityRateLimit, enforcePersistentRateLimit } from "@/lib/persistentRateLimit";
import { generateCode, hashOtp, normalizePhone, otpExpiry } from "@/lib/otp";
import { sendOtpSms, smsConfigured } from "@/lib/sms";
import { requireAppEncryptionKey } from "@/lib/session";

export const runtime = "nodejs";
const Body = z.object({ phone: z.string().min(10).max(30) });
const defaults = {
  db: prisma,
  rateLimit: enforcePersistentRateLimit,
  identityRateLimit: enforcePersistentIdentityRateLimit,
  configured: smsConfigured,
  sendSms: sendOtpSms,
  schedule: (task: () => Promise<void>) => after(task),
};

export async function POST(req: NextRequest) {
  return handleRequestOtp(req);
}

export async function handleRequestOtp(req: NextRequest, overrides: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...overrides };
  try {
    requireAppEncryptionKey();
    const limited = await deps.rateLimit(req, "request-otp-ip", 5, 60_000);
    if (limited) return limited;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Укажите номер телефона" }, { status: 400 });
    const phone = normalizePhone(parsed.data.phone);
    if (!/^\+7\d{10}$/.test(phone)) return NextResponse.json({ error: "Укажите номер телефона" }, { status: 400 });
    const accountLimited = await deps.identityRateLimit("request-otp-phone", phone, 5, 60_000);
    if (accountLimited) return accountLimited;
    // Validate service configuration equally for every recipient, before scheduling.
    const code = generateCode();
    const codeHash = hashOtp(code, phone);
    if (!deps.configured()) return NextResponse.json({ error: "Сервис временно недоступен" }, { status: 503, headers: { "Retry-After": "5" } });
    deps.schedule(async () => {
      try {
        const user = await deps.db.user.findUnique({
          where: { phone }, include: { agent: { select: { id: true, status: true } } },
        });
        if (!user?.agent || user.agent.status !== "ACTIVE") return;
        await deps.db.$transaction(async (tx) => {
          await tx.otpToken.deleteMany({ where: { phone } });
          await tx.otpToken.create({ data: { phone, codeHash, expiresAt: otpExpiry() } });
        }, { isolationLevel: "Serializable" });
        try {
          await deps.sendSms(phone, code);
        } catch {
          await deps.db.otpToken.deleteMany({ where: { phone, codeHash } });
          throw new Error("OTP delivery failed");
        }
      } catch {
        // Never log phone numbers, codes, provider errors or database query arguments.
        console.error("[auth] OTP_DELIVERY_UNAVAILABLE");
      }
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Сервис временно недоступен" }, { status: 503, headers: { "Retry-After": "5" } });
  }
}
