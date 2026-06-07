import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/apiAuth";

export const runtime = "nodejs";

const Schema = z.object({ enabled: z.boolean() });

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });

  try {
    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Проверьте поля" }, { status: 400 });

    await prisma.agent.update({
      where: { id: session.agentId },
      data: { notifyEnabled: parsed.data.enabled },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "settings/notify");
  }
}
