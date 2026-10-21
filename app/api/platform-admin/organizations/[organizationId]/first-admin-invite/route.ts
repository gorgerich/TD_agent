import { NextResponse } from "next/server";
import { handleApiError, jsonError } from "@/lib/apiAuth";
import { assertPlatformCapability, requirePlatformAdmin } from "@/lib/platformAuth";
import { FirstAdminInvitationInput, reissueFirstAdminInvitation } from "@/lib/platformOrganizationOnboarding";
import { buildInvitationUrl } from "@/lib/invitationLink";
import { readBoundedRequestText } from "@/lib/boundedRequestBody";
import { enforcePersistentRateLimit } from "@/lib/persistentRateLimit";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ organizationId: string }> }) {
  try {
    const context = await requirePlatformAdmin(req);
    assertPlatformCapability(context, "platform:organizations-manage");
    const limited = await enforcePersistentRateLimit(req, "platform-first-admin-invite", 10, 15 * 60_000);
    if (limited) return limited;
    const parsed = FirstAdminInvitationInput.omit({ organizationId: true, idempotencyKey: true, correlationId: true }).safeParse(
      JSON.parse(await readBoundedRequestText(req, 4_096)),
    );
    if (!parsed.success) return jsonError(400, "Проверьте данные приглашения первого ADMIN");
    const { organizationId } = await params;
    const { inviteToken, ...result } = await reissueFirstAdminInvitation(context, {
      ...parsed.data, organizationId,
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
      correlationId: req.headers.get("x-correlation-id") ?? "",
    });
    return NextResponse.json({ ...result, inviteUrl: inviteToken ? buildInvitationUrl(new URL(req.url).origin, inviteToken) : null }, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError(400, "Некорректный JSON");
    return handleApiError(error, "platform/organizations/first-admin-invite");
  }
}
