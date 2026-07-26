import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PaginationQuery, queryObject } from "@/lib/adminValidation";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import { assertPlatformCapability, requirePlatformAdmin } from "@/lib/platformAuth";

const Query = PaginationQuery.extend({
  status: z.enum(["ALL", "ACTIVE", "SUSPENDED"]).default("ALL"),
});

export async function GET(req: Request) {
  try {
    const context = await requirePlatformAdmin(req);
    assertPlatformCapability(context, "platform:organizations-read");
    const parsed = Query.safeParse(queryObject(req));
    if (!parsed.success) return jsonError(400, "Некорректные параметры списка");
    const { page, pageSize, q, status } = parsed.data;
    const where: Prisma.OrganizationWhereInput = {
      ...(status === "ALL" ? {} : { status }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { slug: { contains: q, mode: "insensitive" as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          status: true,
          createdAt: true,
          _count: { select: { memberships: true } },
          memberships: {
            where: { status: "ACTIVE" },
            select: { role: true },
          },
        },
      }),
      prisma.organization.count({ where }),
    ]);
    return NextResponse.json({
      items: items.map(({ memberships, ...organization }) => ({
        ...organization,
        roleCounts: memberships.reduce<Record<string, number>>((counts, membership) => {
          counts[membership.role] = (counts[membership.role] ?? 0) + 1;
          return counts;
        }, {}),
      })),
      page,
      pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    return handleApiError(error, "platform/organizations");
  }
}
