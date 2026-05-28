import { NextResponse } from "next/server";
import { createAgentSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { ensureDemoAgent } from "@/lib/demo";

export const runtime = "nodejs";

export async function POST() {
  try {
    const demo = await ensureDemoAgent();
    const token = await createAgentSession({
      userId: demo.userId,
      agentId: demo.agentId,
      name: demo.name,
    });

    return setAgentSessionCookie(NextResponse.json({ ok: true }), token);
  } catch (e) {
    return NextResponse.json(
      { error: "Демо недоступно: " + (e instanceof Error ? e.message : "ошибка") },
      { status: 500 },
    );
  }
}
