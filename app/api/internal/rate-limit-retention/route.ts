import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { drainRateLimitRetention } from "@/lib/rateLimitRetention";
import { isReleaseWriteFreezeActive } from "@/lib/releaseWriteFreeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  const headers = { "Cache-Control": "no-store" };
  if (!secret || secret.length < 32 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  if (isReleaseWriteFreezeActive()) {
    return NextResponse.json({ error: "Release write freeze active" }, { status: 503, headers });
  }
  const result = await drainRateLimitRetention();
  return NextResponse.json(
    result === null ? { error: "Retention unavailable" } : result,
    { status: result === null ? 503 : 200, headers },
  );
}
