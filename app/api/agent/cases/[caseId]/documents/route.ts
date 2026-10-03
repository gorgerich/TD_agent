import { NextRequest, NextResponse } from "next/server";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { listCaseDocumentRequirements } from "@/lib/documentRequirementService";
import { uploadCaseDocument } from "@/lib/documentService";
import { canonicalCaseIdFromLead } from "@/lib/m3Api";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const context = await requireAgent(req);
    const canonicalCaseId = await canonicalCaseIdFromLead(context, (await params).caseId);
    return NextResponse.json({ requirements: await listCaseDocumentRequirements(context, canonicalCaseId) });
  } catch (error) {
    return handleApiError(error, "m3/documents/list");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const context = await requireAgent(req);
    const canonicalCaseId = await canonicalCaseIdFromLead(context, (await params).caseId);
    const form = await req.formData();
    const file = form.get("file");
    const requirementId = String(form.get("requirementId") ?? "").trim();
    const documentTypeCode = String(form.get("documentTypeCode") ?? "").trim();
    if (!(file instanceof File) || !requirementId || !documentTypeCode) {
      return jsonError(400, "Нужны файл, requirementId и documentTypeCode");
    }
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");
    const result = await uploadCaseDocument(context, {
      caseId: canonicalCaseId,
      requirementId,
      documentTypeCode,
      file,
      source: "agent-case-workspace",
    }, { idempotencyKey, correlationId, reason: "Загрузка для сценарного требования" });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, "m3/documents/upload");
  }
}
