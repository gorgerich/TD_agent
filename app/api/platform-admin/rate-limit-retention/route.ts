import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/apiAuth";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { getRateLimitRetentionHealth } from "@/lib/rateLimitRetentionHealth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requirePlatformAdmin(req);
    return NextResponse.json(await getRateLimitRetentionHealth(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return handleApiError(error, "platform/rate-limit-retention");
  }
}
