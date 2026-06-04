import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { DEMO_PHONE } from "@/lib/demo";
import { enforceRateLimit } from "@/lib/rateLimit";
import { generateCode, hashOtp, normalizePhone, otpExpiry } from "@/lib/otp";
import { sendOtpSms, smsConfigured, SmsNotConfigured, SmsSendError } from "@/lib/sms";

export const runtime = "nodejs";

const Body = z.object({ phone: z.string().min(10) });

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "request-otp", 5, 60_000);
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Укажите номер телефона" }, { status: 400 });

  const { phone } = parsed.data;

  if (process.env.NODE_ENV === "development") {
    // Dev-режим: код не отправляется, показываем его прямо в ответе.
    return NextResponse.json({ ok: true, devCode: "0000", phone });
  }

  if (process.env.DEMO_MODE === "1" && phone.trim() === DEMO_PHONE) {
    // Legacy demo OTP endpoint. Основной демо-вход теперь /api/agent/auth/demo.
    return NextResponse.json({ ok: true, devCode: "0000", demo: true, phone });
  }

  // Production: создаём OTP и шлём SMS, если телефон принадлежит агенту.
  if (!smsConfigured()) {
    return NextResponse.json({ error: "SMS-провайдер не настроен" }, { status: 503 });
  }

  const normalized = normalizePhone(phone);

  try {
    const user = await prisma.user.findUnique({
      where: { phone: normalized },
      include: { agent: { select: { id: true } } },
    });

    // Отправляем код только реальному агенту. Ответ одинаков в любом случае —
    // не раскрываем, зарегистрирован ли номер (anti-enumeration).
    if (user?.agent) {
      const code = generateCode();
      await prisma.$transaction([
        prisma.otpToken.deleteMany({ where: { phone: normalized } }),
        prisma.otpToken.create({
          data: { phone: normalized, codeHash: hashOtp(code, normalized), expiresAt: otpExpiry() },
        }),
      ]);
      try {
        await sendOtpSms(normalized, code);
      } catch (e) {
        if (e instanceof SmsNotConfigured) {
          return NextResponse.json({ error: "SMS-провайдер не настроен" }, { status: 503 });
        }
        if (e instanceof SmsSendError) {
          return NextResponse.json({ error: "Не удалось отправить SMS, попробуйте позже" }, { status: 502 });
        }
        throw e;
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Сервис временно недоступен" }, { status: 503 });
  }
}
