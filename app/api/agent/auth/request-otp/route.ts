import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const Body = z.object({ phone: z.string().min(10) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Укажите номер телефона" }, { status: 400 });

  const { phone } = parsed.data;

  if (process.env.NODE_ENV === "development" || process.env.DEMO_MODE === "1") {
    // Демо-режим: код не отправляется, показываем его прямо в ответе.
    return NextResponse.json({ ok: true, devCode: "0000", demo: process.env.DEMO_MODE === "1", phone });
  }

  // Production: lookup user by phone, generate OTP, send SMS
  // TODO: implement when SMS provider is configured
  return NextResponse.json({ error: "SMS-провайдер не настроен" }, { status: 503 });
}
