import { NextResponse } from "next/server";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { listDocumentReviewQueue } from "@/lib/documentService";

export async function GET(req: Request) {
  try {
    const context = await requireAgent(req, { allowedRoles: ["DOCUMENT_REVIEWER"] });
    return NextResponse.json({ queue: await listDocumentReviewQueue(context) });
  } catch (error) {
    return handleApiError(error, "m3/document-review/queue");
  }
}
