import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CASE_TRANSITION_EVENTS, CaseDomainError } from "@/lib/caseDomain";
import { transitionCase } from "@/lib/caseService";
import { getSessionFromRequest } from "@/lib/auth";
import { handleApiError, parseId } from "@/lib/apiAuth";

export const runtime = "nodejs";

const Body = z.object({
  eventType: z.enum(CASE_TRANSITION_EVENTS),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });

  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  const correlationId = req.headers.get("x-correlation-id")?.trim();
  if (!idempotencyKey || !correlationId) {
    return NextResponse.json({ error: "Нужны Idempotency-Key и X-Correlation-Id" }, { status: 400 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неизвестная команда кейса" }, { status: 400 });

  try {
    const result = await transitionCase({
      leadId: parseId((await params).caseId, "caseId"),
      eventType: parsed.data.eventType,
      payload: parsed.data.payload,
      context: {
        agentId: session.agentId,
        actorId: session.agentId,
        idempotencyKey,
        correlationId,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CaseDomainError) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 422;
      return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status });
    }
    return handleApiError(error, "cases/transition");
  }
}
