import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const Body = z.object({
  orderId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  // Simple shared-secret guard — set WEBHOOK_SECRET in env for prod
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const provided = req.headers.get("x-webhook-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { orderId } = parsed.data;

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        agent: { include: { tier: true } },
        commission: true,
      },
    });

    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status !== "COMPLETED") {
      return NextResponse.json({ error: "Order is not COMPLETED", status: order.status }, { status: 422 });
    }
    if (!order.agentId || !order.agent) {
      return NextResponse.json({ ok: true, skipped: "no agent on order" });
    }
    if (order.commission) {
      return NextResponse.json({ ok: true, skipped: "commission already exists", commissionId: order.commission.id });
    }

    // ВНИМАНИЕ: схема (AgentTier.commissionPct) задаёт «% от МАРЖИ», но маржа
    // на Order не хранится — используется totalAmount (чек). Это завышает комиссию.
    // TODO(owner-decision): хранить маржу на Order (из QuoteVersion.economics) и
    // считать от неё; до решения собственника база остаётся totalAmount.
    const pct = Number(order.agent.tier.commissionPct);
    const amount = Math.round((order.totalAmount * pct) / 100);

    // Идемпотентность: Commission.orderId @unique. Параллельный/повторный вебхук
    // ловим по P2002 и возвращаем уже существующую комиссию (а не 500).
    try {
      const commission = await prisma.commission.create({
        data: { agentId: order.agentId, orderId: order.id, amount, status: "ACCRUED" },
      });
      return NextResponse.json({ ok: true, commissionId: commission.id, amount, pct });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const existing = await prisma.commission.findUnique({ where: { orderId: order.id } });
        return NextResponse.json({ ok: true, skipped: "commission already exists", commissionId: existing?.id });
      }
      throw e;
    }
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientInitializationError ||
      (err instanceof Error && /Can't reach database|ECONNREFUSED|P1001/.test(err.message))
    ) {
      return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
    }
    console.error("[webhook/order-complete] failed:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
