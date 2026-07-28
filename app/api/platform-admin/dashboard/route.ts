import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError } from "@/lib/apiAuth";
import { assertPlatformCapability, requirePlatformAdmin } from "@/lib/platformAuth";

export async function GET(req: Request) {
  try {
    const context = await requirePlatformAdmin(req);
    assertPlatformCapability(context, "platform:dashboard-read");
    const [organizations, activeOrganizations, suspendedOrganizations, activeMemberships, roleGroups, recentAudit] =
      await Promise.all([
        prisma.organization.count(),
        prisma.organization.count({ where: { status: "ACTIVE" } }),
        prisma.organization.count({ where: { status: "SUSPENDED" } }),
        prisma.membership.count({ where: { status: "ACTIVE", organization: { status: "ACTIVE" } } }),
        prisma.membership.groupBy({ by: ["role"], where: { status: "ACTIVE" }, _count: { _all: true } }),
        prisma.platformAuditEvent.findMany({
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            action: true,
            targetType: true,
            targetId: true,
            metadata: true,
            createdAt: true,
            actor: { select: { id: true, name: true, email: true } },
          },
        }),
      ]);
    return NextResponse.json({
      organizations: { total: organizations, active: activeOrganizations, suspended: suspendedOrganizations },
      activeMemberships,
      roles: Object.fromEntries(roleGroups.map((group) => [group.role, group._count._all])),
      recentAudit,
    });
  } catch (error) {
    return handleApiError(error, "platform/dashboard");
  }
}
