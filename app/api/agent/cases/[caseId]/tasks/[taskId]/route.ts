import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent, parseId, jsonError, handleApiError } from "@/lib/apiAuth";
import { assignTask, cancelTask, completeTask, rescheduleTask, resumeTask, waitTask } from "@/lib/taskService";

export const runtime = "nodejs";

const PatchBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), outcome: z.string().min(1).max(1000), version: z.number().int().positive() }),
  z.object({ action: z.literal("cancel"), reason: z.string().min(1).max(1000), version: z.number().int().positive() }),
  z.object({ action: z.literal("assign"), assigneeMembershipId: z.string().min(1).nullable(), reason: z.string().min(1).max(1000), version: z.number().int().positive() }),
  z.object({ action: z.literal("reschedule"), dueAt: z.string().datetime({ offset: true }).nullable(), reason: z.string().min(1).max(1000), version: z.number().int().positive() }),
  z.object({ action: z.literal("wait"), waitingReason: z.string().min(1).max(1000), version: z.number().int().positive() }),
  z.object({ action: z.literal("resume"), reason: z.string().min(1).max(1000), version: z.number().int().positive() }),
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string; taskId: string }> },
) {
  try {
    const session = await requireAgent(req);
    const taskId = parseId((await params).taskId, "taskId");
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");
    const meta = { idempotencyKey, correlationId };

    let task;
    if (parsed.data.action === "complete") task = await completeTask(session, taskId, parsed.data, meta);
    else if (parsed.data.action === "cancel") task = await cancelTask(session, taskId, parsed.data, meta);
    else if (parsed.data.action === "assign") task = await assignTask(session, taskId, parsed.data, meta);
    else if (parsed.data.action === "reschedule") task = await rescheduleTask(session, taskId, { ...parsed.data, dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null }, meta);
    else if (parsed.data.action === "wait") task = await waitTask(session, taskId, parsed.data, meta);
    else task = await resumeTask(session, taskId, parsed.data, meta);

    return NextResponse.json({ ok: true, task });
  } catch (err) {
    return handleApiError(err, "tasks/command");
  }
}

export async function DELETE() {
  return NextResponse.json(
    { error: "Задачи не удаляются. Используйте отмену с причиной." },
    { status: 405, headers: { Allow: "PATCH" } },
  );
}
