import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAgent, assertLeadAccess, parseId, jsonError, handleApiError } from "@/lib/apiAuth";
import { createTask } from "@/lib/taskService";

export const runtime = "nodejs";

const CreateBody = z.object({
  title: z.string().min(1).max(500),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
  type: z.enum(["MANUAL", "PREPARATION", "FOLLOW_UP", "MEETING_ESCALATION", "QUOTE_SEND"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(),
  expectedOutcome: z.string().max(500).optional().nullable(),
  waitingReason: z.string().max(500).optional().nullable(),
  assigneeMembershipId: z.string().min(1).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const session = await requireAgent(req);
    const leadId = parseId((await params).caseId, "caseId");
    await assertLeadAccess(leadId, session);

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");

    const task = await createTask(session, {
      leadId,
      title: parsed.data.title,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      type: parsed.data.type,
      priority: parsed.data.priority,
      expectedOutcome: parsed.data.expectedOutcome,
      waitingReason: parsed.data.waitingReason,
      assigneeMembershipId: parsed.data.assigneeMembershipId,
    }, { idempotencyKey, correlationId });

    return NextResponse.json({ ok: true, task });
  } catch (err) {
    return handleApiError(err, "tasks/create");
  }
}
