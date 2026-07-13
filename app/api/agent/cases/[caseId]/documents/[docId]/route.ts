import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertLeadOwned, handleApiError, parseId } from "@/lib/apiAuth";
import { getDocumentStorage } from "@/lib/documentStorage";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string; docId: string }> },
) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });

  try {
    const { caseId, docId } = await params;
    const leadId = parseId(caseId, "caseId");
    const id = parseId(docId, "docId");
    await assertLeadOwned(leadId, session.agentId);

    const doc = await prisma.document.findFirst({
      where: { id, leadId, agentId: session.agentId },
      select: { pathname: true },
    });
    if (!doc) return NextResponse.json({ error: "Документ не найден" }, { status: 404 });

    const storage = getDocumentStorage();
    if (storage.isConfigured()) {
      try {
        await storage.delete(doc.pathname);
      } catch {
        // файл мог быть уже удалён — продолжаем чистить запись
      }
    }
    await prisma.document.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "documents/delete");
  }
}
