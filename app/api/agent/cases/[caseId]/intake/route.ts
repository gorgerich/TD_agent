import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { encryptField } from "@/lib/crypto";
import { assertLeadOwned, handleApiError, parseId } from "@/lib/apiAuth";
import { saveCaseIntake } from "@/lib/caseService";
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

  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  const correlationId = req.headers.get("x-correlation-id")?.trim();
  if (!idempotencyKey || !correlationId) {
    return NextResponse.json({ error: "Нужны Idempotency-Key и X-Correlation-Id" }, { status: 400 });
  }

  try {
    const leadId = parseId((await params).caseId, "caseId");
    await assertLeadOwned(leadId, session);

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Проверьте поля" }, { status: 400 });

    const { ceremonyType, budget, religion, needs, deceasedName, deceasedDate, morgue, ceremonyAt, ceremonyPlace } = parsed.data;
    const result = await saveCaseIntake({
      leadId,
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
      context: {
        organizationId: session.organizationId,
        membershipId: session.membershipId,
        agentId: session.agentId,
        actorId: session.agentId,
        idempotencyKey,
        correlationId,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof CaseDomainError) {
      const status = err.code === "NOT_FOUND" ? 404 : err.code === "IDEMPOTENCY_CONFLICT" ? 409 : 422;
      return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
    }
    return handleApiError(err, "cases/intake");
  }
}
