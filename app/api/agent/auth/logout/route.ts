import { NextResponse } from "next/server";
import { setAgentSessionCookie } from "@/lib/agentAuth";

export async function POST() {
  return setAgentSessionCookie(NextResponse.json({ ok: true }), "", { maxAge: 0 });
}
