import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserSessionFromRequest, getSessionFromRequest } from "@/lib/auth";
import { createVersionBoundUserSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { prisma } from "@/lib/prisma";
import { verifyPassword, hashPassword } from "@/lib/password";
import { handleApiError } from "@/lib/apiAuth";

export const runtime = "nodejs";

const Schema = z.object({
  current: z.string().min(1).max(200),
  next: z.string().min(8, "Минимум 8 символов").max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    const userSession = session ? await getCurrentUserSessionFromRequest(req) : null;
    if (!session || !userSession || session.userId !== userSession.userId) {
      return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { passwordHash: true, sessionVersion: true },
    });
    if (user && user.sessionVersion !== userSession.sessionVersion) {
      return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });
    }
    if (!user?.passwordHash) {
      return NextResponse.json({ error: "Пароль недоступен для этого аккаунта (демо/B2C)" }, { status: 400 });
    }
    if (!verifyPassword(parsed.data.current, user.passwordHash)) {
      return NextResponse.json({ error: "Текущий пароль неверный" }, { status: 400 });
    }

    const changed = await prisma.user.updateMany({
      where: { id: session.userId, passwordHash: user.passwordHash, sessionVersion: userSession.sessionVersion },
      data: { passwordHash: hashPassword(parsed.data.next), sessionVersion: { increment: 1 } },
    });
    if (changed.count !== 1) {
      return NextResponse.json({ error: "Данные доступа изменились — войдите снова" }, { status: 409 });
    }
    // Never adopt a later revocation while replacing the caller's session.
    const token = await createVersionBoundUserSession({
      userId: session.userId,
      sessionVersion: userSession.sessionVersion + 1,
      activeMembershipId: session.membershipId,
      mfaVerified: userSession.mfaVerified,
      name: userSession.name,
    });
    return setAgentSessionCookie(NextResponse.json({ ok: true }), token);
  } catch (err) {
    return handleApiError(err, "settings/password");
  }
}
