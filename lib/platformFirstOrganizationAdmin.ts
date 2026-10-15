import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { PlatformContext } from "@/lib/platformAuth";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";
import { ADMIN_CONFIRMATION, assertAdminRoleConfirmation } from "@/lib/organizationAdmin";
import { sanitizePlatformAuditMetadata } from "@/lib/platformAudit";
import { isReleaseWriteFreezeActive } from "@/lib/releaseWriteFreeze";
import { assertClientCommandKey } from "@/lib/commandNamespace";

const ACTION = "ORGANIZATION_FIRST_ADMIN_ASSIGNED";
export const FirstOrganizationAdminCommand = z.object({
  organizationId: z.string().trim().min(1).max(200),
  membershipId: z.string().trim().min(1).max(200),
  confirmation: z.literal(ADMIN_CONFIRMATION),
  reason: z.string().trim().min(3).max(240),
  idempotencyKey: z.string().trim().min(1).max(200),
  correlationId: z.string().trim().min(1).max(200),
}).strict();
export type FirstOrganizationAdminInput = z.infer<typeof FirstOrganizationAdminCommand>;

export async function assignFirstOrganizationAdmin(context: PlatformContext, input: FirstOrganizationAdminInput) {
  return runOperationalTransaction((tx) => assignFirstOrganizationAdminInTransaction(tx, context, input));
}

export async function assignFirstOrganizationAdminInTransaction(
  tx: Prisma.TransactionClient,
  context: PlatformContext,
  input: FirstOrganizationAdminInput,
) {
  if (context.platformRole !== "SUPER_ADMIN" || !context.platformMfaEnabled || !context.mfaVerified) {
    throw new OperationalCommandError(403, "Требуется SUPER_ADMIN с подтверждённой MFA");
  }
  if (isReleaseWriteFreezeActive()) throw new OperationalCommandError(503, "Изменения временно приостановлены");
  const parsed = FirstOrganizationAdminCommand.safeParse(input);
  if (!parsed.success) throw new OperationalCommandError(400, "Некорректная команда назначения ADMIN");
  const command = parsed.data;
  assertClientCommandKey(command.idempotencyKey);
  assertAdminRoleConfirmation("ADMIN", command.confirmation);
  const { organizationId, membershipId, reason, idempotencyKey, correlationId } = command;
  const auditId = `first-org-admin:${digest([organizationId, idempotencyKey])}`;
  const fingerprint = digest([context.userId, organizationId, membershipId, reason]);

  // Serialize bootstrap attempts per tenant; Serializable also detects races
  // with existing membership/invitation writers that do not take this lock.
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;

  // Match Organization -> User -> Membership ordering; revoke stale actors before replay.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${context.userId} FOR UPDATE`;
  const actor = await tx.user.findUnique({
    where: { id: context.userId },
    select: { sessionVersion: true, platformRole: true, platformMfaEnabledAt: true },
  });
  if (!actor || actor.sessionVersion !== context.sessionVersion || actor.platformRole !== "SUPER_ADMIN" || !actor.platformMfaEnabledAt) {
    throw new OperationalCommandError(403, "Полномочия владельца платформы изменились; войдите снова");
  }
  const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
  if (!organization) throw new OperationalCommandError(404, "Организация не найдена");
  if (organization.status !== "ACTIVE") throw new OperationalCommandError(409, "Организация приостановлена");

  const replay = await tx.platformAuditEvent.findUnique({ where: { id: auditId } });
  if (replay) {
    const metadata = replay.metadata as Record<string, unknown>;
    if (replay.action !== ACTION || replay.targetId !== organizationId || metadata.fingerprint !== fingerprint) {
      throw new OperationalCommandError(409, "Ключ повтора уже использован другой командой", "IDEMPOTENCY_CONFLICT");
    }
    return { organizationId, membershipId, role: "ADMIN" as const, replayed: true };
  }

  const previousBootstrap = await tx.platformAuditEvent.findFirst({ where: { action: ACTION, targetType: "organization", targetId: organizationId } });
  const admin = await tx.membership.findFirst({ where: { organizationId, role: "ADMIN" }, select: { id: true } });
  const pendingAdmin = await tx.organizationInvite.findFirst({
    where: { organizationId, role: "ADMIN", acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (previousBootstrap || admin || pendingAdmin) {
    throw new OperationalCommandError(409, "Первый ADMIN уже назначен или приглашён", "FIRST_ADMIN_ALREADY_EXISTS");
  }
  await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "id" = ${membershipId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  const membership = await tx.membership.findFirst({
    where: { id: membershipId, organizationId },
    select: { id: true, role: true, status: true, agentId: true, agent: { select: { status: true } }, user: { select: { platformRole: true } } },
  });
  if (!membership) throw new OperationalCommandError(404, "Сотрудник не найден");
  if (membership.status !== "ACTIVE" || !membership.agentId || membership.agent?.status !== "ACTIVE" || membership.user.platformRole !== "USER") {
    throw new OperationalCommandError(409, "Нужен активный сотрудник с рабочим доступом без роли платформы");
  }
  await tx.membership.update({ where: { id: membershipId }, data: { role: "ADMIN" } });
  await tx.platformAuditEvent.create({
    data: {
      id: auditId, actorUserId: context.userId, action: ACTION, targetType: "organization", targetId: organizationId,
      metadata: sanitizePlatformAuditMetadata({
        organizationId, membershipId, reason, idempotencyKey, correlationId, fingerprint,
        before: { role: membership.role, status: membership.status },
        after: { role: "ADMIN", status: "ACTIVE" },
      }),
    },
  });
  return { organizationId, membershipId, role: "ADMIN" as const, replayed: false };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
