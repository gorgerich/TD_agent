import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptField } from "@/lib/crypto";
import { assertLeadOwned, handleApiError, parseId } from "@/lib/apiAuth";
import { ensureCanonicalCaseForLead, scenarioFromCeremonyType, transitionCase } from "@/lib/caseService";
import { CaseDomainError } from "@/lib/caseDomain";

export const runtime = "nodejs";

const Schema = z.object({
  ceremonyType: z.string().max(40).optional().nullable(),
  budget: z.string().max(60).optional().nullable(),
  religion: z.string().max(60).optional().nullable(),
  needs: z.string().max(2000).optional().nullable(),
  // P0-домен: усопший и церемония
  deceasedName: z.string().max(200).optional().nullable(),
  deceasedDate: z.string().max(30).optional().nullable(),  // ISO date
  morgue: z.string().max(200).optional().nullable(),
  ceremonyAt: z.string().max(30).optional().nullable(),    // ISO datetime
  ceremonyPlace: z.string().max(200).optional().nullable(),
});

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });

  try {
    const leadId = parseId((await params).caseId, "caseId");
    await assertLeadOwned(leadId, session.agentId);

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Проверьте поля" }, { status: 400 });

    const { ceremonyType, budget, religion, needs, deceasedName, deceasedDate, morgue, ceremonyAt, ceremonyPlace } = parsed.data;
    const updatedLead = await prisma.clientLead.update({
      where: { id: leadId },
      data: {
        ceremonyType: ceremonyType ?? null,
        budget: budget ?? null,
        religion: religion ?? null,
        needs: needs ? encryptField(needs) : null, // ПДн — шифруем
        deceasedName: deceasedName ? encryptField(deceasedName) : null, // ПДн усопшего — шифруем
        deceasedDate: parseDate(deceasedDate),
        morgue: morgue ?? null,
        ceremonyAt: parseDate(ceremonyAt),
        ceremonyPlace: ceremonyPlace ?? null,
      },
    });
    await ensureCanonicalCaseForLead({
      leadId,
      agentId: session.agentId,
      actorId: session.agentId,
      correlationId: req.headers.get("x-correlation-id")?.trim() || `intake:${leadId}`,
    });

    const baseKey = req.headers.get("idempotency-key")?.trim() || `intake:${leadId}:${Date.now()}`;
    const correlationId = req.headers.get("x-correlation-id")?.trim() || `intake:${leadId}`;
    let canonical = await prisma.case.findUnique({ where: { leadId } });
    if (canonical?.stage === "INTAKE" && updatedLead.deceasedName) {
      await transitionCase({
        leadId,
        eventType: "intake.completed.v1",
        context: { agentId: session.agentId, actorId: session.agentId, idempotencyKey: `${baseKey}:intake`, correlationId },
      });
      canonical = await prisma.case.findUnique({ where: { leadId } });
    }

    const scenarioId = scenarioFromCeremonyType(updatedLead.ceremonyType);
    if (canonical?.stage === "PLANNING" && scenarioId !== "UNSELECTED") {
      await transitionCase({
        leadId,
        eventType: "scenario.selected.v1",
        payload: { scenarioId },
        context: { agentId: session.agentId, actorId: session.agentId, idempotencyKey: `${baseKey}:scenario`, correlationId },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CaseDomainError) {
      return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status: 422 });
    }
    return handleApiError(err, "cases/intake");
  }
}
