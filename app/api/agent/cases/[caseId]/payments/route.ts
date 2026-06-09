import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertLeadOwned, handleApiError, parseId } from "@/lib/apiAuth";

export const runtime = "nodejs";

const Schema = z.object({
  amountRub: z.number().int().min(1).max(100_000_000),
  kind: z.enum(["аванс", "остаток", "полная"]),
  method: z.enum(["наличные", "карта", "счёт"]),
  note: z.string().max(500).optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });

  try {
    const leadId = parseId((await params).caseId, "caseId");
    await assertLeadOwned(leadId, session.agentId);

    const parsed = Schema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Проверьте поля" }, { status: 400 });

    const payment = await prisma.casePayment.create({
      data: {
        leadId,
        agentId: session.agentId,
        amountKopecks: parsed.data.amountRub * 100,
        kind: parsed.data.kind,
        method: parsed.data.method,
        note: parsed.data.note ?? null,
      },
      select: { id: true, amountKopecks: true, kind: true, method: true, note: true, paidAt: true },
    });
    return NextResponse.json({ payment });
  } catch (err) {
    return handleApiError(err, "cases/payments");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });

  try {
    const leadId = parseId((await params).caseId, "caseId");
    await assertLeadOwned(leadId, session.agentId);

    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Неверный id" }, { status: 400 });

    const found = await prisma.casePayment.findFirst({ where: { id, leadId, agentId: session.agentId }, select: { id: true } });
    if (!found) return NextResponse.json({ error: "Оплата не найдена" }, { status: 404 });

    await prisma.casePayment.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err, "cases/payments/delete");
  }
}
