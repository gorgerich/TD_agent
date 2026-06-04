import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptField } from "@/lib/crypto";

export async function GET(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadId } = await params;

  try {
    const lead = await prisma.clientLead.findFirst({
      where: { id: Number(leadId), agentId: session.agentId },
      include: { meetings: { orderBy: { scheduledAt: "desc" } } },
    });
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...lead, context: decryptField(lead.context) });
  } catch {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}
