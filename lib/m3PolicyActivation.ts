import { Prisma, type CaseScenario, type MembershipRole } from "@prisma/client";
import { z } from "zod";
import { appendPlatformAudit } from "@/lib/platformAudit";
import { commandFingerprint, prismaJson } from "@/lib/m3Command";
import { OperationalCommandError } from "@/lib/operationalTransaction";

const Attestation = z.object({
  verdict: z.literal("PASS"),
  source: z.string().trim().min(3).max(500),
  date: z.iso.datetime(),
}).strict();

const Rule = z.object({
  stableKey: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  kind: z.enum(["REQUIRED", "CONDITIONAL"]),
  conditionKey: z.string().trim().min(3).max(100).nullable(),
  conditionExplanation: z.string().trim().min(3).max(500).nullable(),
  dueOffsetHours: z.number().int().nonnegative().max(24 * 365).nullable(),
  ownerRole: z.enum(["DOCUMENT_REVIEWER"]),
  blockingStage: z.enum(["EXECUTION", "CLOSED"]),
  acceptedDocumentTypeCodes: z.array(z.string().regex(/^[A-Z0-9_]{3,80}$/)).min(1),
  reviewChecklist: z.array(z.string().trim().min(3).max(160)).min(1),
  source: z.string().trim().min(3).max(500),
}).strict();

const BundleSchema = z.object({
  schemaVersion: z.literal(1),
  organizationId: z.string().trim().min(1).max(200),
  approvedByUserId: z.number().int().positive(),
  approvedAt: z.iso.datetime(),
  effectiveFrom: z.iso.datetime(),
  attestations: z.object({
    finance: Attestation,
    legalPrivacy: Attestation,
    ritualSme: Attestation,
  }).strict(),
  documentTypes: z.array(z.object({
    code: z.string().regex(/^[A-Z0-9_]{3,80}$/),
    version: z.number().int().positive(),
    name: z.string().trim().min(3).max(160),
    description: z.string().trim().max(500).nullable(),
    allowedMimeTypes: z.array(z.enum(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"])).min(1),
    maxBytes: z.number().int().positive().max(10 * 1024 * 1024),
    source: z.string().trim().min(3).max(500),
  }).strict()).min(1),
  documentPolicies: z.array(z.object({
    scenario: z.enum(["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"]),
    version: z.number().int().positive(),
    source: z.string().trim().min(3).max(500),
    rules: z.array(Rule).min(1),
  }).strict()).length(2),
  signingPolicy: z.object({
    version: z.string().trim().min(1).max(80),
    allowedEvidenceTypes: z.array(z.string().trim().min(3).max(80)).min(1),
    source: z.string().trim().min(3).max(500),
  }).strict(),
  financialPolicy: z.object({
    version: z.number().int().positive(),
    correctionThresholdKopecks: z.number().int().positive(),
    source: z.string().trim().min(3).max(500),
  }).strict(),
}).strict();

export type M3ApprovedPolicyBundle = z.infer<typeof BundleSchema>;

export function parseM3ApprovedPolicyBundle(value: unknown): M3ApprovedPolicyBundle {
  const bundle = BundleSchema.parse(value);
  const scenarios = new Set(bundle.documentPolicies.map((policy) => policy.scenario));
  if (scenarios.size !== 2 || !scenarios.has("CREMATION_V1") || !scenarios.has("FAMILY_PLOT_BURIAL_V1")) {
    throw new Error("Approved bundle must contain exactly both M3 pilot scenarios");
  }
  assertUnique(bundle.documentTypes.map((item) => `${item.code}:${item.version}`), "document type");
  const availableCodes = new Set(bundle.documentTypes.map((item) => item.code));
  const scenarioKeys = new Map<string, Set<string>>();
  for (const policy of bundle.documentPolicies) {
    assertUnique(policy.rules.map((rule) => rule.stableKey), `${policy.scenario} rule`);
    scenarioKeys.set(policy.scenario, new Set(policy.rules.map((rule) => rule.stableKey)));
    for (const rule of policy.rules) {
      if (rule.acceptedDocumentTypeCodes.some((code) => !availableCodes.has(code))) {
        throw new Error(`Rule ${rule.stableKey} references an unapproved document type`);
      }
      if (rule.kind === "CONDITIONAL" && !rule.conditionKey) {
        throw new Error(`Conditional rule ${rule.stableKey} requires conditionKey`);
      }
    }
  }
  const cremation = scenarioKeys.get("CREMATION_V1")!;
  const burial = scenarioKeys.get("FAMILY_PLOT_BURIAL_V1")!;
  if (cremation.size === burial.size && [...cremation].every((key) => burial.has(key))) {
    throw new Error("Cremation and relative-burial approved checklists must differ");
  }
  return bundle;
}

export async function applyM3ApprovedPolicyBundle(
  tx: Prisma.TransactionClient,
  bundle: M3ApprovedPolicyBundle,
) {
  const fingerprint = commandFingerprint(bundle);
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${bundle.organizationId} FOR UPDATE`;
  const [organization, approver] = await Promise.all([
    tx.organization.findFirst({ where: { id: bundle.organizationId, status: "ACTIVE" }, select: { id: true } }),
    tx.user.findFirst({ where: { id: bundle.approvedByUserId, platformRole: "SUPER_ADMIN" }, select: { id: true } }),
  ]);
  if (!organization) throw new OperationalCommandError(404, "Активная организация не найдена");
  if (!approver) throw new OperationalCommandError(403, "Утверждающий Platform SUPER_ADMIN не найден");

  const replay = await tx.platformAuditEvent.findFirst({
    where: { action: "M3_POLICIES_ACTIVATED", targetType: "organization", targetId: bundle.organizationId },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  if (metadataFingerprint(replay?.metadata) === fingerprint) {
    return { replayed: true, bundleFingerprint: fingerprint };
  }

  for (const item of bundle.documentTypes) {
    const existing = await tx.documentTypeDefinition.findUnique({
      where: { code_version: { code: item.code, version: item.version } },
    });
    const expected = {
      code: item.code,
      version: item.version,
      name: item.name,
      description: item.description,
      allowedMimeTypes: item.allowedMimeTypes,
      maxBytes: item.maxBytes,
      status: "APPROVED" as const,
      source: item.source,
    };
    if (existing) assertExactPolicy(existing, expected, `Document type ${item.code} v${item.version}`);
    else {
      await tx.documentTypeDefinition.updateMany({
        where: { code: item.code, status: "APPROVED" },
        data: { status: "RETIRED" },
      });
      await tx.documentTypeDefinition.create({ data: { ...expected, allowedMimeTypes: prismaJson(item.allowedMimeTypes) } });
    }
  }

  for (const policy of bundle.documentPolicies) {
    const existing = await tx.documentRequirementPolicy.findUnique({
      where: { scenario_version: { scenario: policy.scenario as CaseScenario, version: policy.version } },
      include: { rules: { orderBy: { stableKey: "asc" } } },
    });
    const policyExpected = {
      scenario: policy.scenario,
      version: policy.version,
      status: "APPROVED" as const,
      source: policy.source,
      approvedByUserId: bundle.approvedByUserId,
      approvedAt: new Date(bundle.approvedAt),
      effectiveFrom: new Date(bundle.effectiveFrom),
      retiredAt: null,
    };
    if (existing) {
      assertExactPolicy(existing, policyExpected, `${policy.scenario} policy v${policy.version}`);
      const existingRules = existing.rules.map(ruleSnapshot);
      const expectedRules = policy.rules.map(ruleSnapshot).sort(compareStableKey);
      if (commandFingerprint(existingRules) !== commandFingerprint(expectedRules)) {
        throw new OperationalCommandError(409, `${policy.scenario} policy content conflicts with approved bundle`);
      }
    } else {
      await tx.documentRequirementPolicy.updateMany({
        where: { scenario: policy.scenario as CaseScenario, status: "APPROVED" },
        data: { status: "RETIRED", retiredAt: new Date(bundle.approvedAt) },
      });
      await tx.documentRequirementPolicy.create({
        data: {
          ...policyExpected,
          scenario: policy.scenario as CaseScenario,
          rules: {
            create: policy.rules.map((rule) => ({
              ...rule,
              ownerRole: rule.ownerRole as MembershipRole,
              acceptedDocumentTypeCodes: prismaJson(rule.acceptedDocumentTypeCodes),
              reviewChecklist: prismaJson(rule.reviewChecklist),
            })),
          },
        },
      });
    }
  }

  const signingExpected = {
    organizationId: bundle.organizationId,
    version: bundle.signingPolicy.version,
    status: "APPROVED" as const,
    allowedEvidenceTypes: bundle.signingPolicy.allowedEvidenceTypes,
    source: bundle.signingPolicy.source,
    approvedByUserId: bundle.approvedByUserId,
    approvedAt: new Date(bundle.approvedAt),
    effectiveFrom: new Date(bundle.effectiveFrom),
    retiredAt: null,
  };
  const signing = await tx.contractSigningPolicy.findUnique({
    where: { organizationId_version: { organizationId: bundle.organizationId, version: bundle.signingPolicy.version } },
  });
  if (signing) assertExactPolicy(signing, signingExpected, `Signing policy ${bundle.signingPolicy.version}`);
  else {
    await tx.contractSigningPolicy.updateMany({
      where: { organizationId: bundle.organizationId, status: "APPROVED" },
      data: { status: "RETIRED", retiredAt: new Date(bundle.approvedAt) },
    });
    await tx.contractSigningPolicy.create({
      data: { ...signingExpected, allowedEvidenceTypes: prismaJson(bundle.signingPolicy.allowedEvidenceTypes) },
    });
  }

  const financeExpected = {
    organizationId: bundle.organizationId,
    version: bundle.financialPolicy.version,
    status: "APPROVED" as const,
    correctionThresholdKopecks: bundle.financialPolicy.correctionThresholdKopecks,
    source: bundle.financialPolicy.source,
    approvedAt: new Date(bundle.approvedAt),
  };
  const finance = await tx.financialControlPolicy.findUnique({
    where: { organizationId_version: { organizationId: bundle.organizationId, version: bundle.financialPolicy.version } },
  });
  if (finance) assertExactPolicy(finance, financeExpected, `Finance policy v${bundle.financialPolicy.version}`);
  else {
    await tx.financialControlPolicy.updateMany({
      where: { organizationId: bundle.organizationId, status: "APPROVED" },
      data: { status: "RETIRED" },
    });
    await tx.financialControlPolicy.create({ data: financeExpected });
  }

  await appendPlatformAudit(tx, {
    actorUserId: approver.id,
    action: "M3_POLICIES_ACTIVATED",
    targetType: "organization",
    targetId: bundle.organizationId,
    metadata: {
      bundleFingerprint: fingerprint,
      schemaVersion: bundle.schemaVersion,
      policyCount: bundle.documentPolicies.length + 2,
      typeCount: bundle.documentTypes.length,
      financeVerdict: bundle.attestations.finance.verdict,
      legalPrivacyVerdict: bundle.attestations.legalPrivacy.verdict,
      ritualSmeVerdict: bundle.attestations.ritualSme.verdict,
      effectiveFrom: bundle.effectiveFrom,
    },
  });
  return { replayed: false, bundleFingerprint: fingerprint };
}

function ruleSnapshot(rule: Record<string, unknown>) {
  return {
    stableKey: rule.stableKey,
    kind: rule.kind,
    conditionKey: rule.conditionKey ?? null,
    conditionExplanation: rule.conditionExplanation ?? null,
    dueOffsetHours: rule.dueOffsetHours ?? null,
    ownerRole: rule.ownerRole,
    blockingStage: rule.blockingStage,
    acceptedDocumentTypeCodes: rule.acceptedDocumentTypeCodes,
    reviewChecklist: rule.reviewChecklist,
    source: rule.source,
  };
}

function compareStableKey(left: { stableKey: unknown }, right: { stableKey: unknown }) {
  return String(left.stableKey).localeCompare(String(right.stableKey));
}

function assertExactPolicy(actual: Record<string, unknown>, expected: Record<string, unknown>, label: string) {
  const selected = Object.fromEntries(Object.keys(expected).map((key) => [key, actual[key]]));
  if (commandFingerprint(selected) !== commandFingerprint(expected)) {
    throw new OperationalCommandError(409, `${label} conflicts with approved bundle`);
  }
}

function metadataFingerprint(value: Prisma.JsonValue | null | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fingerprint = (value as Record<string, unknown>).bundleFingerprint;
  return typeof fingerprint === "string" ? fingerprint : null;
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} in approved bundle`);
}
