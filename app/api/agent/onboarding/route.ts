import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/apiAuth";

// POST /api/agent/onboarding — отметить, что агент прошёл интерактивный онбординг.
export async function POST(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    // В dev-заглушке agentId = 0 — записи нет, просто отвечаем ok.
    if (!session.agentId) {
      return NextResponse.json({ ok: true, dev: true });
    }
    await prisma.agent.update({
      where: { id: session.agentId },
      data: { onboardingCompleted: true },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error, "onboarding");
  }
}
