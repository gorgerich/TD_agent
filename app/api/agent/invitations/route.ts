import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitations";
import { normalizeEmail } from "@/lib/agentAuth";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email(),
  role: z.enum(["AGENT", "MANAGER", "ADMIN"]),
  expiresInHours: z.number().int().min(1).max(168).default(48),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    assertCapability(session, "membership:invite");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");

    const token = createInvitationToken();
    const invite = await prisma.$transaction(async (tx) => {
      const replay = await tx.operationalAuditEvent.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: session.organizationId, idempotencyKey } },
      });
      if (replay) return { id: replay.entityId, replayed: true };
      const created = await tx.organizationInvite.create({
        data: {
          organizationId: session.organizationId,
          emailNormalized: normalizeEmail(parsed.data.email),
          tokenHash: hashInvitationToken(token),
          role: parsed.data.role,
          expiresAt: new Date(Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000),
          createdByMembershipId: session.membershipId,
        },
      });
      await tx.operationalAuditEvent.create({
        data: {
          organizationId: session.organizationId,
          actorMembershipId: session.membershipId,
          entityType: "membership",
          entityId: created.id,
          action: "membership.invited",
          before: {},
          after: { role: created.role, expiresAt: created.expiresAt.toISOString() },
          correlationId,
          idempotencyKey,
          result: { inviteId: created.id },
        },
      });
      return { id: created.id, replayed: false };
    });

    return NextResponse.json({ ...invite, token: invite.replayed ? undefined : token }, { status: invite.replayed ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, "invitations/create");
  }
}
