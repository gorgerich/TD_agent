import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PaginationQuery, queryObject } from "@/lib/adminValidation";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import { assertPlatformCapability, requirePlatformAdmin } from "@/lib/platformAuth";

export async function GET(req: Request) {
  try {
    const context = await requirePlatformAdmin(req);
    assertPlatformCapability(context, "platform:users-read");
    const parsed = PaginationQuery.safeParse(queryObject(req));
    if (!parsed.success) return jsonError(400, "Некорректные параметры списка");
    const { page, pageSize, q } = parsed.data;
    const where = q
      ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] }
      : {};
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          platformRole: true,
          agent: { select: { id: true, status: true } },
          memberships: {
            select: {
              id: true,
              role: true,
              status: true,
              organization: { select: { id: true, name: true, status: true } },
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);
    return NextResponse.json({ items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    return handleApiError(error, "platform/users");
  }
}
