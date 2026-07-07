import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAgent, assertLeadAccess, parseId, jsonError, handleApiError } from "@/lib/apiAuth";

export const runtime = "nodejs";

const CreateBody = z.object({
  title: z.string().min(1).max(500),
  dueAt: z.string().datetime({ offset: true }).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const session = await requireAgent(req);
    const { caseId: caseIdStr } = await params;
    const leadId = parseId(caseIdStr, "caseId");

    await assertLeadAccess(leadId, session);

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");

    const task = await prisma.task.create({
      data: {
        leadId,
        agentId: session.agentId,
        title: parsed.data.title,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      },
    });

    return NextResponse.json({ ok: true, task });
  } catch (err) {
    return handleApiError(err, "tasks/create");
  }
}
