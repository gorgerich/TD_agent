import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAgent, parseId, jsonError, handleApiError } from "@/lib/apiAuth";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string; noteId: string }> },
) {
  try {
    const session = await requireAgent(req);
    const { noteId: noteIdStr } = await params;
    const noteId = parseId(noteIdStr, "noteId");

    const existing = await prisma.caseNote.findFirst({
      where: { id: noteId, agentId: session.agentId },
    });
    if (!existing) return jsonError(404, "Заметка не найдена");

    await prisma.caseNote.delete({ where: { id: noteId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "notes/delete");
  }
}
