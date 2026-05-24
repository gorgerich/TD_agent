import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

    // Commission = order.totalAmount * agentTier.commissionPct / 100
    const pct = Number(order.agent.tier.commissionPct);
    const amount = Math.round(order.totalAmount * pct / 100);

    const commission = await prisma.commission.create({
      data: {
        agentId: order.agentId,
        orderId: order.id,
        amount,
        status: "ACCRUED",
      },
    });

    return NextResponse.json({ ok: true, commissionId: commission.id, amount, pct });
  } catch {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}
