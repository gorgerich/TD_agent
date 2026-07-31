import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import { recordCommercialClientDecision } from "@/lib/commercialQuoteService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await enforcePersistentRateLimit(req, "commercial-client-decision", 12, 15 * 60_000);
  if (limited) return limited;
  try {
    const { code } = await params;
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) return jsonError(400, "Отсутствует ключ подтверждения");
    const result = await recordCommercialClientDecision({
      token: code,
      type: "ACCEPTED",
      idempotencyKey,
      correlationId: req.headers.get("x-correlation-id")?.trim() || randomUUID(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return handleApiError(error, "quote/client-accept");
  }
}
