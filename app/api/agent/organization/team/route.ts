import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, requireAgent } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";

export async function GET(req: Request) {
  try {
    const context = await requireAgent(req);
    assertCapability(context, "organization:read");
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: context.organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        status: true,
        memberships: {
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { name: true, email: true } },
          },
        },
        invitations: {
          where: { acceptedAt: null },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            emailNormalized: true,
            role: true,
            expiresAt: true,
            revokedAt: true,
            createdAt: true,
          },
        },
      },
    });
    return NextResponse.json({ ...organization, generatedAt: new Date().toISOString() });
  } catch (error) {
    return handleApiError(error, "organization/team");
  }
}
