import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitations";
import { normalizeEmail } from "@/lib/agentAuth";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";

export const runtime = "nodejs";

const Body = z.object({
  email: z.string().email(),
  role: z.enum(["AGENT", "MANAGER", "ADMIN"]),
  confirmation: z.string().trim().max(120).optional(),
  expiresInHours: z.number().int().min(1).max(168).default(48),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAgent(req, { allowAdminMutation: true });
    assertCapability(session, "membership:invite");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");
    if (parsed.data.role === "ADMIN" && parsed.data.confirmation !== "НАЗНАЧИТЬ АДМИНИСТРАТОРА") {
      return jsonError(422, "Для назначения ADMIN введите «НАЗНАЧИТЬ АДМИНИСТРАТОРА»");
    }
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");

    const token = createInvitationToken();
    let invite;
    try {
      invite = await runOperationalTransaction(async (tx) => {
      const replay = await tx.operationalAuditEvent.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: session.organizationId, idempotencyKey } },
      });
      if (replay) {
        assertInvitationReplay(replay);
        return { id: replay.entityId, replayed: true };
      }
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
          action: "MEMBER_INVITED",
          before: {},
          after: { role: created.role, expiresAt: created.expiresAt.toISOString() },
          correlationId,
          idempotencyKey,
          result: { inviteId: created.id },
        },
      });
      return { id: created.id, replayed: false };
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const replay = await prisma.operationalAuditEvent.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: session.organizationId, idempotencyKey } },
      });
      if (!replay) throw error;
      assertInvitationReplay(replay);
      invite = { id: replay.entityId, replayed: true };
    }

    return NextResponse.json({ ...invite, token: invite.replayed ? undefined : token }, { status: invite.replayed ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, "invitations/create");
  }
}

function assertInvitationReplay(replay: { action: string; entityType: string; entityId: string }) {
  if (replay.action !== "MEMBER_INVITED" || replay.entityType !== "membership") {
    throw new OperationalCommandError(409, "Idempotency key уже использован другой командой", "IDEMPOTENCY_CONFLICT");
  }
}
