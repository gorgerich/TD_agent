import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    assertCapability(session, "audit:read");
    const url = new URL(req.url);
    const entityType = url.searchParams.get("entityType")?.trim();
    const entityId = url.searchParams.get("entityId")?.trim();
    const events = await prisma.operationalAuditEvent.findMany({
      where: {
        organizationId: session.organizationId,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        action: true,
        reason: true,
        correlationId: true,
        causationId: true,
        actorMembershipId: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ events });
  } catch (error) {
    return handleApiError(error, "operations/audit");
  }
}
