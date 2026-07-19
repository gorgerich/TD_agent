import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptField, decryptField } from "@/lib/crypto";
import { handleApiError } from "@/lib/apiAuth";
import { ensureCanonicalCaseForLead } from "@/lib/caseService";
import { assertCapability } from "@/lib/operationalAuth";

export const runtime = "nodejs";

const CreateLeadSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(7).max(30),
  source: z.string().min(1).max(50),
  context: z.string().max(2000).optional(),
  ceremonyType: z.enum(["кремация", "погребение"]).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    assertCapability(session, "work:read");
    const leads = await prisma.clientLead.findMany({
      where: {
        case: {
          tenantId: session.organizationId,
          ...(session.role === "AGENT" ? { ownerId: session.agentId } : {}),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { meetings: { select: { status: true } } },
    });
    return NextResponse.json(leads.map((l) => ({ ...l, context: decryptField(l.context) })));
  } catch (error) {
    return handleApiError(error, "leads/list");
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateLeadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  try {
    assertCapability(session, "work:mutate-own");
    // Профиль агента должен существовать в текущей БД. После смены БД
    // (Neon → Railway) старая сессия может нести agentId, которого здесь нет —
    // тогда просим перелогиниться, а не отдаём непонятную 503 (FK-ошибка).
    if (session.agentId) {
      const agent = await prisma.agent.findUnique({ where: { id: session.agentId }, select: { id: true } });
      if (!agent) {
        return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });
      }
    }

    const requestedKey = req.headers.get("idempotency-key")?.trim();
    if (requestedKey) {
      const replay = await prisma.caseEvent.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: session.organizationId, idempotencyKey: requestedKey } },
        select: { eventType: true, case: { include: { lead: true } } },
      });
      if (replay) {
        if (replay.eventType !== "case.created.v1") {
          return NextResponse.json({ error: "Idempotency key уже использован другой командой" }, { status: 409 });
        }
        return NextResponse.json({
          ...replay.case.lead,
          context: decryptField(replay.case.lead.context),
          caseId: replay.case.id,
          caseRef: replay.case.publicRef,
          replayed: true,
        });
      }
    }

    const { lead, canonicalCase } = await prisma.$transaction(async (tx) => {
      const createdLead = await tx.clientLead.create({
        data: {
          agentId: session.agentId,
          name: parsed.data.name,
          phone: parsed.data.phone,
          source: parsed.data.source,
          context: encryptField(parsed.data.context),
          ceremonyType: parsed.data.ceremonyType,
        },
      });
      const createdCase = await ensureCanonicalCaseForLead({
        leadId: createdLead.id,
        organizationId: session.organizationId,
        agentId: session.agentId,
        actorId: session.agentId,
        idempotencyKey: requestedKey || `lead-create:${createdLead.id}`,
        correlationId: req.headers.get("x-correlation-id")?.trim() || `lead:${createdLead.id}`,
      }, tx);
      return { lead: createdLead, canonicalCase: createdCase };
    });
    return NextResponse.json({
      ...lead,
      context: decryptField(lead.context),
      caseId: canonicalCase.caseId,
      caseRef: canonicalCase.publicRef,
    }, { status: 201 });
  } catch (err) {
    return handleApiError(err, "leads/create");
  }
}
