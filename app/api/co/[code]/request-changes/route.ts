import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import { recordCommercialClientDecision } from "@/lib/commercialQuoteService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ comment: z.string().trim().min(3).max(2000) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const limited = await enforcePersistentRateLimit(req, "commercial-client-decision", 12, 15 * 60_000);
  if (limited) return limited;
  try {
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) return jsonError(400, "Опишите, что нужно изменить");
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey) return jsonError(400, "Отсутствует ключ запроса");
    const { code } = await params;
    const result = await recordCommercialClientDecision({
      token: code,
      type: "CHANGES_REQUESTED",
      comment: body.data.comment,
      idempotencyKey,
      correlationId: req.headers.get("x-correlation-id")?.trim() || randomUUID(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return handleApiError(error, "quote/client-changes");
  }
}
