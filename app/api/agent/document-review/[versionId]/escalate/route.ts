import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { escalateDocumentReview } from "@/lib/documentService";
import { commandMetaFromHeaders } from "@/lib/m3Api";

const Body = z.object({ reason: z.string().trim().min(3).max(500) });

export async function POST(req: Request, { params }: { params: Promise<{ versionId: string }> }) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["DOCUMENT_REVIEWER"] });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректная эскалация");
    return NextResponse.json(await escalateDocumentReview(
      context,
      (await params).versionId,
      parsed.data.reason,
      commandMetaFromHeaders(req, parsed.data.reason),
    ));
  } catch (error) {
    return handleApiError(error, "m3/documents/review-escalation");
  }
}
