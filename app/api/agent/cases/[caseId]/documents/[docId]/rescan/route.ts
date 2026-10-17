import { NextResponse } from "next/server";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { retryDocumentScan } from "@/lib/documentService";
import { canonicalCaseIdFromLead } from "@/lib/m3Api";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ caseId: string; docId: string }> }) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["AGENT", "MANAGER"] });
    const { caseId, docId } = await params;
    const canonicalCaseId = await canonicalCaseIdFromLead(context, caseId);
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");
    return NextResponse.json(await retryDocumentScan(context, canonicalCaseId, docId, {
      idempotencyKey, correlationId, reason: "Явный повтор после ошибки сканирования",
    }));
  } catch (error) {
    return handleApiError(error, "m3/documents/rescan");
  }
}
