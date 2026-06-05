import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAgent, parseId, jsonError, handleApiError } from "@/lib/apiAuth";

export const runtime = "nodejs";

const PatchBody = z.object({
  completed: z.boolean().optional(),
  title: z.string().min(1).max(500).optional(),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string; taskId: string }> },
) {
  try {
    const session = await requireAgent(req);
    const { taskId: taskIdStr } = await params;
    const taskId = parseId(taskIdStr, "taskId");

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");

    // Verify ownership via agentId on the task itself (no separate leadOwned needed).
    const existing = await prisma.task.findFirst({
      where: { id: taskId, agentId: session.agentId },
    });
    if (!existing) return jsonError(404, "Задача не найдена");

    const data: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) data.title = parsed.data.title;
    if (parsed.data.dueAt !== undefined) data.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
    if (parsed.data.completed !== undefined) {
      data.completedAt = parsed.data.completed ? (existing.completedAt ?? new Date()) : null;
    }

    const task = await prisma.task.update({ where: { id: taskId }, data });
    return NextResponse.json({ ok: true, task });
  } catch (err) {
    return handleApiError(err, "tasks/patch");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string; taskId: string }> },
) {
  try {
    const session = await requireAgent(req);
    const { taskId: taskIdStr } = await params;
    const taskId = parseId(taskIdStr, "taskId");

    const existing = await prisma.task.findFirst({
      where: { id: taskId, agentId: session.agentId },
    });
    if (!existing) return jsonError(404, "Задача не найдена");

    await prisma.task.delete({ where: { id: taskId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "tasks/delete");
  }
}
