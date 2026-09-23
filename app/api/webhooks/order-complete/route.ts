import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const Body = z.object({
  orderId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET;
  const provided = req.headers.get("x-webhook-secret") ?? "";
  const actual = Buffer.from(provided);
  const expected = Buffer.from(secret ?? "");
  if (!secret || secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { orderId } = parsed.data;

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, agentId: true },
    });

    if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (order.status !== "COMPLETED") {
      return NextResponse.json({ error: "Order is not COMPLETED", status: order.status }, { status: 422 });
    }
    if (!order.agentId) {
      return NextResponse.json({ ok: true, skipped: "no agent on order" });
    }

    // Order has gross total only. Existing commissions also lack a verified margin basis.
    return NextResponse.json({ error: "Commission basis is unconfirmed" }, { status: 409 });
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
