import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PaginationQuery, queryObject } from "@/lib/adminValidation";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import { assertPlatformCapability, requirePlatformAdmin } from "@/lib/platformAuth";

const Query = PaginationQuery.extend({
  action: z.string().trim().max(80).default(""),
  targetType: z.string().trim().max(80).default(""),
});

export async function GET(req: Request) {
  try {
    const context = await requirePlatformAdmin(req);
    assertPlatformCapability(context, "platform:audit-read");
    const parsed = Query.safeParse(queryObject(req));
    if (!parsed.success) return jsonError(400, "Некорректные параметры аудита");
    const { page, pageSize, q, action, targetType } = parsed.data;
    const where = {
      ...(action ? { action } : {}),
      ...(targetType ? { targetType } : {}),
      ...(q ? { OR: [{ action: { contains: q, mode: "insensitive" as const } }, { targetId: { contains: q, mode: "insensitive" as const } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.platformAuditEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
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
      prisma.platformAuditEvent.count({ where }),
    ]);
    return NextResponse.json({ items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    return handleApiError(error, "platform/audit");
  }
}
