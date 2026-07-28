import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import { appendPlatformAudit } from "@/lib/platformAudit";
import { assertPlatformCapability, requirePlatformAdmin } from "@/lib/platformAuth";

const PatchBody = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  confirmation: z.string().trim().max(120),
});

export async function GET(req: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  try {
    const context = await requirePlatformAdmin(req);
    assertPlatformCapability(context, "platform:organizations-read");
    const { organizationId } = await params;
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
        timezone: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, name: true, email: true, platformRole: true } },
            agent: { select: { id: true, status: true } },
          },
        },
        auditEvents: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actorType: true },
        },
      },
    });
    if (!organization) return jsonError(404, "Организация не найдена");
    return NextResponse.json(organization);
  } catch (error) {
    return handleApiError(error, "platform/organizations/detail");
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  try {
    const context = await requirePlatformAdmin(req);
    assertPlatformCapability(context, "platform:organizations-manage");
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Некорректный статус организации");
    const { organizationId } = await params;
    const expected = parsed.data.status === "SUSPENDED" ? "ПРИОСТАНОВИТЬ ОРГАНИЗАЦИЮ" : "ВОЗОБНОВИТЬ ОРГАНИЗАЦИЮ";
    if (parsed.data.confirmation !== expected) return jsonError(422, `Введите «${expected}»`);

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, status: true } });
      if (!current) return null;
      if (current.status === parsed.data.status) return current;
      const organization = await tx.organization.update({
        where: { id: organizationId },
        data: { status: parsed.data.status },
        select: { id: true, status: true },
      });
      await appendPlatformAudit(tx, {
        actorUserId: context.userId,
        action: parsed.data.status === "SUSPENDED" ? "ORGANIZATION_SUSPENDED" : "ORGANIZATION_REACTIVATED",
        targetType: "organization",
        targetId: organizationId,
        metadata: { before: current.status, after: organization.status },
      });
      return organization;
    });
    if (!updated) return jsonError(404, "Организация не найдена");
    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError(error, "platform/organizations/status");
  }
}
