import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createUserSession, normalizeEmail, setAgentSessionCookie } from "@/lib/agentAuth";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().trim().email("Укажите email"),
  password: z.string().min(1, "Укажите пароль"),
});

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "login", 10, 60_000);
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Неверный запрос" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      passwordHash: true,
      platformRole: true,
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

  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  const activeMembership = user.memberships[0];
  if (user.platformRole !== "SUPER_ADMIN" && !activeMembership) {
    return NextResponse.json({ error: "Рабочий доступ приостановлен или не назначен" }, { status: 403 });
  }

  const token = await createUserSession({
    userId: user.id,
    activeMembershipId: activeMembership?.id,
    name: user.name,
  });
  const redirectTo = user.platformRole === "SUPER_ADMIN" ? "/platform-admin" : "/agent/cases";

  return setAgentSessionCookie(NextResponse.json({ ok: true, redirectTo }), token);
}
