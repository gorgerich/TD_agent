import { NextResponse } from "next/server";
import { createAgentSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { ensureDemoAgent, isDemoMode } from "@/lib/demo";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireAppEncryptionKey } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ available: isDemoMode() }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  if (!isDemoMode()) return NextResponse.json({ error: "Демо-режим отключён" }, { status: 404 });
  const limited = enforceRateLimit(req, "demo", 10, 60_000);
  if (limited) return limited;

  try {
    requireAppEncryptionKey();
    const demo = await ensureDemoAgent();
    const token = await createAgentSession({
      userId: demo.userId,
      agentId: demo.agentId,
      name: demo.name,
    });

    return setAgentSessionCookie(NextResponse.json({ ok: true }), token);
  } catch {
    return NextResponse.json(
      { error: "Демо временно недоступно" },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
}
