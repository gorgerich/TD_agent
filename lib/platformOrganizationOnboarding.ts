import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { PlatformContext } from "@/lib/platformAuth";
import { createInvitationToken, hashInvitationToken } from "@/lib/invitations";
import { ADMIN_CONFIRMATION } from "@/lib/organizationAdmin";
import { assertClientCommandKey } from "@/lib/commandNamespace";
import { isReleaseWriteFreezeActive } from "@/lib/releaseWriteFreeze";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";

const InvitationInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  confirmation: z.literal(ADMIN_CONFIRMATION),
  reason: z.string().trim().min(3).max(240),
  idempotencyKey: z.string().trim().min(1).max(200),
  correlationId: z.string().trim().min(1).max(200),
}).strict();
export const CreateOrganizationInput = InvitationInput.extend({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80),
  timezone: z.string().trim().max(100).refine(value => {
    try { new Intl.DateTimeFormat("ru-RU", { timeZone: value }); return true; } catch { return false; }
  }),
}).strict();
export const FirstAdminInvitationInput = InvitationInput.extend({ organizationId: z.string().min(1).max(200) }).strict();

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function authorize(context: PlatformContext): void {
  if (context.platformRole !== "SUPER_ADMIN" || !context.platformMfaEnabled || !context.mfaVerified) {
    throw new OperationalCommandError(403, "Требуется SUPER_ADMIN с подтверждённой MFA");
  }
  if (isReleaseWriteFreezeActive()) throw new OperationalCommandError(503, "Изменения временно приостановлены");
}

async function lockCurrentActor(tx: Prisma.TransactionClient, context: PlatformContext): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${context.userId} FOR UPDATE`;
  const actor = await tx.user.findUnique({
    where: { id: context.userId },
    select: { platformRole: true, sessionVersion: true, platformMfaEnabledAt: true },
  });
  if (!actor || actor.platformRole !== "SUPER_ADMIN" || !actor.platformMfaEnabledAt || actor.sessionVersion !== context.sessionVersion) {
    throw new OperationalCommandError(403, "Полномочия владельца платформы изменились; войдите снова");
  }
}

function replayResult(event: { action: string; targetId: string | null; metadata: Prisma.JsonValue }, action: string, fingerprint: string) {
  const metadata = event.metadata as Record<string, unknown> | null;
  if (event.action !== action || metadata?.fingerprint !== fingerprint || !event.targetId) {
    throw new OperationalCommandError(409, "Ключ повтора уже использован другой командой", "IDEMPOTENCY_CONFLICT");
  }
  // Raw invitations are never persisted: a lost response requires explicit reissue, not token recovery.
  return { organizationId: event.targetId, replayed: true, inviteToken: null, expiresAt: null };
}

async function issueFirstAdminInvitation(
  tx: Prisma.TransactionClient,
  context: PlatformContext,
  command: z.infer<typeof FirstAdminInvitationInput>,
) {
  const organization = await tx.organization.findFirst({ where: { id: command.organizationId, status: "ACTIVE" }, select: { id: true } });
  if (!organization) throw new OperationalCommandError(404, "Активная организация не найдена");
  const admin = await tx.membership.findFirst({ where: { organizationId: organization.id, role: "ADMIN" }, select: { id: true } });
  const assigned = await tx.platformAuditEvent.findFirst({
    where: { targetType: "organization", targetId: organization.id, action: "ORGANIZATION_FIRST_ADMIN_ASSIGNED" }, select: { id: true },
  });
  if (admin || assigned) throw new OperationalCommandError(409, "Первый ADMIN уже назначен; используйте управление сотрудниками");
  const user = await tx.user.findUnique({ where: { email: command.email }, select: { id: true } });
  if (user) throw new OperationalCommandError(409, "Этот аккаунт уже существует. Его доступ нельзя переносить через приглашение новой организации");
  const now = new Date();
  await tx.organizationInvite.updateMany({
    where: { organizationId: organization.id, role: "ADMIN", acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  await tx.platformOrganizationInvite.updateMany({
    where: { organizationId: organization.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: now },
  });
  const token = createInvitationToken();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
  await tx.platformOrganizationInvite.create({ data: {
    organizationId: organization.id, emailNormalized: command.email,
    tokenHash: hashInvitationToken(token), role: "ADMIN", expiresAt,
    createdByUserId: context.userId,
  } });
  return { organizationId: organization.id, replayed: false, inviteToken: token, expiresAt };
}

export async function createOrganizationWithFirstAdmin(context: PlatformContext, input: z.infer<typeof CreateOrganizationInput>) {
  authorize(context);
  const parsed = CreateOrganizationInput.safeParse(input);
  if (!parsed.success) throw new OperationalCommandError(400, "Проверьте данные организации и первого ADMIN");
  const command = parsed.data;
  assertClientCommandKey(command.idempotencyKey);
  const fingerprint = digest([context.userId, command.name, command.slug, command.timezone, command.email, command.reason]);
  const auditId = `organization-create:${digest([context.userId, command.idempotencyKey])}`;
  try {
    return await runOperationalTransaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(182092251, hashtext(${command.slug})) IS NULL AS "locked"`;
      await lockCurrentActor(tx, context);
      const replay = await tx.platformAuditEvent.findUnique({ where: { id: auditId } });
      if (replay) return replayResult(replay, "ORGANIZATION_CREATED_WITH_ADMIN_INVITE", fingerprint);
      const existing = await tx.organization.findUnique({ where: { slug: command.slug }, select: { id: true } });
      if (existing) throw new OperationalCommandError(409, "Идентификатор организации уже занят");
      const tier = await tx.agentTier.findFirst({ select: { id: true } });
      if (!tier) throw new OperationalCommandError(503, "Тариф сотрудников не настроен");
      const organization = await tx.organization.create({ data: { name: command.name, slug: command.slug, timezone: command.timezone }, select: { id: true } });
      const result = await issueFirstAdminInvitation(tx, context, { ...command, organizationId: organization.id });
      await tx.platformAuditEvent.create({ data: {
        id: auditId, actorUserId: context.userId, action: "ORGANIZATION_CREATED_WITH_ADMIN_INVITE", targetType: "organization", targetId: organization.id,
        metadata: { fingerprint, reason: command.reason, correlationId: command.correlationId, before: {}, after: { status: "ACTIVE", firstAdminInvited: true } },
      } });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new OperationalCommandError(409, "Организация или команда уже существует. Обновите список и повторите исходную команду");
    }
    throw error;
  }
}

export async function reissueFirstAdminInvitation(context: PlatformContext, input: z.infer<typeof FirstAdminInvitationInput>) {
  authorize(context);
  const parsed = FirstAdminInvitationInput.safeParse(input);
  if (!parsed.success) throw new OperationalCommandError(400, "Проверьте данные приглашения первого ADMIN");
  const command = parsed.data;
  assertClientCommandKey(command.idempotencyKey);
  const fingerprint = digest([context.userId, command.organizationId, command.email, command.reason]);
  const auditId = `first-admin-invitation:${digest([context.userId, command.idempotencyKey])}`;
  return runOperationalTransaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${command.organizationId} FOR UPDATE`;
    await lockCurrentActor(tx, context);
    const replay = await tx.platformAuditEvent.findUnique({ where: { id: auditId } });
    if (replay) return replayResult(replay, "ORGANIZATION_FIRST_ADMIN_INVITED", fingerprint);
    const result = await issueFirstAdminInvitation(tx, context, command);
    await tx.platformAuditEvent.create({ data: {
      id: auditId, actorUserId: context.userId, action: "ORGANIZATION_FIRST_ADMIN_INVITED", targetType: "organization", targetId: command.organizationId,
      metadata: { fingerprint, reason: command.reason, correlationId: command.correlationId, before: { unusedInvitationsRevoked: true }, after: { firstAdminInvited: true } },
    } });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
