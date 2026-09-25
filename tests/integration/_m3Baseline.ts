import { prisma } from "../../lib/prisma";
import { isApprovedIntegrationDatabaseEnvironment } from "./testDatabaseSafety";

const SOURCE = "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT";
const APPROVER_EMAIL = "m3-policy-approver@synthetic.invalid";
const POLICY_VERSION = 3_000_001;
const LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('td-agent-m3-integration-baseline-v1'))";

export const M3_TEST_DOCUMENT_TYPES = {
  identity: "M3_IT_IDENTITY_V1",
  death: "M3_IT_DEATH_RECORD_V1",
  cremation: "M3_IT_CREMATION_V1",
  burialPlot: "M3_IT_BURIAL_PLOT_V1",
  relationship: "M3_IT_RELATIONSHIP_V1",
} as const;

const typeDefinitions = [
  [M3_TEST_DOCUMENT_TYPES.identity, "Synthetic identity evidence"],
  [M3_TEST_DOCUMENT_TYPES.death, "Synthetic death-record evidence"],
  [M3_TEST_DOCUMENT_TYPES.cremation, "Synthetic cremation evidence"],
  [M3_TEST_DOCUMENT_TYPES.burialPlot, "Synthetic burial-plot evidence"],
  [M3_TEST_DOCUMENT_TYPES.relationship, "Synthetic relationship evidence"],
] as const;

const policyDefinitions = [
  {
    scenario: "CREMATION_V1" as const,
    rules: [
      ["identity-record", M3_TEST_DOCUMENT_TYPES.identity, "identity-match"],
      ["death-record", M3_TEST_DOCUMENT_TYPES.death, "death-record-match"],
      ["cremation-authorization", M3_TEST_DOCUMENT_TYPES.cremation, "scenario-evidence"],
    ] as const,
  },
  {
    scenario: "FAMILY_PLOT_BURIAL_V1" as const,
    rules: [
      ["identity-record", M3_TEST_DOCUMENT_TYPES.identity, "identity-match"],
      ["death-record", M3_TEST_DOCUMENT_TYPES.death, "death-record-match"],
      ["plot-entitlement", M3_TEST_DOCUMENT_TYPES.burialPlot, "plot-evidence"],
      ["relationship-evidence", M3_TEST_DOCUMENT_TYPES.relationship, "relationship-match"],
      [
        "responsible-for-burial-confirmation",
        M3_TEST_DOCUMENT_TYPES.relationship,
        "responsible-party-match",
        "HAS_RESPONSIBLE_FOR_BURIAL",
      ],
    ] as const,
  },
] as const;

function assertIsolatedTarget() {
  if (process.env.ALLOW_DB_TESTS !== "1" || !isApprovedIntegrationDatabaseEnvironment({
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    databaseUrl: process.env.DATABASE_URL,
    directDatabaseUrl: process.env.DATABASE_URL_UNPOOLED,
  })) {
    throw new Error("M3 integration baseline requires an approved exact local throwaway database.");
  }
}

export async function installM3IntegrationBaseline() {
  assertIsolatedTarget();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(LOCK_SQL);
    await tx.user.upsert({
      where: { email: APPROVER_EMAIL },
      update: {},
      create: { email: APPROVER_EMAIL, name: "Synthetic M3 policy approver" },
      select: { id: true },
    });
  });
}

export async function installM3OrganizationBaseline(organizationId: string) {
  assertIsolatedTarget();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`td-agent-m3-integration-baseline:${organizationId}`}))`;
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new Error("Integration organization is absent.");
    const conflictingPolicy = await tx.documentRequirementPolicy.findFirst({
      where: { organizationId, status: "APPROVED", retiredAt: null, source: { not: SOURCE } },
      select: { scenario: true },
    });
    if (conflictingPolicy) {
      throw new Error(`Integration target contains a non-baseline approved ${conflictingPolicy.scenario} policy.`);
    }
    const approver = await tx.user.findUnique({ where: { email: APPROVER_EMAIL }, select: { id: true } });
    if (!approver) throw new Error("Install the canonical M3 integration baseline before creating fixtures.");

    const typeIds = new Map<string, string>();
    for (const [code, name] of typeDefinitions) {
      const type = await tx.documentTypeDefinition.upsert({
        where: { organizationId_code_version: { organizationId, code, version: 1 } },
        update: { name, allowedMimeTypes: ["application/pdf"], maxBytes: 1_000_000, status: "APPROVED", source: SOURCE },
        create: { organizationId, code, version: 1, name, allowedMimeTypes: ["application/pdf"], maxBytes: 1_000_000, status: "APPROVED", source: SOURCE },
        select: { id: true },
      });
      typeIds.set(code, type.id);
    }

    for (const definition of policyDefinitions) {
      const policy = await tx.documentRequirementPolicy.upsert({
        where: { organizationId_scenario_version: { organizationId, scenario: definition.scenario, version: POLICY_VERSION } },
        update: {
          status: "APPROVED",
          source: SOURCE,
          approvedByUserId: approver.id,
          approvedAt: new Date("2026-08-11T00:00:00.000Z"),
          effectiveFrom: new Date("2026-08-11T00:00:00.000Z"),
          retiredAt: null,
        },
        create: {
          organizationId,
          scenario: definition.scenario,
          version: POLICY_VERSION,
          status: "APPROVED",
          source: SOURCE,
          approvedByUserId: approver.id,
          approvedAt: new Date("2026-08-11T00:00:00.000Z"),
          effectiveFrom: new Date("2026-08-11T00:00:00.000Z"),
        },
        select: { id: true },
      });
      await tx.documentRequirementRule.deleteMany({
        where: {
          policyId: policy.id,
          source: SOURCE,
          stableKey: { notIn: definition.rules.map(([stableKey]) => stableKey) },
        },
      });
      for (const [stableKey, documentTypeCode, checklistItem, conditionKey] of definition.rules) {
        await tx.documentRequirementRule.upsert({
          where: { policyId_stableKey: { policyId: policy.id, stableKey } },
          update: {
            kind: conditionKey ? "CONDITIONAL" : "REQUIRED",
            conditionKey: conditionKey ?? null,
            conditionExplanation: conditionKey ? "Synthetic conditional requirement for applicability regression" : null,
            ownerRole: "DOCUMENT_REVIEWER",
            blockingStage: "EXECUTION",
            acceptedDocumentTypeCodes: [documentTypeCode],
            acceptedDocumentTypeVersionIds: [typeIds.get(documentTypeCode)!],
            reviewChecklist: [checklistItem],
            source: SOURCE,
          },
          create: {
            policyId: policy.id,
            stableKey,
            kind: conditionKey ? "CONDITIONAL" : "REQUIRED",
            conditionKey: conditionKey ?? null,
            conditionExplanation: conditionKey ? "Synthetic conditional requirement for applicability regression" : null,
            ownerRole: "DOCUMENT_REVIEWER",
            blockingStage: "EXECUTION",
            acceptedDocumentTypeCodes: [documentTypeCode],
            acceptedDocumentTypeVersionIds: [typeIds.get(documentTypeCode)!],
            reviewChecklist: [checklistItem],
            source: SOURCE,
          },
        });
      }
    }
  });
  return getM3IntegrationBaseline(organizationId);
}

export async function getM3IntegrationBaseline(organizationId: string) {
  assertIsolatedTarget();
  const policies = await prisma.documentRequirementPolicy.findMany({
    where: { organizationId, version: POLICY_VERSION, source: SOURCE, status: "APPROVED", retiredAt: null },
    select: { id: true, scenario: true, rules: { select: { id: true } } },
  });
  if (
    policies.length !== policyDefinitions.length
    || policies.some((policy) => {
      const expectedRuleCount = policy.scenario === "CREMATION_V1"
        ? policyDefinitions[0].rules.length
        : policy.scenario === "FAMILY_PLOT_BURIAL_V1"
          ? policyDefinitions[1].rules.length
          : null;
      return expectedRuleCount === null || policy.rules.length !== expectedRuleCount;
    })
  ) {
    throw new Error("M3 integration baseline is absent or incomplete. Use canonical integration runner.");
  }
  return {
    cremationPolicyId: policies.find((policy) => policy.scenario === "CREMATION_V1")!.id,
    burialPolicyId: policies.find((policy) => policy.scenario === "FAMILY_PLOT_BURIAL_V1")!.id,
    documentTypes: M3_TEST_DOCUMENT_TYPES,
    policyIds: policies.map((policy) => policy.id),
    documentTypeIds: [...(await prisma.documentTypeDefinition.findMany({
      where: { organizationId, version: 1, source: SOURCE, code: { in: Object.values(M3_TEST_DOCUMENT_TYPES) } },
      select: { id: true },
    })).map((item) => item.id)],
  };
}

export async function removeM3IntegrationBaseline() {
  assertIsolatedTarget();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(LOCK_SQL);
    // Safety was proved before opening this transaction. The M3 migration correctly
    // protects approved history from application deletes; this throwaway-only fixture
    // teardown disables those triggers while deleting exact canonical baseline IDs.
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    const policies = await tx.documentRequirementPolicy.findMany({
      where: { version: POLICY_VERSION, source: SOURCE },
      select: { id: true },
    });
    const policyIds = policies.map((policy) => policy.id);
    const references = policyIds.length
      ? await tx.caseDocumentRequirement.count({ where: { policyId: { in: policyIds } } })
      : 0;
    if (references !== 0) throw new Error(`M3 integration baseline still has ${references} requirement references.`);
    if (policyIds.length) {
      await tx.documentRequirementRule.deleteMany({ where: { policyId: { in: policyIds } } });
      await tx.documentRequirementPolicy.deleteMany({ where: { id: { in: policyIds } } });
    }
    await tx.documentTypeDefinition.deleteMany({
      where: { version: 1, source: SOURCE, code: { in: Object.values(M3_TEST_DOCUMENT_TYPES) } },
    });
    await tx.user.deleteMany({ where: { email: APPROVER_EMAIL } });
  });
}

if (process.argv[1]?.endsWith("_m3Baseline.ts")) {
  const command = process.argv[2];
  const action = command === "install"
    ? installM3IntegrationBaseline()
    : command === "cleanup"
      ? removeM3IntegrationBaseline()
      : Promise.reject(new Error("Expected install or cleanup."));
  action.finally(() => prisma.$disconnect()).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "M3 integration baseline failed"}\n`);
    process.exitCode = 1;
  });
}
