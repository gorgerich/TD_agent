import { NextRequest, NextResponse } from "next/server";
import { createUserSession, setAgentSessionCookie } from "@/lib/agentAuth";
import { appendPlatformAudit } from "@/lib/platformAudit";
import { requirePlatformAdmin } from "@/lib/platformAuth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const context = await requirePlatformAdmin(req);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: context.userId },
      data: { sessionVersion: { increment: 1 } },
    });
    await appendPlatformAudit(tx, {
      actorUserId: context.userId,
      action: "PLATFORM_SESSIONS_REVOKED",
      targetType: "user",
      targetId: String(context.userId),
      metadata: { scope: "all-other-sessions" },
    });
  });
  const token = await createUserSession({
    userId: context.userId,
    activeMembershipId: context.activeMembershipId,
    mfaVerified: true,
    name: context.name,
  });
  return setAgentSessionCookie(NextResponse.json({ ok: true }), token);
}
