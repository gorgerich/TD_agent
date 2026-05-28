import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import {
  createAgentSession,
  getDefaultAgentTierId,
  normalizeEmail,
  normalizeOptionalPhone,
  setAgentSessionCookie,
} from "@/lib/agentAuth";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().trim().min(2, "Укажите имя"),
  email: z.string().trim().email("Укажите email"),
  phone: z.string().trim().optional(),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов"),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Неверный запрос" }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const phone = normalizeOptionalPhone(parsed.data.phone);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
    select: { id: true, email: true, phone: true },
  });

  if (existing) {
    return NextResponse.json({ error: "Агент с таким email или телефоном уже зарегистрирован" }, { status: 409 });
  }

  const tierId = await getDefaultAgentTierId();
  const passwordHash = hashPassword(parsed.data.password);

  const agent = await prisma.agent.create({
    data: {
      status: "ACTIVE",
      selfEmployed: true,
      tier: { connect: { id: tierId } },
      user: {
        create: {
          email,
          name: parsed.data.name.trim(),
          phone,
          passwordHash,
        },
      },
    },
    include: { user: true },
  });

  const token = await createAgentSession({
    userId: agent.userId,
    agentId: agent.id,
    name: agent.user.name,
  });

  return setAgentSessionCookie(NextResponse.json({ ok: true }), token);
}
