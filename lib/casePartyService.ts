import type {
  CasePartyRole,
  M3CommunicationChannel,
  M3ConsentStatus,
  M3PartyVisibility,
  Prisma,
} from "@prisma/client";
import { encryptField, decryptField } from "@/lib/crypto";
import {
  assertCapability,
  type OperationalContext,
} from "@/lib/operationalAuth";
import { appendOperationalAudit, findOperationalReplay } from "@/lib/operationalAudit";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";
import {
  commandFingerprint,
  prismaJson,
  readReplayResult,
  requireTenantCase,
  validateM3CommandMeta,
  type M3CommandMeta,
} from "@/lib/m3Command";
import { CASE_PARTY_ROLES } from "@/lib/m3Domain";
import { prisma } from "@/lib/prisma";
import { refreshCaseRequirementApplicabilityInTransaction } from "@/lib/documentRequirementService";

export type CasePartyInput = {
  name: string;
  phone?: string | null;
  email?: string | null;
  roles: CasePartyRole[];
  preferredChannel: M3CommunicationChannel;
  consentStatus: M3ConsentStatus;
  consentSource?: string | null;
  consentAt?: Date | null;
  visibilityPolicy: M3PartyVisibility;
};

export async function createCaseParty(
  context: OperationalContext,
  caseId: string,
  input: CasePartyInput,
  meta: M3CommandMeta,
) {
  assertCapability(context, "parties:manage");
  validateM3CommandMeta(meta);
  const normalized = validatePartyInput(input);
  const fingerprint = commandFingerprint({ action: "case-party.create.v1", caseId, input: normalized });

  return runOperationalTransaction(async (tx) => {
    const replay = await findOperationalReplay(tx, context.organizationId, meta.idempotencyKey);
    if (replay) {
      const stored = readReplayResult<{ partyId: string }>(replay.result, fingerprint);
      if (!stored) throw new OperationalCommandError(409, "Сохранённый результат команды повреждён");
      return { ...stored, replayed: true };
    }
    await requireTenantCase(tx, context, caseId, { requireOwnerForAgent: true });

    const party = await tx.caseParty.create({
      data: {
        organizationId: context.organizationId,
        caseId,
        nameEncrypted: encryptField(normalized.name),
        phoneEncrypted: encryptField(normalized.phone),
        emailEncrypted: encryptField(normalized.email),
        preferredChannel: normalized.preferredChannel,
        consentStatus: normalized.consentStatus,
        consentSource: normalized.consentSource,
        consentAt: normalized.consentAt,
        visibilityPolicy: normalized.visibilityPolicy,
        createdByMembershipId: context.membershipId,
        roles: {
          create: normalized.roles.map((role) => ({
            organizationId: context.organizationId,
            role,
            createdByMembershipId: context.membershipId,
          })),
        },
      },
      select: { id: true },
    });
    const result = { partyId: party.id };
    await appendOperationalAudit(tx, context, {
      entityType: "case_party",
      entityId: party.id,
      action: "case_party.created.v1",
      before: {},
      after: prismaJson({
        caseId,
        roles: normalized.roles,
        preferredChannel: normalized.preferredChannel,
        consentStatus: normalized.consentStatus,
        visibilityPolicy: normalized.visibilityPolicy,
        pii: "encrypted",
      }),
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
      reason: meta.reason,
      result: prismaJson({ commandFingerprint: fingerprint, data: result }),
    });
    await refreshCaseRequirementApplicabilityInTransaction(tx, context, caseId, meta);
    return { ...result, replayed: false };
  });
}

export async function updateCaseParty(
  context: OperationalContext,
  caseId: string,
  partyId: string,
  input: CasePartyInput,
  meta: M3CommandMeta,
) {
  assertCapability(context, "parties:manage");
  validateM3CommandMeta(meta);
  const normalized = validatePartyInput(input);
  const fingerprint = commandFingerprint({ action: "case-party.update.v1", caseId, partyId, input: normalized });

  return runOperationalTransaction(async (tx) => {
    const replay = await findOperationalReplay(tx, context.organizationId, meta.idempotencyKey);
    if (replay) {
      const stored = readReplayResult<{ partyId: string }>(replay.result, fingerprint);
      if (!stored) throw new OperationalCommandError(409, "Сохранённый результат команды повреждён");
      return { ...stored, replayed: true };
    }
    await requireTenantCase(tx, context, caseId, { requireOwnerForAgent: true });
    const current = await tx.caseParty.findFirst({
      where: { id: partyId, caseId, organizationId: context.organizationId },
      include: { roles: { where: { validUntil: null }, select: { id: true, role: true } } },
    });
    if (!current) throw new OperationalCommandError(404, "Участник кейса не найден");

    const nextRoles = new Set(normalized.roles);
    const previousRoles = current.roles.map((role) => role.role);
    const removedIds = current.roles.filter((role) => !nextRoles.has(role.role)).map((role) => role.id);
    const existingRoles = new Set(current.roles.map((role) => role.role));
    const addedRoles = normalized.roles.filter((role) => !existingRoles.has(role));
    const changedAt = new Date();

    if (removedIds.length > 0) {
      await tx.casePartyRoleAssignment.updateMany({
        where: { id: { in: removedIds }, organizationId: context.organizationId, casePartyId: partyId, validUntil: null },
        data: { validUntil: changedAt },
      });
    }
    if (addedRoles.length > 0) {
      await tx.casePartyRoleAssignment.createMany({
        data: addedRoles.map((role) => ({
          organizationId: context.organizationId,
          casePartyId: partyId,
          role,
          validFrom: changedAt,
          createdByMembershipId: context.membershipId,
        })),
      });
    }
    await tx.caseParty.update({
      where: { id: partyId },
      data: {
        nameEncrypted: encryptField(normalized.name),
        phoneEncrypted: encryptField(normalized.phone),
        emailEncrypted: encryptField(normalized.email),
        preferredChannel: normalized.preferredChannel,
        consentStatus: normalized.consentStatus,
        consentSource: normalized.consentSource,
        consentAt: normalized.consentAt,
        visibilityPolicy: normalized.visibilityPolicy,
      },
    });
    const result = { partyId };
    await appendOperationalAudit(tx, context, {
      entityType: "case_party",
      entityId: partyId,
      action: "case_party.updated.v1",
      before: prismaJson({
        roles: previousRoles,
        preferredChannel: current.preferredChannel,
        consentStatus: current.consentStatus,
        visibilityPolicy: current.visibilityPolicy,
        pii: "encrypted",
      }),
      after: prismaJson({
        roles: normalized.roles,
        preferredChannel: normalized.preferredChannel,
        consentStatus: normalized.consentStatus,
        visibilityPolicy: normalized.visibilityPolicy,
        pii: "encrypted",
      }),
      correlationId: meta.correlationId,
      idempotencyKey: meta.idempotencyKey,
      reason: meta.reason,
      result: prismaJson({ commandFingerprint: fingerprint, data: result }),
    });
    await refreshCaseRequirementApplicabilityInTransaction(tx, context, caseId, meta, changedAt);
    return { ...result, replayed: false };
  });
}

export async function listCaseParties(context: OperationalContext, caseId: string) {
  assertCapability(context, "parties:read");
  const where: Prisma.CasePartyWhereInput = {
    organizationId: context.organizationId,
    caseId,
    ...(context.role === "AGENT" ? { case: { ownerId: context.agentId } } : {}),
  };
  const records = await prisma.caseParty.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: { roles: { where: { validUntil: null }, orderBy: { role: "asc" } } },
  });
  return records.map((party) => ({
    id: party.id,
    name: decryptField(party.nameEncrypted),
    phone: decryptField(party.phoneEncrypted),
    email: decryptField(party.emailEncrypted),
    preferredChannel: party.preferredChannel,
    consentStatus: party.consentStatus,
    consentSource: party.consentSource,
    consentAt: party.consentAt,
    visibilityPolicy: party.visibilityPolicy,
    roles: party.roles.map((role) => role.role),
    createdAt: party.createdAt,
  }));
}

function validatePartyInput(input: CasePartyInput): Required<Omit<CasePartyInput, "consentAt">> & { consentAt: Date | null } {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 200) throw new OperationalCommandError(400, "Укажите имя участника кейса");
  const roles = [...new Set(input.roles)];
  if (roles.length === 0 || roles.some((role) => !CASE_PARTY_ROLES.includes(role))) {
    throw new OperationalCommandError(400, "Выберите хотя бы одну допустимую роль");
  }
  const consentSource = input.consentSource?.trim() || null;
  const consentAt = input.consentAt ?? null;
  if (input.consentStatus === "GRANTED" && (!consentSource || !consentAt)) {
    throw new OperationalCommandError(422, "Согласие требует источника и времени");
  }
  return {
    name,
    phone: input.phone?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
    roles,
    preferredChannel: input.preferredChannel,
    consentStatus: input.consentStatus,
    consentSource,
    consentAt,
    visibilityPolicy: input.visibilityPolicy,
  };
}
