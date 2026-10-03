import { NextRequest } from "next/server";
import { handleApiError, jsonError, parseId, requireAgent } from "@/lib/apiAuth";
import { readAuthorizedDocument } from "@/lib/documentService";
import { prisma } from "@/lib/prisma";
import { hasTeamOperationalScope } from "@/lib/operationalAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string; docId: string }> },
) {
  try {
    const context = await requireAgent(req, {
      allowedRoles: ["AGENT", "MANAGER", "ADMIN", "DOCUMENT_REVIEWER"],
    });
    const { caseId, docId } = await params;
    const leadId = parseId(caseId, "caseId");
    const canonical = await prisma.case.findFirst({
      where: {
        leadId,
        tenantId: context.organizationId,
        ...(!hasTeamOperationalScope(context.role) && context.role !== "DOCUMENT_REVIEWER"
          ? { ownerId: context.agentId }
          : {}),
      },
      select: { id: true },
    });
    if (!canonical) return jsonError(404, "Документ не найден");
    const action = req.nextUrl.searchParams.get("download") === "1" ? "DOWNLOAD" : "VIEW";
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!correlationId) return jsonError(400, "Нужен X-Correlation-Id");
    const document = await readAuthorizedDocument(context, docId, canonical.id, action, correlationId);
    return new Response(document.file.stream, {
      status: 200,
      headers: {
        "Content-Type": document.mimeType,
        "Content-Length": String(document.file.size),
        "Content-Disposition": `${action === "DOWNLOAD" ? "attachment" : "inline"}; filename="${document.filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch (error) {
    return handleApiError(error, "m3/documents/access");
  }
}
