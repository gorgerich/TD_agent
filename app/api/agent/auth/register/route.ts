import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import {
  createAgentSession,
  normalizeEmail,
  normalizeOptionalPhone,
  setAgentSessionCookie,
} from "@/lib/agentAuth";
import { enforceRateLimit } from "@/lib/rateLimit";
import { hashInvitationToken, productionRegistrationRequiresInvite } from "@/lib/invitations";
import { ensureLegacyOrganizationForAgent } from "@/lib/operationalAuth";
import { requireAppEncryptionKey } from "@/lib/session";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().trim().min(2, "Укажите имя"),
  email: z.string().trim().email("Укажите email"),
  phone: z.string().trim().optional(),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов").max(200),
  inviteToken: z.string().min(32).optional(),
});

export async function POST(req: NextRequest) {
  try {
    requireAppEncryptionKey();
  } catch {
    return NextResponse.json({ error: "Сервис временно недоступен" }, { status: 503, headers: { "Retry-After": "5" } });
  }
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
  const inviteHash = parsed.data.inviteToken ? hashInvitationToken(parsed.data.inviteToken) : null;

  if (inviteHash) {
    const invite = await readRegistrationInvitation(prisma, inviteHash);
    if (
      !invite
      || invite.organization.status !== "ACTIVE"
      || invite.emailNormalized !== email
      || invite.acceptedAt
      || invite.revokedAt
      || invite.expiresAt <= new Date()
    ) {
      return NextResponse.json({ error: "Приглашение недействительно или истекло" }, { status: 403 });
    }
  }

  const passwordHash = hashPassword(parsed.data.password);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findFirst({
        where: { OR: [{ email }, ...(phone ? [{ phone }] : [])] },
        select: { id: true },
      });
      if (existing) throw new RegistrationError(409, "Агент с таким email или телефоном уже зарегистрирован");

      let invite = inviteHash
        ? await readRegistrationInvitation(tx, inviteHash)
        : null;
      if (invite) {
        // Serialize acceptance with first-ADMIN assignment/reissue and organization suspension.
        await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${invite.organizationId} FOR UPDATE`;
        invite = await readRegistrationInvitation(tx, inviteHash!);
      }
      if (
        inviteHash
        && (
          !invite
          || invite.organization.status !== "ACTIVE"
          || invite.emailNormalized !== email
          || invite.acceptedAt
          || invite.revokedAt
          || invite.expiresAt <= new Date()
        )
      ) {
        throw new RegistrationError(403, "Приглашение недействительно или истекло");
      }
      if (invite?.kind === "platform" && await tx.membership.findFirst({
        where: { organizationId: invite.organizationId, role: "ADMIN" }, select: { id: true },
      })) throw new RegistrationError(403, "Приглашение недействительно или истекло");
      const tier = await tx.agentTier.findFirst({ orderBy: [{ commissionPct: "asc" }, { id: "asc" }] });
      if (!tier) throw new RegistrationError(503, "Тариф агента не настроен");

      const agent = await tx.agent.create({
        data: {
          status: "ACTIVE",
          selfEmployed: true,
          tier: { connect: { id: tier.id } },
          user: { create: { email, name: parsed.data.name.trim(), phone, passwordHash } },
        },
        include: { user: true },
      });

      if (invite) {
        const claim = { where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } };
        const claimed = invite.kind === "platform" ? await tx.platformOrganizationInvite.updateMany(claim) : await tx.organizationInvite.updateMany(claim);
        if (claimed.count !== 1) throw new RegistrationError(403, "Приглашение недействительно или истекло");
        const membership = await tx.membership.create({
          data: {
            organizationId: invite.organizationId,
            userId: agent.userId,
            agentId: agent.id,
            role: invite.role,
            status: "ACTIVE",
          },
        });
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
    return setAgentSessionCookie(NextResponse.json({ ok: true, redirectTo: "/agent/cases" }), token);
  } catch (error) {
    if (error instanceof RegistrationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Сервис временно недоступен" }, { status: 503, headers: { "Retry-After": "5" } });
  }
}

class RegistrationError extends Error {
  constructor(public readonly status: 403 | 409 | 503, message: string) {
    super(message);
  }
}

async function readRegistrationInvitation(client: typeof prisma | Prisma.TransactionClient, tokenHash: string) {
  const legacy = await client.organizationInvite.findUnique({ where: { tokenHash }, include: { organization: { select: { status: true } } } });
  if (legacy) return { ...legacy, kind: "membership" as const };
  const platform = await client.platformOrganizationInvite.findUnique({ where: { tokenHash }, include: { organization: { select: { status: true } } } });
  return platform ? { ...platform, kind: "platform" as const } : null;
}
