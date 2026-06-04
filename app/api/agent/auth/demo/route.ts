import { NextResponse } from "next/server";
import { createAgentSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { ensureDemoAgent } from "@/lib/demo";
import { enforceRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "demo", 10, 60_000);
  if (limited) return limited;

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
