import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signSession, SESSION_COOKIE } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isDemoMode, ensureDemoAgent, DEMO_CODE, DEMO_PHONE } from "@/lib/demo";

function sessionCookie(res: NextResponse, token: string) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 8 * 60 * 60,
  });
  return res;
}

const Body = z.object({
  phone: z.string().min(10),
  code: z.string().min(4),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });

  const { phone, code } = parsed.data;

  // Демо-режим (DEMO_MODE=1): любой входит по коду 0000 и попадает в кабинет
  // демо-агента с примерами данных. Витрина — НЕ боевой вход.
  if (isDemoMode() && phone.trim() === DEMO_PHONE) {
    if (code !== DEMO_CODE) return NextResponse.json({ error: "Демо-код: 0000" }, { status: 401 });
    try {
      const demo = await ensureDemoAgent();
      const token = await signSession({ userId: demo.userId, agentId: demo.agentId, role: "AGENT", name: demo.name });
      return sessionCookie(NextResponse.json({ ok: true }), token);
    } catch (e) {
      return NextResponse.json({ error: "Демо недоступно: " + (e instanceof Error ? e.message : "ошибка") }, { status: 500 });
    }
  }

  if (process.env.NODE_ENV === "development") {
    if (code !== "0000") return NextResponse.json({ error: "Неверный код (dev: 0000)" }, { status: 401 });

    // Try to find a real agent in DB by email (phone not yet in schema); fall back to mock
    let userId = 0, agentId = 0;
    try {
      const agent = await prisma.agent.findFirst({ where: { user: { email: { contains: phone } } }, include: { user: true } });
      if (agent) { userId = agent.userId; agentId = agent.id; }
    } catch { /* DB not available */ }

    const token = await signSession({ userId, agentId, role: "AGENT", name: "Агент (dev)" });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: 8 * 60 * 60,
    });
    return res;
  }

  // Production: verify OtpToken, find user/agent, issue JWT
  // TODO: implement when DB is migrated and SMS provider is configured
  return NextResponse.json({ error: "Требуется настройка" }, { status: 503 });
}
