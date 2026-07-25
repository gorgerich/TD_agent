import { NextRequest, NextResponse } from "next/server";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    assertCapability(session, "work:read");
    const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < 2) return NextResponse.json({ results: [] });
    const agentScope = session.role === "AGENT" ? { ownerId: session.agentId } : {};
    const taskScope = session.role === "AGENT" ? { assigneeMembershipId: session.membershipId } : {};
    const meetingScope = session.role === "AGENT" ? { ownerMembershipId: session.membershipId } : {};
    const numeric = Number(query);
    const [cases, tasks, meetings] = await Promise.all([
      prisma.case.findMany({
        where: {
          tenantId: session.organizationId,
          ...agentScope,
          OR: [
            { lead: { name: { contains: query, mode: "insensitive" } } },
            { lead: { phone: { contains: query.replace(/\D/g, "") || "__no_phone__" } } },
            ...(Number.isInteger(numeric) && numeric > 0 ? [{ leadId: numeric }] : []),
          ],
        },
        select: { id: true, leadId: true, stage: true, lead: { select: { name: true } } },
        take: 8,
      }),
      prisma.task.findMany({
        where: {
          organizationId: session.organizationId,
          ...taskScope,
          title: { contains: query, mode: "insensitive" },
        },
        select: { id: true, leadId: true, title: true, status: true, lead: { select: { name: true } } },
        take: 8,
      }),
      prisma.meeting.findMany({
        where: {
          organizationId: session.organizationId,
          ...meetingScope,
          OR: [
            { lead: { name: { contains: query, mode: "insensitive" } } },
            ...(Number.isInteger(numeric) && numeric > 0 ? [{ id: numeric }] : []),
          ],
        },
        select: { id: true, leadId: true, operationalStatus: true, scheduledAt: true, lead: { select: { name: true } } },
        take: 8,
      }),
    ]);
    return NextResponse.json({
      results: [
        ...cases.map((item) => ({ id: `case:${item.id}`, kind: "CASE", label: item.lead.name, meta: `Кейс #${item.leadId} · ${item.stage}`, href: `/agent/cases/${item.leadId}` })),
        ...tasks.map((item) => ({ id: `task:${item.id}`, kind: "TASK", label: item.title, meta: `${item.lead.name} · ${item.status}`, href: `/agent/cases/${item.leadId}?tab=work&task=${item.id}` })),
        ...meetings.map((item) => ({ id: `meeting:${item.id}`, kind: "MEETING", label: item.lead.name, meta: `Встреча · ${item.operationalStatus}`, href: `/agent/meetings/${item.id}?from=search` })),
      ],
    });
  } catch (error) {
    return handleApiError(error, "operations/search");
  }
}
