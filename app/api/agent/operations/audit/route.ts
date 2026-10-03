import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { assertCapability, hasTeamOperationalScope } from "@/lib/operationalAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    assertCapability(session, hasTeamOperationalScope(session.role) ? "audit:read" : "work:read");
    const url = new URL(req.url);
    const entityType = url.searchParams.get("entityType")?.trim();
    const entityId = url.searchParams.get("entityId")?.trim();
    const ownScope: Prisma.OperationalAuditEventWhereInput = !hasTeamOperationalScope(session.role)
      ? await agentAuditScope(session.organizationId, session.membershipId, session.agentId)
      : {};
    const events = await prisma.operationalAuditEvent.findMany({
      where: {
        organizationId: session.organizationId,
        ...ownScope,
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

async function agentAuditScope(organizationId: string, membershipId: string, agentId: number) {
  const [tasks, meetings, cases] = await Promise.all([
    prisma.task.findMany({
      where: { organizationId, assigneeMembershipId: membershipId },
      select: { id: true },
    }),
    prisma.meeting.findMany({
      where: { organizationId, ownerMembershipId: membershipId },
      select: { id: true },
    }),
    prisma.case.findMany({
      where: { tenantId: organizationId, ownerId: agentId },
      select: { id: true },
    }),
  ]);
  return {
    OR: [
      { actorMembershipId: membershipId },
      { entityType: "task", entityId: { in: tasks.map((item) => String(item.id)) } },
      { entityType: "meeting", entityId: { in: meetings.map((item) => String(item.id)) } },
      { entityType: "case", entityId: { in: cases.map((item) => item.id) } },
    ],
  } satisfies Prisma.OperationalAuditEventWhereInput;
}
