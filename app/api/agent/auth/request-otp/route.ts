import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEMO_PHONE } from "@/lib/demo";
import { enforceRateLimit } from "@/lib/rateLimit";

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

  // Production: lookup user by phone, generate OTP, send SMS
  // TODO: implement when SMS provider is configured
  return NextResponse.json({ error: "SMS-провайдер не настроен" }, { status: 503 });
}
