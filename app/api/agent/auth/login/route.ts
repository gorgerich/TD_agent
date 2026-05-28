import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createAgentSession, normalizeEmail, setAgentSessionCookie } from "@/lib/agentAuth";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().trim().email("Укажите email"),
  password: z.string().min(1, "Укажите пароль"),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Неверный запрос" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findUnique({
    where: { email },
    include: { agent: true },
  });

  if (!user?.agent || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  if (user.agent.status !== "ACTIVE") {
    return NextResponse.json({ error: "Профиль агента не активен" }, { status: 403 });
  }

  const token = await createAgentSession({
    userId: user.id,
    agentId: user.agent.id,
    name: user.name,
  });

  return setAgentSessionCookie(NextResponse.json({ ok: true }), token);
}
