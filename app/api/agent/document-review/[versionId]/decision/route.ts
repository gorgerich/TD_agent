import { NextResponse } from "next/server";
import { z } from "zod";
import { decideDocumentReview } from "@/lib/documentService";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";

const Body = z.object({
  decision: z.enum(["VERIFIED", "REJECTED"]),
  checklist: z.record(z.string().min(1).max(120), z.boolean()),
  reason: z.string().trim().min(3).max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["DOCUMENT_REVIEWER"] });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректное решение");
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");
    return NextResponse.json(await decideDocumentReview(context, (await params).versionId, {
      ...parsed.data,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    }, { idempotencyKey, correlationId, reason: parsed.data.reason ?? "Решение по документу" }));
  } catch (error) {
    return handleApiError(error, "m3/document-review/decision");
  }
}
