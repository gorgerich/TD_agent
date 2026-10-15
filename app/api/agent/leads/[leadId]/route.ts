import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptFieldStrict } from "@/lib/crypto";
import { handleApiError } from "@/lib/apiAuth";
import { requireAppEncryptionKey } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    requireAppEncryptionKey();
    const session = await getSessionFromRequest(req);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { leadId } = await params;

    const lead = await prisma.clientLead.findFirst({
      where: { id: Number(leadId), agentId: session.agentId },
      include: { meetings: { orderBy: { scheduledAt: "desc" } } },
    });
    if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ...lead, context: decryptFieldStrict(lead.context) });
  } catch (error) {
    return handleApiError(error, "leads/read");
  }
}
