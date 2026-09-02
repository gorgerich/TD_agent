import { NextResponse } from "next/server";
import { beginDocumentReview } from "@/lib/documentService";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";

export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["DOCUMENT_REVIEWER"] });
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");
    return NextResponse.json(await beginDocumentReview(context, (await params).versionId, {
      idempotencyKey,
      correlationId,
      reason: "Проверяющий взял документ в работу",
    }));
  } catch (error) {
    return handleApiError(error, "m3/document-review/start");
  }
}
