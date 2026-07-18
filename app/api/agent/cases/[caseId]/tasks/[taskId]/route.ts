import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent, parseId, jsonError, handleApiError } from "@/lib/apiAuth";
import { assignTask, cancelTask, completeTask } from "@/lib/taskService";

export const runtime = "nodejs";

const PatchBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), outcome: z.string().min(1).max(1000), version: z.number().int().positive() }),
  z.object({ action: z.literal("cancel"), reason: z.string().min(1).max(1000), version: z.number().int().positive() }),
  z.object({ action: z.literal("assign"), assigneeMembershipId: z.string().min(1).nullable(), reason: z.string().min(1).max(1000), version: z.number().int().positive() }),
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

    const task = parsed.data.action === "complete"
      ? await completeTask(session, taskId, parsed.data, meta)
      : parsed.data.action === "cancel"
        ? await cancelTask(session, taskId, parsed.data, meta)
        : await assignTask(session, taskId, parsed.data, meta);

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
