import { NextRequest, NextResponse } from "next/server";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";
import { resolveCommercialClientView } from "@/lib/commercialQuoteService";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await enforcePersistentRateLimit(req, "commercial-client-view", 60, 15 * 60_000);
  if (limited) return limited;
  const { code } = await params;
  const result = await resolveCommercialClientView(code);
  if (result.state === "REVOKED" || result.state === "UNAVAILABLE") {
    return NextResponse.json({ state: "UNAVAILABLE" }, { status: 404 });
  }
  if (result.state === "EXPIRED") {
    return NextResponse.json({ state: "EXPIRED" }, { status: 410 });
  }
  if (result.state === "SUPERSEDED") {
    return NextResponse.json({ state: "SUPERSEDED" }, { status: 409 });
  }
  return NextResponse.json(result);
}

export async function PATCH() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: "GET" } });
}
