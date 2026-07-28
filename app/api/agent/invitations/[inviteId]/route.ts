import { NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitations";
import { appendOperationalAudit } from "@/lib/operationalAudit";
import { assertCapability } from "@/lib/operationalAuth";
import { runOperationalTransaction } from "@/lib/operationalTransaction";

const Body = z.object({
  action: z.enum(["RESEND", "REVOKE"]),
  expiresInHours: z.number().int().min(1).max(168).default(48),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  try {
    const context = await requireAgent(req, { allowAdminMutation: true });
    assertCapability(context, "membership:invite");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Некорректное действие");
    const { inviteId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");
    const token = parsed.data.action === "RESEND" ? createInvitationToken() : null;

    const result = await runOperationalTransaction(async (tx) => {
      const replay = await tx.operationalAuditEvent.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: context.organizationId, idempotencyKey } },
      });
      if (replay) return { replayed: true, id: replay.entityId };
      const invite = await tx.organizationInvite.findFirst({
        where: { id: inviteId, organizationId: context.organizationId, acceptedAt: null },
      });
      if (!invite) return null;
      const updated = await tx.organizationInvite.update({
        where: { id: invite.id },
        data: parsed.data.action === "REVOKE"
          ? { revokedAt: new Date() }
          : {
              tokenHash: hashInvitationToken(token!),
              expiresAt: new Date(Date.now() + parsed.data.expiresInHours * 3_600_000),
              revokedAt: null,
            },
      });
      await appendOperationalAudit(tx, context, {
        entityType: "membership",
        entityId: invite.id,
        action: parsed.data.action === "REVOKE" ? "INVITE_REVOKED" : "MEMBER_INVITED",
        before: { revoked: Boolean(invite.revokedAt), expiresAt: invite.expiresAt.toISOString() },
        after: { revoked: Boolean(updated.revokedAt), expiresAt: updated.expiresAt.toISOString() },
        correlationId,
        idempotencyKey,
        result: { inviteId: invite.id },
      });
      return { replayed: false, id: invite.id };
    });
    if (!result) return jsonError(404, "Приглашение не найдено");
    return NextResponse.json({
      ...result,
      token: result.replayed || parsed.data.action !== "RESEND" ? undefined : token,
    });
  } catch (error) {
    return handleApiError(error, "invitations/update");
  }
}
