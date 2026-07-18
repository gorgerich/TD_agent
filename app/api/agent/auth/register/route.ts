import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import {
  createAgentSession,
  getDefaultAgentTierId,
  normalizeEmail,
  normalizeOptionalPhone,
  setAgentSessionCookie,
} from "@/lib/agentAuth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { hashInvitationToken, productionRegistrationRequiresInvite } from "@/lib/invitations";
import { ensureLegacyOrganizationForAgent } from "@/lib/operationalAuth";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().trim().min(2, "Укажите имя"),
  email: z.string().trim().email("Укажите email"),
  phone: z.string().trim().optional(),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов"),
  inviteToken: z.string().min(32).optional(),
});

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "register", 5, 60_000);
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Неверный запрос" }, { status: 400 });
  }
  if (productionRegistrationRequiresInvite() && !parsed.data.inviteToken) {
    return NextResponse.json({ error: "Регистрация доступна только по приглашению организации" }, { status: 403 });
  }

  const email = normalizeEmail(parsed.data.email);
  const phone = normalizeOptionalPhone(parsed.data.phone);
  const passwordHash = hashPassword(parsed.data.password);
  const tierId = await getDefaultAgentTierId();
  const inviteHash = parsed.data.inviteToken ? hashInvitationToken(parsed.data.inviteToken) : null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
        select: { id: true },
      });
      if (existing) throw new RegistrationError(409, "Агент с таким email или телефоном уже зарегистрирован");

      const invite = inviteHash
        ? await tx.organizationInvite.findUnique({ where: { tokenHash: inviteHash } })
        : null;
      if (inviteHash && (!invite || invite.emailNormalized !== email || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date())) {
        throw new RegistrationError(403, "Приглашение недействительно или истекло");
      }

      const agent = await tx.agent.create({
        data: {
          status: "ACTIVE",
          selfEmployed: true,
          tier: { connect: { id: tierId } },
          user: { create: { email, name: parsed.data.name.trim(), phone, passwordHash } },
        },
        include: { user: true },
      });

      if (invite) {
        const membership = await tx.membership.create({
          data: {
            organizationId: invite.organizationId,
            userId: agent.userId,
            agentId: agent.id,
            role: invite.role,
            status: "ACTIVE",
          },
        });
        await tx.organizationInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
        await tx.operationalAuditEvent.create({
          data: {
            organizationId: invite.organizationId,
            actorMembershipId: membership.id,
            actorType: "invitee",
            entityType: "membership",
            entityId: membership.id,
            action: "membership.invite_accepted",
            before: { status: "INVITED" },
            after: { status: "ACTIVE", role: invite.role },
            correlationId: `invite:${invite.id}`,
            causationId: invite.id,
            idempotencyKey: `invite:accepted:${invite.id}`,
            result: { membershipId: membership.id },
          },
        });
        return { agent, role: membership.role };
      }

      const operational = await ensureLegacyOrganizationForAgent({
        agentId: agent.id,
        userId: agent.userId,
        agentStatus: "ACTIVE",
      }, tx);
      return { agent, role: "AGENT" as const, operational };
    });

    const token = await createAgentSession({
      userId: created.agent.userId,
      agentId: created.agent.id,
      role: created.role,
      name: created.agent.user.name,
    });
    return setAgentSessionCookie(NextResponse.json({ ok: true }), token);
  } catch (error) {
    if (error instanceof RegistrationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

class RegistrationError extends Error {
  constructor(public readonly status: 403 | 409, message: string) {
    super(message);
  }
}
