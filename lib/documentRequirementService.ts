import type { CaseScenario, DocumentRequirementRule, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { appendOperationalAudit } from "@/lib/operationalAudit";
import { assertCapability, type OperationalContext } from "@/lib/operationalAuth";
import { OperationalCommandError, runOperationalTransaction } from "@/lib/operationalTransaction";
import { evaluateDocumentRequirement } from "@/lib/m3Domain";
import { isM3ProductionWriteAllowed } from "@/lib/m3AuditMode";
import { assertM3ProductionActivation } from "@/lib/m3ProductionActivation";
import { prismaJson, requireTenantCase, type M3CommandMeta, validateM3CommandMeta } from "@/lib/m3Command";
import { serverCommandKey } from "@/lib/commandNamespace";

type RequirementActor = {
  organizationId: string;
  membershipId?: string | null;
  actorType?: string;
};

type ApplicabilityRequirement = {
  id: string;
  stableKey: string;
  kind: "REQUIRED" | "CONDITIONAL";
  isApplicable: boolean;
  conditionKey: string | null;
  policyScenario: CaseScenario;
  supersededAt: Date | null;
};

export type LockedDocumentRequirementPolicy = { id: string; organizationId: string; scenario: CaseScenario; version: number; rules: DocumentRequirementRule[] };

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
  refreshMeta?: M3CommandMeta,
  lockedPolicy?: LockedDocumentRequirementPolicy | null,
) {
  if (scenario !== "CREMATION_V1" && scenario !== "FAMILY_PLOT_BURIAL_V1") {
    throw new OperationalCommandError(422, "Сначала выберите пилотный сценарий кейса");
  }
  if (!isM3ProductionWriteAllowed(actor.organizationId)) {
    return { policyApproved: false, policyId: null, created: 0, existing: 0 };
  }
  await assertM3ProductionActivation(tx, actor.organizationId);
  const policy = lockedPolicy === undefined
    ? await lockAndReadDocumentRequirementPolicyScenario(tx, actor.organizationId, scenario, now)
    : lockedPolicy;
  if (policy && (policy.organizationId !== actor.organizationId || policy.scenario !== scenario)) {
    throw new OperationalCommandError(409, "Политика требований не соответствует организации или сценарию");
  }
  if (!policy) {
    if (refreshMeta) await refreshCaseRequirementApplicabilityInTransaction(tx, actor, caseId, refreshMeta, now);
    return { policyApproved: false, policyId: null, created: 0, existing: 0 };
  }
  const caseFacts = await loadRequirementFacts(tx, caseId, now);
  const ruleApplicability = new Map(policy.rules.map((rule) => [rule.id, requirementApplies(rule, caseFacts)]));
  const existingRequirements = await loadApplicabilityRequirements(tx, actor.organizationId, caseId);
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
        ownerMembershipId: caseFacts.reviewerMembershipId,
        ownerRole: rule.ownerRole,
        blockingStage: rule.blockingStage,
        acceptedDocumentTypeCodes: prismaJson(stringArray(rule.acceptedDocumentTypeCodes)),
        acceptedDocumentTypeVersionIds: prismaJson(stringArray(rule.acceptedDocumentTypeVersionIds)),
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
    ruleApplicability.has(requirement.ruleId)
    && requirement.isApplicable !== ruleApplicability.get(requirement.ruleId)
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
      idempotencyKey: serverCommandKey("document-requirements", meta.idempotencyKey),
      reason: meta.reason,
      result: prismaJson({ created, existing, notApplicable, applicabilityChanged: applicabilityChanges.length, policyId: policy.id }),
      actorType: actor.actorType,
    });
  }
  if (refreshMeta) {
    // Newly inserted requirements already use these same facts. Existing current
    // policy rows were updated above; only historical applicability remains.
    const historicalRequirements = existingRequirements.filter(requirement => !ruleApplicability.has(requirement.ruleId));
    await refreshCaseRequirementApplicabilityInTransaction(tx, actor, caseId, refreshMeta, now, caseFacts, historicalRequirements);
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
  facts?: RequirementFacts,
  existingRequirements?: ApplicabilityRequirement[],
) {
  if (!isM3ProductionWriteAllowed(actor.organizationId)) return { changed: 0 };
  await assertM3ProductionActivation(tx, actor.organizationId);
  const [caseFacts, requirements] = await Promise.all([
    facts ?? loadRequirementFacts(tx, caseId, now),
    existingRequirements ?? loadApplicabilityRequirements(tx, actor.organizationId, caseId),
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
      idempotencyKey: serverCommandKey("document-requirements-applicability", meta.idempotencyKey),
      reason: meta.reason,
      result: prismaJson({ changed: changed.length }),
      actorType: actor.actorType,
    });
  }
  return { changed: changed.length };
}

export async function lockDocumentRequirementPolicyScenario(
  tx: Prisma.TransactionClient,
  organizationId: string,
  scenario: "CREMATION_V1" | "FAMILY_PLOT_BURIAL_V1",
  now = new Date(),
) {
  return (await lockAndReadDocumentRequirementPolicyScenario(tx, organizationId, scenario, now))?.id ?? null;
}

export async function lockAndReadDocumentRequirementPolicyScenario(
  tx: Prisma.TransactionClient,
  organizationId: string,
  scenario: "CREMATION_V1" | "FAMILY_PLOT_BURIAL_V1",
  now = new Date(),
): Promise<LockedDocumentRequirementPolicy | null> {
  const [policy] = await tx.$queryRaw<LockedDocumentRequirementPolicy[]>`
    SELECT policy."id", policy."organizationId", policy."scenario", policy."version", coalesce((
      SELECT jsonb_agg(to_jsonb(rule) ORDER BY rule."stableKey")
      FROM "DocumentRequirementRule" rule WHERE rule."policyId" = policy."id"
    ), '[]'::jsonb) AS rules
    FROM "DocumentRequirementPolicy" policy
    WHERE policy."organizationId" = ${organizationId}
      AND policy."scenario" = CAST(${scenario} AS "CaseScenario")
      AND policy."status" = CAST('APPROVED' AS "M3PolicyStatus")
      AND policy."effectiveFrom" <= ${now}
      AND (policy."retiredAt" IS NULL OR policy."retiredAt" > ${now})
    ORDER BY policy."version" DESC LIMIT 1 FOR SHARE OF policy
  `;
  return policy ?? null;
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
    where: { organizationId, caseId, supersededAt: null, policy: { scenario } },
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
      acceptedDocumentTypeVersionIds: true,
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
    where: { id: policyIds[0], organizationId, scenario, status: { in: ["APPROVED", "RETIRED"] } },
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
          acceptedDocumentTypeVersionIds: true,
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
      && sameStringArray(requirement.acceptedDocumentTypeVersionIds, rule.acceptedDocumentTypeVersionIds)
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
  scenarioId?: CaseScenario;
  lead: { ceremonyAt: Date | null };
  parties: Array<{ roles: Array<{ role: string }> }>;
};

async function loadRequirementFacts(tx: Prisma.TransactionClient, caseId: string, now: Date): Promise<RequirementFacts & { reviewerMembershipId: string | null }> {
  // Applicability consumes only the date and the set of effective roles, not
  // the party records. One joined read avoids four relation round trips.
  const rows = await tx.$queryRaw<Array<{ ceremonyAt: Date | null; role: string | null; scenarioId: CaseScenario; reviewerMembershipId: string | null }>>`
    SELECT lead."ceremonyAt", record."scenarioId", assignment."role"::text AS "role", (
      SELECT "id" FROM "Membership"
      WHERE "organizationId" = record."tenantId" AND "role" = 'DOCUMENT_REVIEWER' AND "status" = 'ACTIVE'
      ORDER BY "createdAt", "id" LIMIT 1
    ) AS "reviewerMembershipId"
    FROM "Case" AS record
    JOIN "ClientLead" AS lead ON lead."id" = record."leadId"
    LEFT JOIN "CaseParty" AS party
      ON party."caseId" = record."id" AND party."organizationId" = record."tenantId"
    LEFT JOIN "CasePartyRoleAssignment" AS assignment
      ON assignment."casePartyId" = party."id" AND assignment."organizationId" = record."tenantId"
      AND assignment."validFrom" <= ${now}
      AND (assignment."validUntil" IS NULL OR assignment."validUntil" > ${now})
    WHERE record."id" = ${caseId}
  `;
  if (!rows.length) throw new OperationalCommandError(404, "Кейс не найден");
  return {
    reviewerMembershipId: rows[0].reviewerMembershipId,
    scenarioId: rows[0].scenarioId,
    lead: { ceremonyAt: rows[0].ceremonyAt },
    parties: [{ roles: rows.flatMap(({ role }) => role ? [{ role }] : []) }],
  };
}

async function loadApplicabilityRequirements(tx: Prisma.TransactionClient, organizationId: string, caseId: string) {
  return tx.$queryRaw<Array<ApplicabilityRequirement & { ruleId: string }>>`
    SELECT requirement."id", requirement."ruleId", requirement."stableKey", requirement."kind",
      requirement."isApplicable", requirement."supersededAt", rule."conditionKey", policy."scenario" AS "policyScenario"
    FROM "CaseDocumentRequirement" requirement
    JOIN "DocumentRequirementRule" rule ON rule."id" = requirement."ruleId"
    JOIN "DocumentRequirementPolicy" policy ON policy."id" = requirement."policyId"
    WHERE requirement."organizationId" = ${organizationId} AND requirement."caseId" = ${caseId}
  `;
}

function requirementApplies(
  rule: { kind: "REQUIRED" | "CONDITIONAL"; conditionKey?: string | null; policyScenario?: CaseScenario; supersededAt?: Date | null },
  facts: RequirementFacts,
): boolean {
  if (rule.supersededAt || (facts.scenarioId && rule.policyScenario && rule.policyScenario !== facts.scenarioId)) return false;
  if (rule.kind === "REQUIRED") return true;
  const applies = evaluateRequirementCondition(rule.conditionKey ?? null, facts);
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
      isApplicable: requirement.supersededAt == null && requirement.isApplicable,
      supersededAt: requirement.supersededAt,
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
