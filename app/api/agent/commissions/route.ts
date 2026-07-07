import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [commissions, payouts] = await Promise.all([
      prisma.commission.findMany({
        where: { agentId: session.agentId },
        orderBy: { id: "desc" },
        take: 300,
        include: { order: { select: { id: true, createdAt: true } } },
      }),
      prisma.payout.findMany({
        where: { agentId: session.agentId },
        orderBy: { id: "desc" },
        take: 200,
      }),
    ]);

    const totals = {
      accrued: commissions.filter((c) => c.status === "ACCRUED").reduce((sum, c) => sum + c.amount, 0),
      approved: commissions.filter((c) => c.status === "APPROVED").reduce((sum, c) => sum + c.amount, 0),
      paid: payouts.reduce((sum, p) => sum + p.amount, 0),
    };

    return NextResponse.json({ commissions, payouts, totals });
  } catch {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}
