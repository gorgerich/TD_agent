import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import { assertPlatformCapability, requirePlatformAdmin } from "@/lib/platformAuth";
import { assignFirstOrganizationAdmin } from "@/lib/platformFirstOrganizationAdmin";
import { ADMIN_CONFIRMATION } from "@/lib/organizationAdmin";

export const runtime = "nodejs";
const Body = z.object({
  membershipId: z.string().trim().min(1).max(200),
  confirmation: z.literal(ADMIN_CONFIRMATION),
  reason: z.string().trim().min(3).max(240),
}).strict();

export async function POST(req: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  try {
    const context = await requirePlatformAdmin(req);
    assertPlatformCapability(context, "platform:organizations-manage");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Некорректные данные назначения ADMIN");
    const { organizationId } = await params;
    const result = await assignFirstOrganizationAdmin(context, {
      ...parsed.data,
      organizationId,
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
      correlationId: req.headers.get("x-correlation-id") ?? "",
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, "platform/organizations/first-admin");
  }
}
