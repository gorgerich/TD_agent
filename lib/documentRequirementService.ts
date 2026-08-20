import type { CaseScenario, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendOperationalAudit } from "@/lib/operationalAudit";
import { assertCapability, type OperationalContext } from "@/lib/operationalAuth";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";
import { evaluateDocumentRequirement } from "@/lib/m3Domain";
import { prismaJson, requireTenantCase, type M3CommandMeta, validateM3CommandMeta } from "@/lib/m3Command";

type RequirementActor = {
  organizationId: string;
  membershipId: string;
};

export async function materializeCaseRequirements(
  context: OperationalContext,
  caseId: string,
  meta: M3CommandMeta,
) {
  assertCapability(context, "documents:upload");
  validateM3CommandMeta(meta);
  return runOperationalTransaction(async (tx) => {
    const record = await requireTenantCase(tx, context, caseId, { requireOwnerForAgent: true });
    return materializeCaseRequirementsInTransaction(tx, context, record.id, record.scenarioId, meta);
  });
}

export async function materializeCaseRequirementsInTransaction(
  tx: Prisma.TransactionClient,
  actor: RequirementActor,
  caseId: string,
  scenario: CaseScenario,
  meta: M3CommandMeta,
  now = new Date(),
) {
  if (scenario !== "CREMATION_V1" && scenario !== "FAMILY_PLOT_BURIAL_V1") {
    throw new OperationalCommandError(422, "Сначала выберите пилотный сценарий кейса");
  }
  const policyId = await lockDocumentRequirementPolicyScenario(tx, scenario, now);
  if (!policyId) return { policyApproved: false, policyId: null, created: 0, existing: 0 };
  const policy = await tx.documentRequirementPolicy.findUniqueOrThrow({
    where: { id: policyId },
    include: { rules: { orderBy: { stableKey: "asc" } } },
  });

  const caseFacts = await tx.case.findUniqueOrThrow({
    where: { id: caseId },
    select: {
      lead: { select: { ceremonyAt: true } },
      parties: {
        select: {
          roles: {
            where: { validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
            select: { role: true },
          },
        },
      },
    },
  });

  const reviewer = await tx.membership.findFirst({
    where: {
      organizationId: actor.organizationId,
      role: "DOCUMENT_REVIEWER",
      status: "ACTIVE",
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const ruleApplicability = new Map(policy.rules.map((rule) => [rule.id, requirementApplies(rule, caseFacts)]));
  const existingRequirements = await tx.caseDocumentRequirement.findMany({
    where: { caseId, ruleId: { in: policy.rules.map((rule) => rule.id) } },
    select: { id: true, ruleId: true, isApplicable: true },
  });
  const existingByRuleId = new Map(existingRequirements.map((requirement) => [requirement.ruleId, requirement]));
  const missingRules = policy.rules.filter((rule) => !existingByRuleId.has(rule.id));
  const inserted = missingRules.length === 0
    ? { count: 0 }
    : await tx.caseDocumentRequirement.createMany({
      data: missingRules.map((rule) => ({
        organizationId: actor.organizationId,
        caseId,
        policyId: policy.id,
        ruleId: rule.id,
        policyVersion: policy.version,
        stableKey: rule.stableKey,
        kind: rule.kind,
        conditionExplanation: rule.conditionExplanation,
        dueAt: rule.dueOffsetHours == null ? null : new Date(now.getTime() + rule.dueOffsetHours * 3_600_000),
        ownerMembershipId: reviewer?.id ?? null,
        ownerRole: rule.ownerRole,
        blockingStage: rule.blockingStage,
        acceptedDocumentTypeCodes: prismaJson(stringArray(rule.acceptedDocumentTypeCodes)),
        reviewChecklist: prismaJson(stringArray(rule.reviewChecklist)),
        isApplicable: ruleApplicability.get(rule.id) ?? false,
        applicabilityEvaluatedAt: now,
        satisfactionStatus: "NOT_SATISFIED",
        sourceRule: rule.source,
      })),
      skipDuplicates: true,
    });
  const created = inserted.count;
  const applicabilityChanges = existingRequirements.filter((requirement) => (
    requirement.isApplicable !== (ruleApplicability.get(requirement.ruleId) ?? false)
  ));
  await Promise.all(applicabilityChanges.map((requirement) => tx.caseDocumentRequirement.update({
    where: { id: requirement.id },
    data: {
      isApplicable: ruleApplicability.get(requirement.ruleId) ?? false,
      applicabilityEvaluatedAt: now,
    },
  })));
  const existing = policy.rules.length - created;
  const notApplicable = [...ruleApplicability.values()].filter((value) => !value).length;

  if (created > 0 || applicabilityChanges.length > 0) {
    await appendOperationalAudit(tx, actor, {
      entityType: "document_requirement",
      entityId: caseId,
      action: "document_requirements.materialized.v1",
      before: {},
      after: prismaJson({ policyId: policy.id, policyVersion: policy.version, scenario, ruleCount: policy.rules.length }),
      correlationId: meta.correlationId,
      causationId: meta.idempotencyKey,
      idempotencyKey: `${meta.idempotencyKey}:document-requirements`,
      reason: meta.reason,
      result: prismaJson({ created, existing, notApplicable, applicabilityChanged: applicabilityChanges.length, policyId: policy.id }),
    });
  }
  return {
    policyApproved: true,
    policyId: policy.id,
    created,
    existing,
    notApplicable,
    applicabilityChanged: applicabilityChanges.length,
  };
}

export async function refreshCaseRequirementApplicabilityInTransaction(
  tx: Prisma.TransactionClient,
  actor: RequirementActor,
  caseId: string,
  meta: M3CommandMeta,
  now = new Date(),
) {
  const [caseFacts, requirements] = await Promise.all([
    loadRequirementFacts(tx, caseId, now),
    tx.caseDocumentRequirement.findMany({
      where: { caseId, organizationId: actor.organizationId },
      select: {
        id: true,
        stableKey: true,
        kind: true,
        isApplicable: true,
        rule: { select: { conditionKey: true } },
      },
    }),
  ]);
  const changed = requirements.flatMap((requirement) => {
    const next = requirementApplies(requirement, caseFacts);
    return next === requirement.isApplicable ? [] : [{ ...requirement, next }];
  });
  await Promise.all(changed.map((requirement) => tx.caseDocumentRequirement.update({
    where: { id: requirement.id },
    data: { isApplicable: requirement.next, applicabilityEvaluatedAt: now },
  })));
  if (changed.length > 0) {
    await appendOperationalAudit(tx, actor, {
      entityType: "document_requirement",
      entityId: caseId,
      action: "document_requirements.applicability_refreshed.v1",
      before: prismaJson({ changed: changed.map((item) => ({ stableKey: item.stableKey, isApplicable: item.isApplicable })) }),
      after: prismaJson({ changed: changed.map((item) => ({ stableKey: item.stableKey, isApplicable: item.next })) }),
      correlationId: meta.correlationId,
      causationId: meta.idempotencyKey,
      idempotencyKey: `${meta.idempotencyKey}:document-requirements-applicability`,
      reason: meta.reason,
      result: prismaJson({ changed: changed.length }),
    });
  }
  return { changed: changed.length };
}

export async function lockDocumentRequirementPolicyScenario(
  tx: Prisma.TransactionClient,
  scenario: "CREMATION_V1" | "FAMILY_PLOT_BURIAL_V1",
  now = new Date(),
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "DocumentRequirementPolicy"
    WHERE "scenario" = CAST(${scenario} AS "CaseScenario")
      AND "status" = CAST('APPROVED' AS "M3PolicyStatus")
      AND "effectiveFrom" <= ${now}
      AND ("retiredAt" IS NULL OR "retiredAt" > ${now})
    ORDER BY "version" DESC
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0]?.id ?? null;
}

export async function checkCaseRequirementMaterializationParity(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  caseId: string,
  scenario: CaseScenario,
): Promise<{ ok: boolean; reason: string | null; policyId: string | null; expected: number; actual: number }> {
  if (scenario !== "CREMATION_V1" && scenario !== "FAMILY_PLOT_BURIAL_V1") {
    return { ok: false, reason: "CASE_SCENARIO_UNSUPPORTED", policyId: null, expected: 0, actual: 0 };
  }
  const requirements = await client.caseDocumentRequirement.findMany({
    where: { organizationId, caseId },
    select: {
      policyId: true,
      ruleId: true,
      policyVersion: true,
      stableKey: true,
      kind: true,
      conditionExplanation: true,
      ownerRole: true,
      blockingStage: true,
      acceptedDocumentTypeCodes: true,
      reviewChecklist: true,
      sourceRule: true,
    },
  });
  const policyIds = [...new Set(requirements.map((requirement) => requirement.policyId))];
  if (policyIds.length !== 1) {
    return {
      ok: false,
      reason: requirements.length === 0 ? "DOCUMENT_REQUIREMENTS_MISSING" : "MULTIPLE_DOCUMENT_POLICIES_MATERIALIZED",
      policyId: policyIds[0] ?? null,
      expected: 0,
      actual: requirements.length,
    };
  }
  const policy = await client.documentRequirementPolicy.findFirst({
    where: { id: policyIds[0], scenario, status: { in: ["APPROVED", "RETIRED"] } },
    select: {
      id: true,
      version: true,
      rules: {
        select: {
          id: true,
          stableKey: true,
          kind: true,
          conditionExplanation: true,
          ownerRole: true,
          blockingStage: true,
          acceptedDocumentTypeCodes: true,
          reviewChecklist: true,
          source: true,
        },
      },
    },
  });
  if (!policy) {
    return {
      ok: false,
      reason: "DOCUMENT_POLICY_INVALID",
      policyId: policyIds[0],
      expected: 0,
      actual: requirements.length,
    };
  }
  const requirementsByRule = new Map(requirements.map((requirement) => [requirement.ruleId, requirement]));
  const exact = requirements.length === policy.rules.length && policy.rules.every((rule) => {
    const requirement = requirementsByRule.get(rule.id);
    return requirement != null
      && requirement.policyId === policy.id
      && requirement.policyVersion === policy.version
      && requirement.stableKey === rule.stableKey
      && requirement.kind === rule.kind
      && requirement.conditionExplanation === rule.conditionExplanation
      && requirement.ownerRole === rule.ownerRole
      && requirement.blockingStage === rule.blockingStage
      && sameStringArray(requirement.acceptedDocumentTypeCodes, rule.acceptedDocumentTypeCodes)
      && sameStringArray(requirement.reviewChecklist, rule.reviewChecklist)
      && requirement.sourceRule === rule.source;
  });
  return {
    ok: exact,
    reason: exact ? null : "DOCUMENT_REQUIREMENT_POLICY_PARITY_MISMATCH",
    policyId: policy.id,
    expected: policy.rules.length,
    actual: requirements.length,
  };
}

export type RequirementFacts = {
  lead: { ceremonyAt: Date | null };
  parties: Array<{ roles: Array<{ role: string }> }>;
};

async function loadRequirementFacts(tx: Prisma.TransactionClient, caseId: string, now: Date): Promise<RequirementFacts> {
  return tx.case.findUniqueOrThrow({
    where: { id: caseId },
    select: {
      lead: { select: { ceremonyAt: true } },
      parties: {
        select: {
          roles: {
            where: { validFrom: { lte: now }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
            select: { role: true },
          },
        },
      },
    },
  });
}

function requirementApplies(
  rule: { kind: "REQUIRED" | "CONDITIONAL"; conditionKey?: string | null; rule?: { conditionKey: string | null } },
  facts: RequirementFacts,
): boolean {
  if (rule.kind === "REQUIRED") return true;
  const applies = evaluateRequirementCondition(rule.conditionKey ?? rule.rule?.conditionKey ?? null, facts);
  if (applies === null) {
    throw new OperationalCommandError(422, "Условие requirement не поддержано безопасным engine");
  }
  return applies;
}

export function evaluateRequirementCondition(conditionKey: string | null, facts: RequirementFacts): boolean | null {
  if (!conditionKey) return null;
  const roles = new Set(facts.parties.flatMap((party) => party.roles.map((assignment) => assignment.role)));
  if (conditionKey === "HAS_PAYER") return roles.has("PAYER");
  if (conditionKey === "HAS_RESPONSIBLE_FOR_BURIAL") return roles.has("RESPONSIBLE_FOR_BURIAL");
  if (conditionKey === "CEREMONY_DATE_SET") return facts.lead.ceremonyAt != null;
  return null;
}

export async function listCaseDocumentRequirements(context: OperationalContext, caseId: string, now = new Date()) {
  assertCapability(context, "documents:read");
  const requirements = await prisma.caseDocumentRequirement.findMany({
    where: {
      organizationId: context.organizationId,
      caseId,
      ...(context.role === "AGENT" ? { case: { ownerId: context.agentId } } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { stableKey: "asc" }],
    include: {
      policy: { select: { status: true, version: true, scenario: true } },
      document: {
        select: {
          id: true,
          status: true,
          documentType: { select: { code: true, name: true, version: true } },
          versions: {
            orderBy: { versionNumber: "desc" },
            select: {
              id: true,
              versionNumber: true,
              status: true,
              scanStatus: true,
              expiresAt: true,
              rejectionReason: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  return requirements.map((requirement) => {
    const derived = evaluateDocumentRequirement(requirement.document?.versions ?? [], now);
    return {
      id: requirement.id,
      stableKey: requirement.stableKey,
      policyStatus: requirement.policy.status,
      policyVersion: requirement.policyVersion,
      scenario: requirement.policy.scenario,
      kind: requirement.kind,
      conditionExplanation: requirement.conditionExplanation,
      dueAt: requirement.dueAt,
      ownerRole: requirement.ownerRole,
      ownerMembershipId: requirement.ownerMembershipId,
      isApplicable: requirement.isApplicable,
      applicabilityEvaluatedAt: requirement.applicabilityEvaluatedAt,
      blockingStage: requirement.blockingStage,
      acceptedDocumentTypeCodes: stringArray(requirement.acceptedDocumentTypeCodes),
      reviewChecklist: stringArray(requirement.reviewChecklist),
      storedSatisfactionStatus: requirement.satisfactionStatus,
      derivedSatisfactionStatus: derived.status,
      verifiedVersionNumber: derived.verifiedVersionNumber,
      document: requirement.document,
    };
  });
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sameStringArray(left: Prisma.JsonValue, right: Prisma.JsonValue): boolean {
  const leftValues = stringArray(left);
  const rightValues = stringArray(right);
  return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
}
