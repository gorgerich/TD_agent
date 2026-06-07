import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/password";
import { handleApiError } from "@/lib/apiAuth";

export const runtime = "nodejs";

const Schema = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(8, "Минимум 8 символов").max(200),
});

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });

  try {
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { passwordHash: true } });
    if (!user?.passwordHash) {
      return NextResponse.json({ error: "Пароль недоступен для этого аккаунта (демо/B2C)" }, { status: 400 });
    }
    if (!verifyPassword(parsed.data.current, user.passwordHash)) {
      return NextResponse.json({ error: "Текущий пароль неверный" }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: { passwordHash: hashPassword(parsed.data.next) },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "settings/password");
  }
}
