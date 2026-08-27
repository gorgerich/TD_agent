import { createPublicKey, verify } from "node:crypto";
import { Prisma, type CaseScenario, type MembershipRole } from "@prisma/client";
import { z } from "zod";
import { appendPlatformAudit } from "@/lib/platformAudit";
import { canonicalJson, commandFingerprint, prismaJson } from "@/lib/m3Command";
import { OperationalCommandError } from "@/lib/operationalTransaction";
import {
  m3ReviewerPublicKeyFingerprint,
  requireActiveM3ReviewerCredential,
} from "@/lib/m3ReviewerCredential";
import {
  checkCaseRequirementMaterializationParity,
  materializeCaseRequirementsInTransaction,
} from "@/lib/documentRequirementService";

const RELEASE_DEPLOYMENT_ID = z.string().regex(/^dpl_[A-Za-z0-9]{8,}$/);
const IMPLEMENTATION_SHA = z.string().regex(/^[0-9a-f]{40}$/);
const ATTESTATION_FINGERPRINT = z.string().regex(/^[0-9a-f]{64}$/);
const DATABASE_FINGERPRINT = z.string().regex(/^[0-9a-f]{16}$/);
const REVIEWER_KEY_FINGERPRINT = z.string().regex(/^[0-9a-f]{64}$/);
const SIGNATURE_VALUE = z.string().regex(/^[A-Za-z0-9_-]{64,256}$/);
const canonicalText = (min: number, max: number) => z.string().min(min).max(max).refine(
  (value) => value === value.trim() && !value.includes("\r"),
  "Signed text must use canonical whitespace",
);
const PUBLIC_KEY_PEM = z.string().min(80).max(2_000).refine(
  (value) => value === value.trim()
    && value.startsWith("-----BEGIN PUBLIC KEY-----")
    && value.endsWith("-----END PUBLIC KEY-----"),
  "Reviewer public key must be a PEM-encoded public key",
);
const PREVIEW_URL = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname.endsWith(".vercel.app") && url.pathname === "/";
}, "Preview URL must be an exact HTTPS vercel.app origin");
const ReleaseCandidate = z.object({
  previewUrl: PREVIEW_URL,
  deploymentId: RELEASE_DEPLOYMENT_ID,
  deploymentSha: IMPLEMENTATION_SHA,
  implementationSha: IMPLEMENTATION_SHA,
  databaseFingerprint: DATABASE_FINGERPRINT,
}).strict();

export const M3_HUMAN_ATTESTATION_CHECKLISTS = {
  finance: [
    "entry-policy",
    "manual-evidence",
    "four-eyes-threshold",
    "accounting-formulas",
    "export-scope",
    "reconciliation",
  ],
  legalPrivacy: [
    "legal-basis-consent",
    "retention-rights",
    "signing-boundary",
    "access-visibility",
    "metadata-minimization",
    "special-category",
  ],
  ritualSme: [
    "cremation-requirements",
    "family-plot-requirements",
    "accepted-document-types",
    "stage-blockers",
    "ownership-due-rules",
    "rejection-replacement-flow",
  ],
} as const;

const Attestation = z.object({
  verdict: z.literal("PASS"),
  reviewer: z.object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/),
    name: canonicalText(3, 160),
    role: z.enum(["FINANCE_ACCOUNTING", "LEGAL_PRIVACY", "RITUAL_OPERATIONS_SME"]),
    credentialReference: z.string().regex(/^platform-audit-key:[0-9a-f]{64}$/),
    experienceYears: z.number().int().positive().max(80).nullable(),
  }).strict(),
  source: canonicalText(3, 500),
  date: z.iso.datetime(),
  reviewedPreviewUrl: PREVIEW_URL,
  reviewedDeploymentId: RELEASE_DEPLOYMENT_ID,
  reviewedDeploymentSha: IMPLEMENTATION_SHA,
  reviewedImplementationSha: IMPLEMENTATION_SHA,
  reviewedDatabaseFingerprint: DATABASE_FINGERPRINT,
  reviewedPolicyContentFingerprint: ATTESTATION_FINGERPRINT,
  checklistAnswers: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    verdict: z.literal("PASS"),
    notes: canonicalText(3, 1_000),
  }).strict()).length(6),
  scenarioResults: z.object({
    cremation: z.object({
      verdict: z.literal("PASS"),
      notes: canonicalText(3, 1_000),
    }).strict(),
    familyPlotBurial: z.object({
      verdict: z.literal("PASS"),
      notes: canonicalText(3, 1_000),
    }).strict(),
  }).strict(),
  signature: z.object({
    algorithm: z.literal("Ed25519"),
    keyFingerprint: REVIEWER_KEY_FINGERPRINT,
    publicKeyPem: PUBLIC_KEY_PEM,
    value: SIGNATURE_VALUE,
  }).strict(),
}).strict();

const Rule = z.object({
  stableKey: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  kind: z.enum(["REQUIRED", "CONDITIONAL"]),
  conditionKey: canonicalText(3, 100).nullable(),
  conditionExplanation: canonicalText(3, 500).nullable(),
  dueOffsetHours: z.number().int().nonnegative().max(24 * 365).nullable(),
  ownerRole: z.enum(["DOCUMENT_REVIEWER"]),
  blockingStage: z.enum(["EXECUTION", "CLOSED"]),
  acceptedDocumentTypeCodes: z.array(z.string().regex(/^[A-Z0-9_]{3,80}$/)).min(1),
  reviewChecklist: z.array(canonicalText(3, 160)).min(1),
  source: canonicalText(3, 500),
}).strict();

const BundleSchema = z.object({
  schemaVersion: z.literal(3),
  releaseCandidate: ReleaseCandidate,
  organizationId: canonicalText(1, 200),
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
    name: canonicalText(3, 160),
    description: canonicalText(0, 500).nullable(),
    allowedMimeTypes: z.array(z.enum(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"])).min(1),
    maxBytes: z.number().int().positive().max(10 * 1024 * 1024),
    source: canonicalText(3, 500),
  }).strict()).min(1),
  documentPolicies: z.array(z.object({
    scenario: z.enum(["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"]),
    version: z.number().int().positive(),
    source: canonicalText(3, 500),
    rules: z.array(Rule).min(1),
  }).strict()).length(2),
  signingPolicy: z.object({
    version: canonicalText(1, 80),
    allowedEvidenceTypes: z.array(canonicalText(3, 80)).min(1),
    source: canonicalText(3, 500),
  }).strict(),
  financialPolicy: z.object({
    version: z.number().int().positive(),
    correctionThresholdKopecks: z.number().int().positive(),
    source: canonicalText(3, 500),
  }).strict(),
}).strict();

const AwaitingHumanGate = z.object({
  status: z.literal("AWAITING_HUMAN_VERDICT"),
  packet: z.string().regex(/^(finance|privacy|ritual-rules)\.md$/),
  attestation: z.null(),
  attestationFingerprint: z.null(),
}).strict();
const PassingHumanGate = z.object({
  status: z.literal("PASS"),
  packet: z.string().regex(/^(finance|privacy|ritual-rules)\.md$/),
  attestation: Attestation,
  attestationFingerprint: ATTESTATION_FINGERPRINT,
}).strict();
const HumanGate = z.discriminatedUnion("status", [AwaitingHumanGate, PassingHumanGate]);
const HumanSignoffsSchema = z.object({
  schemaVersion: z.literal(2),
  candidate: ReleaseCandidate,
  policyContentFingerprint: ATTESTATION_FINGERPRINT.nullable(),
  gates: z.object({
    financeAccounting: HumanGate,
    legalPrivacy: HumanGate,
    ritualOperationsSme: HumanGate,
  }).strict(),
}).strict();

export type M3ApprovedPolicyBundle = z.infer<typeof BundleSchema>;
export type M3HumanSignoffs = z.infer<typeof HumanSignoffsSchema>;

export function parseM3ApprovedPolicyBundle(value: unknown): M3ApprovedPolicyBundle {
  const bundle = BundleSchema.parse(value);
  const scenarios = new Set(bundle.documentPolicies.map((policy) => policy.scenario));
  if (scenarios.size !== 2 || !scenarios.has("CREMATION_V1") || !scenarios.has("FAMILY_PLOT_BURIAL_V1")) {
    throw new Error("Approved bundle must contain exactly both M3 pilot scenarios");
  }
  assertUnique(bundle.documentTypes.map((item) => `${item.code}:${item.version}`), "document type");
  assertUnique(bundle.documentTypes.map((item) => item.code), "document type code");
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
  assertAttestationContract(bundle);
  return bundle;
}

export function m3AttestationFingerprint(
  attestation: M3ApprovedPolicyBundle["attestations"][keyof M3ApprovedPolicyBundle["attestations"]],
) {
  return commandFingerprint(attestation);
}

export function m3PolicyBundleFingerprint(bundle: M3ApprovedPolicyBundle) {
  return commandFingerprint(bundle);
}

export function m3PolicyContentFingerprint(bundle: M3ApprovedPolicyBundle) {
  const policyContent = Object.fromEntries(Object.entries(bundle).filter(([key]) => key !== "attestations"));
  return commandFingerprint(policyContent);
}

export function parseM3HumanSignoffs(value: unknown): M3HumanSignoffs {
  return HumanSignoffsSchema.parse(value);
}

export function m3AttestationSigningPayload(
  attestation: M3ApprovedPolicyBundle["attestations"][keyof M3ApprovedPolicyBundle["attestations"]],
) {
  const payload = Object.fromEntries(Object.entries(attestation).filter(([key]) => key !== "signature"));
  return canonicalJson(payload);
}

export { m3ReviewerPublicKeyFingerprint };

export function verifyM3AttestationSignature(
  attestation: M3ApprovedPolicyBundle["attestations"][keyof M3ApprovedPolicyBundle["attestations"]],
) {
  const key = createPublicKey(attestation.signature.publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") return false;
  return verify(
    null,
    Buffer.from(m3AttestationSigningPayload(attestation), "utf8"),
    key,
    Buffer.from(attestation.signature.value, "base64url"),
  );
}

export function assertM3HumanSignoffsAuthorizeBundle(
  bundle: M3ApprovedPolicyBundle,
  value: M3HumanSignoffs,
) {
  const expected = HumanSignoffsSchema.parse(value);
  if (
    commandFingerprint(bundle.releaseCandidate) !== commandFingerprint(expected.candidate)
  ) {
    throw new Error("M3 policy bundle does not match human-signoffs release candidate");
  }
  const policyContentFingerprint = m3PolicyContentFingerprint(bundle);
  if (policyContentFingerprint !== expected.policyContentFingerprint) {
    throw new Error("M3 policy bundle content does not match human-signoffs policy fingerprint");
  }
  const contracts = {
    financeAccounting: { packet: "finance.md", attestation: bundle.attestations.finance },
    legalPrivacy: { packet: "privacy.md", attestation: bundle.attestations.legalPrivacy },
    ritualOperationsSme: { packet: "ritual-rules.md", attestation: bundle.attestations.ritualSme },
  };
  const attestationFingerprints: Record<string, string> = {};
  for (const [key, contract] of Object.entries(contracts)) {
    const gate = expected.gates[key as keyof typeof expected.gates];
    if (gate.status !== "PASS") throw new Error(`M3 ${key} human verdict is not PASS`);
    if (gate.packet !== contract.packet) throw new Error(`M3 ${key} human-signoffs packet is invalid`);
    const attestation = contract.attestation;
    const fingerprint = m3AttestationFingerprint(attestation);
    if (
      gate.attestationFingerprint !== fingerprint
      || commandFingerprint(gate.attestation) !== fingerprint
    ) {
      throw new Error(`M3 ${key} human-signoffs attestation does not match approved policy bundle`);
    }
    attestationFingerprints[key] = fingerprint;
  }
  return {
    bundleFingerprint: m3PolicyBundleFingerprint(bundle),
    policyContentFingerprint,
    attestationFingerprints,
  };
}

export async function applyM3ApprovedPolicyBundle(
  tx: Prisma.TransactionClient,
  bundle: M3ApprovedPolicyBundle,
  humanSignoffs: M3HumanSignoffs,
) {
  assertM3HumanSignoffsAuthorizeBundle(bundle, humanSignoffs);
  const fingerprint = commandFingerprint(bundle);
  await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${bundle.organizationId} FOR UPDATE`;
  const [organization, approver] = await Promise.all([
    tx.organization.findFirst({ where: { id: bundle.organizationId, status: "ACTIVE" }, select: { id: true } }),
    tx.user.findFirst({ where: { id: bundle.approvedByUserId, platformRole: "SUPER_ADMIN" }, select: { id: true } }),
  ]);
  if (!organization) throw new OperationalCommandError(404, "Активная организация не найдена");
  if (!approver) throw new OperationalCommandError(403, "Утверждающий Platform SUPER_ADMIN не найден");
  await verifyRegisteredHumanApprovals(tx, bundle);

  const replay = await tx.platformAuditEvent.findFirst({
    where: { action: "M3_POLICIES_ACTIVATED", targetType: "organization", targetId: bundle.organizationId },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
  });
  if (metadataFingerprint(replay?.metadata) === fingerprint) {
    return { replayed: true, bundleFingerprint: fingerprint };
  }

  const documentTypeIdsByCode = new Map<string, string>();
  for (const item of bundle.documentTypes) {
    const existing = await tx.documentTypeDefinition.findUnique({
      where: {
        organizationId_code_version: {
          organizationId: bundle.organizationId,
          code: item.code,
          version: item.version,
        },
      },
    });
    const expected = {
      organizationId: bundle.organizationId,
      code: item.code,
      version: item.version,
      name: item.name,
      description: item.description,
      allowedMimeTypes: item.allowedMimeTypes,
      maxBytes: item.maxBytes,
      status: "APPROVED" as const,
      source: item.source,
    };
    if (existing) {
      assertExactPolicy(existing, expected, `Document type ${item.code} v${item.version}`);
      documentTypeIdsByCode.set(item.code, existing.id);
    } else {
      await tx.documentTypeDefinition.updateMany({
        where: { organizationId: bundle.organizationId, code: item.code, status: "APPROVED" },
        data: { status: "RETIRED" },
      });
      const created = await tx.documentTypeDefinition.create({
        data: { ...expected, allowedMimeTypes: prismaJson(item.allowedMimeTypes) },
        select: { id: true },
      });
      documentTypeIdsByCode.set(item.code, created.id);
    }
  }

  for (const policy of bundle.documentPolicies) {
    const rulesWithPinnedTypes = policy.rules.map((rule) => ({
      ...rule,
      acceptedDocumentTypeVersionIds: rule.acceptedDocumentTypeCodes.map((code) => {
        const id = documentTypeIdsByCode.get(code);
        if (!id) throw new OperationalCommandError(409, `Document type ${code} is not pinned for organization`);
        return id;
      }),
    }));
    const existing = await tx.documentRequirementPolicy.findUnique({
      where: {
        organizationId_scenario_version: {
          organizationId: bundle.organizationId,
          scenario: policy.scenario as CaseScenario,
          version: policy.version,
        },
      },
      include: { rules: { orderBy: { stableKey: "asc" } } },
    });
    const policyExpected = {
      organizationId: bundle.organizationId,
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
      const expectedRules = rulesWithPinnedTypes.map(ruleSnapshot).sort(compareStableKey);
      if (commandFingerprint(existingRules) !== commandFingerprint(expectedRules)) {
        throw new OperationalCommandError(409, `${policy.scenario} policy content conflicts with approved bundle`);
      }
    } else {
      await tx.documentRequirementPolicy.updateMany({
        where: {
          organizationId: bundle.organizationId,
          scenario: policy.scenario as CaseScenario,
          status: "APPROVED",
        },
        data: { status: "RETIRED", retiredAt: new Date(bundle.approvedAt) },
      });
      await tx.documentRequirementPolicy.create({
        data: {
          ...policyExpected,
          scenario: policy.scenario as CaseScenario,
          rules: {
            create: rulesWithPinnedTypes.map((rule) => ({
              ...rule,
              ownerRole: rule.ownerRole as MembershipRole,
              acceptedDocumentTypeCodes: prismaJson(rule.acceptedDocumentTypeCodes),
              acceptedDocumentTypeVersionIds: prismaJson(rule.acceptedDocumentTypeVersionIds),
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
      releasePreviewUrl: bundle.releaseCandidate.previewUrl,
      releaseDeploymentId: bundle.releaseCandidate.deploymentId,
      releaseDeploymentSha: bundle.releaseCandidate.deploymentSha,
      releaseImplementationSha: bundle.releaseCandidate.implementationSha,
      releaseDatabaseFingerprint: bundle.releaseCandidate.databaseFingerprint,
      policyCount: bundle.documentPolicies.length + 2,
      typeCount: bundle.documentTypes.length,
      attestations: {
        finance: attestationAuditSummary(bundle.attestations.finance),
        legalPrivacy: attestationAuditSummary(bundle.attestations.legalPrivacy),
        ritualSme: attestationAuditSummary(bundle.attestations.ritualSme),
      },
      effectiveFrom: bundle.effectiveFrom,
    },
  });
  return { replayed: false, bundleFingerprint: fingerprint };
}

export async function activateM3ApprovedPoliciesAndMaterializeExistingCases(
  tx: Prisma.TransactionClient,
  bundle: M3ApprovedPolicyBundle,
  humanSignoffs: M3HumanSignoffs,
  commandRunId: string,
  now = new Date(),
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(commandRunId)) {
    throw new OperationalCommandError(400, "Некорректный идентификатор запуска M3 policy activation");
  }
  const activation = await applyM3ApprovedPolicyBundle(tx, bundle, humanSignoffs);
  const cases = await tx.case.findMany({
    where: {
      tenantId: bundle.organizationId,
      scenarioId: { in: ["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"] },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      scenarioId: true,
      _count: { select: { documentRequirements: true } },
    },
  });
  const materialization = {
    casesExamined: cases.length,
    casesMaterialized: 0,
    casesPinnedToExistingPolicy: 0,
    casesDeferredUntilPolicyEffective: 0,
    requirementsCreated: 0,
    requirementsExisting: 0,
  };
  for (const record of cases) {
    if (record._count.documentRequirements > 0) {
      const parity = await checkCaseRequirementMaterializationParity(
        tx,
        bundle.organizationId,
        record.id,
        record.scenarioId,
      );
      if (!parity.ok) {
        throw new OperationalCommandError(409, `Existing Case ${record.id} requirement policy parity failed: ${parity.reason}`);
      }
      materialization.casesPinnedToExistingPolicy += 1;
      materialization.requirementsExisting += record._count.documentRequirements;
      continue;
    }
    const result = await materializeCaseRequirementsInTransaction(
      tx,
      {
        organizationId: bundle.organizationId,
        membershipId: null,
        actorType: "platform-policy-operator",
      },
      record.id,
      record.scenarioId,
      {
        idempotencyKey: `m3-policy-materialize:${commandRunId}:${record.id}`,
        correlationId: `m3-policy-activation:${commandRunId}`,
        reason: "Materialize approved M3 requirements for an existing case",
      },
      now,
    );
    if (!result.policyApproved) {
      materialization.casesDeferredUntilPolicyEffective += 1;
      continue;
    }
    materialization.casesMaterialized += 1;
    materialization.requirementsCreated += result.created;
    materialization.requirementsExisting += result.existing;
  }
  return { ...activation, materialization };
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
    acceptedDocumentTypeVersionIds: rule.acceptedDocumentTypeVersionIds,
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

function assertAttestationContract(bundle: M3ApprovedPolicyBundle) {
  const contracts = [
    ["finance", "FINANCE_ACCOUNTING", M3_HUMAN_ATTESTATION_CHECKLISTS.finance],
    ["legalPrivacy", "LEGAL_PRIVACY", M3_HUMAN_ATTESTATION_CHECKLISTS.legalPrivacy],
    ["ritualSme", "RITUAL_OPERATIONS_SME", M3_HUMAN_ATTESTATION_CHECKLISTS.ritualSme],
  ] as const;
  const approvedAt = new Date(bundle.approvedAt).getTime();
  const attestations = Object.values(bundle.attestations);
  assertUnique(attestations.map((item) => normalizeReviewerIdentity(item.reviewer.id)), "human attestation reviewer");
  assertUnique(attestations.map((item) => normalizeReviewerIdentity(item.reviewer.name)), "human attestation reviewer name");
  assertUnique(attestations.map((item) => item.reviewer.credentialReference), "human attestation credential");
  assertUnique(attestations.map((item) => item.signature.keyFingerprint), "human attestation signing key");
  const policyContentFingerprint = m3PolicyContentFingerprint(bundle);
  for (const [key, reviewerRole, requiredChecklist] of contracts) {
    const attestation = bundle.attestations[key];
    if (attestation.reviewer.role !== reviewerRole) {
      throw new Error(`${key} attestation reviewer role must be ${reviewerRole}`);
    }
    if (reviewerRole === "RITUAL_OPERATIONS_SME" && attestation.reviewer.experienceYears === null) {
      throw new Error("ritualSme attestation requires reviewer experienceYears");
    }
    if (
      attestation.reviewedPreviewUrl !== bundle.releaseCandidate.previewUrl
      || attestation.reviewedDeploymentId !== bundle.releaseCandidate.deploymentId
      || attestation.reviewedDeploymentSha !== bundle.releaseCandidate.deploymentSha
      || attestation.reviewedImplementationSha !== bundle.releaseCandidate.implementationSha
      || attestation.reviewedDatabaseFingerprint !== bundle.releaseCandidate.databaseFingerprint
      || attestation.reviewedPolicyContentFingerprint !== policyContentFingerprint
    ) {
      throw new Error(`${key} attestation must match the exact reviewed release candidate`);
    }
    const keyFingerprint = m3ReviewerPublicKeyFingerprint(attestation.signature.publicKeyPem);
    if (
      keyFingerprint !== attestation.signature.keyFingerprint
      || attestation.reviewer.credentialReference !== `platform-audit-key:${keyFingerprint}`
    ) {
      throw new Error(`${key} attestation signing key does not match reviewer credential reference`);
    }
    if (new Date(attestation.date).getTime() > approvedAt) {
      throw new Error(`${key} attestation cannot postdate policy approval`);
    }
    const answerIds = attestation.checklistAnswers.map((answer) => answer.id);
    assertUnique(answerIds, `${key} attestation checklist answer`);
    const actual = [...answerIds].sort();
    const expected = [...requiredChecklist].sort();
    if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
      throw new Error(`${key} attestation must answer the exact required M3 checklist`);
    }
    if (!verifyM3AttestationSignature(attestation)) {
      throw new Error(`${key} attestation signature is invalid`);
    }
  }
}

async function verifyRegisteredHumanApprovals(
  tx: Prisma.TransactionClient,
  bundle: M3ApprovedPolicyBundle,
) {
  for (const [key, attestation] of Object.entries(bundle.attestations)) {
    try {
      await requireActiveM3ReviewerCredential(tx, {
        reviewerId: attestation.reviewer.id,
        reviewerName: attestation.reviewer.name,
        reviewerRole: attestation.reviewer.role,
        publicKeyPem: attestation.signature.publicKeyPem,
        keyFingerprint: attestation.signature.keyFingerprint,
      });
    } catch (error) {
      if (error instanceof OperationalCommandError) {
        throw new OperationalCommandError(error.status, `${key} ${error.message}`);
      }
      throw error;
    }
  }
}

function normalizeReviewerIdentity(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function attestationAuditSummary(attestation: M3ApprovedPolicyBundle["attestations"][keyof M3ApprovedPolicyBundle["attestations"]]) {
  return {
    verdict: attestation.verdict,
    reviewerId: attestation.reviewer.id,
    reviewerName: attestation.reviewer.name,
    reviewerRole: attestation.reviewer.role,
    reviewerCredentialReferenceFingerprint: commandFingerprint(attestation.reviewer.credentialReference),
    reviewerKeyFingerprint: attestation.signature.keyFingerprint,
    reviewerExperienceYears: attestation.reviewer.experienceYears,
    reviewedAt: attestation.date,
    reviewedPreviewUrl: attestation.reviewedPreviewUrl,
    reviewedDeploymentId: attestation.reviewedDeploymentId,
    reviewedDeploymentSha: attestation.reviewedDeploymentSha,
    reviewedImplementationSha: attestation.reviewedImplementationSha,
    reviewedDatabaseFingerprint: attestation.reviewedDatabaseFingerprint,
    reviewedPolicyContentFingerprint: attestation.reviewedPolicyContentFingerprint,
    checklistResults: attestation.checklistAnswers.map(({ id, verdict }) => ({ id, verdict })),
    scenarioResults: {
      cremation: attestation.scenarioResults.cremation.verdict,
      burial: attestation.scenarioResults.familyPlotBurial.verdict,
    },
    sourceFingerprint: commandFingerprint(attestation.source),
    attestationFingerprint: commandFingerprint(attestation),
  };
}
