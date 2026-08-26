import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as financeWorkspace } from "../../app/api/agent/finance/route";
import { POST as login } from "../../app/api/agent/auth/login/route";
import {
  M3_HUMAN_ATTESTATION_CHECKLISTS,
  activateM3ApprovedPoliciesAndMaterializeExistingCases,
  applyM3ApprovedPolicyBundle,
  m3AttestationFingerprint,
  m3PolicyBundleFingerprint,
  parseM3ApprovedPolicyBundle,
  type M3ApprovedPolicyBundle,
} from "../../lib/m3PolicyActivation";
import { checkCaseRequirementMaterializationParity } from "../../lib/documentRequirementService";
import { hashPassword } from "../../lib/password";
import {
  encryptPlatformMfaSecret,
  generatePlatformMfaSecret,
  totp,
} from "../../lib/platformMfa";
import {
  createFixtureContext,
  db,
  makeRequest,
  skip,
} from "./_setup";

const opts = { skip: skip ? "set TEST_DATABASE_URL + ALLOW_DB_TESTS=1" : false };
const ACTIVATION_POLICY_VERSION = 3_000_002;

test("M3 approved policy activation is human-attested, idempotent and retires prior versions", opts, async () => {
  const fixtures = createFixtureContext("m3-policy-activation");
  try {
    const organizationId = await fixtures.makeOrganization("approved-policy");
    const otherOrganizationId = await fixtures.makeOrganization("other-approved-policy");
    const approver = await db.user.findUniqueOrThrow({
      where: { email: "m3-policy-approver@synthetic.invalid" },
      select: { id: true },
    });

    // Exercise immutable activation inside one rollback-only transaction. Identical
    // policy codes in a second tenant must not retire or rewrite the first tenant.
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: approver.id }, data: { platformRole: "SUPER_ADMIN" } });
      const firstBundle = baselinePolicyBundle(organizationId, approver.id);
      const first = await applyM3ApprovedPolicyBundle(tx, firstBundle, approvalExpectation(firstBundle));
      const replay = await applyM3ApprovedPolicyBundle(tx, firstBundle, approvalExpectation(firstBundle));
      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.bundleFingerprint, first.bundleFingerprint);
      assert.equal(await tx.platformAuditEvent.count({
        where: { actorUserId: approver.id, action: "M3_POLICIES_ACTIVATED" },
      }), 1);
      const activationAudit = await tx.platformAuditEvent.findFirstOrThrow({
        where: {
          actorUserId: approver.id,
          action: "M3_POLICIES_ACTIVATED",
          targetId: organizationId,
        },
        select: { metadata: true },
      });
      const auditMetadata = activationAudit.metadata as Record<string, unknown>;
      assert.equal(auditMetadata.releaseDeploymentId, firstBundle.releaseCandidate.deploymentId);
      assert.equal(auditMetadata.releaseImplementationSha, firstBundle.releaseCandidate.implementationSha);
      assert.equal(auditMetadata.releaseDatabaseFingerprint, firstBundle.releaseCandidate.databaseFingerprint);
      assert.equal(JSON.stringify(auditMetadata).includes("Synthetic checklist result"), false);
      assert.equal(JSON.stringify(auditMetadata).includes("Synthetic human verdict fixture"), false);
      assert.match(JSON.stringify(auditMetadata), /FINANCE_ACCOUNTING/);
      assert.match(JSON.stringify(auditMetadata), /entry-policy/);
      assert.equal(await tx.contractSigningPolicy.count({ where: { organizationId, status: "APPROVED" } }), 1);
      assert.equal(await tx.financialControlPolicy.count({ where: { organizationId, status: "APPROVED" } }), 1);

      const otherBundle = baselinePolicyBundle(otherOrganizationId, approver.id);
      const other = await applyM3ApprovedPolicyBundle(tx, otherBundle, approvalExpectation(otherBundle));
      assert.equal(other.replayed, false);
      assert.equal(await tx.documentRequirementPolicy.count({
        where: { organizationId, status: "APPROVED", retiredAt: null },
      }), 2);
      assert.equal(await tx.documentRequirementPolicy.count({
        where: { organizationId: otherOrganizationId, status: "APPROVED", retiredAt: null },
      }), 2);
      assert.equal(await tx.documentTypeDefinition.count({
        where: { organizationId, status: "APPROVED" },
      }), 5);
      assert.equal(await tx.documentTypeDefinition.count({
        where: { organizationId: otherOrganizationId, status: "APPROVED" },
      }), 5);

      const conflictingBundle = {
        ...firstBundle,
        signingPolicy: { ...firstBundle.signingPolicy, source: "Conflicting signed policy content" },
      };
      await assert.rejects(
        applyM3ApprovedPolicyBundle(tx, conflictingBundle, approvalExpectation(conflictingBundle)),
        /conflicts with approved bundle/,
      );
      assert.equal(await tx.platformAuditEvent.count({
        where: {
          actorUserId: approver.id,
          action: "M3_POLICIES_ACTIVATED",
          targetId: organizationId,
        },
      }), 1);
      throw new Error("ROLLBACK_M3_POLICY_ACTIVATION_TEST");
    }, { timeout: 20_000 }), /ROLLBACK_M3_POLICY_ACTIVATION_TEST/);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M3 policy activation materializes requirements for existing pilot cases without duplicates", opts, async () => {
  const fixtures = createFixtureContext("m3-policy-existing-case");
  try {
    const organizationId = await fixtures.makeOrganization("existing-case-policy");
    const owner = await fixtures.makeMember("owner", { organizationId, role: "AGENT" });
    const existingCase = await fixtures.makeCase(owner, "existing-case");
    const laterCase = await fixtures.makeCase(owner, "later-case");
    await db.case.update({ where: { id: existingCase.id }, data: { scenarioId: "CREMATION_V1" } });
    await db.case.update({ where: { id: laterCase.id }, data: { scenarioId: "UNSELECTED" } });
    const approver = await db.user.findUniqueOrThrow({
      where: { email: "m3-policy-approver@synthetic.invalid" },
      select: { id: true },
    });

    await assert.rejects(db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: approver.id }, data: { platformRole: "SUPER_ADMIN" } });
      const bundle = baselinePolicyBundle(organizationId, approver.id);
      const first = await activateM3ApprovedPoliciesAndMaterializeExistingCases(
        tx,
        bundle,
        approvalExpectation(bundle),
        "synthetic-policy-run-0001",
        new Date("2026-08-13T10:00:00.000Z"),
      );
      assert.deepEqual(first.materialization, {
        casesExamined: 1,
        casesMaterialized: 1,
        casesPinnedToExistingPolicy: 0,
        casesDeferredUntilPolicyEffective: 0,
        requirementsCreated: 3,
        requirementsExisting: 0,
      });
      assert.equal(await tx.caseDocumentRequirement.count({ where: { caseId: existingCase.id } }), 3);
      const replay = await activateM3ApprovedPoliciesAndMaterializeExistingCases(
        tx,
        bundle,
        approvalExpectation(bundle),
        "synthetic-policy-run-0002",
        new Date("2026-08-13T10:00:00.000Z"),
      );
      assert.equal(replay.replayed, true);
      assert.equal(replay.materialization.requirementsCreated, 0);
      assert.equal(replay.materialization.requirementsExisting, 3);
      assert.equal(replay.materialization.casesMaterialized, 0);
      assert.equal(replay.materialization.casesPinnedToExistingPolicy, 1);
      assert.equal(await tx.caseDocumentRequirement.count({ where: { caseId: existingCase.id } }), 3);

      await tx.case.update({ where: { id: laterCase.id }, data: { scenarioId: "CREMATION_V1" } });
      const upgradedBundle = parseM3ApprovedPolicyBundle({
        ...bundle,
        approvedAt: "2026-08-13T11:00:00.000Z",
        effectiveFrom: "2026-08-13T11:00:00.000Z",
        documentPolicies: bundle.documentPolicies.map((policy) => ({
          ...policy,
          version: policy.version + 1,
          source: `${policy.source}:UPGRADED`,
        })),
        signingPolicy: {
          ...bundle.signingPolicy,
          version: `${bundle.signingPolicy.version}-v2`,
        },
        financialPolicy: {
          ...bundle.financialPolicy,
          version: bundle.financialPolicy.version + 1,
        },
      });
      const upgrade = await activateM3ApprovedPoliciesAndMaterializeExistingCases(
        tx,
        upgradedBundle,
        approvalExpectation(upgradedBundle),
        "synthetic-policy-run-0003",
        new Date("2026-08-13T11:00:01.000Z"),
      );
      assert.deepEqual(upgrade.materialization, {
        casesExamined: 2,
        casesMaterialized: 1,
        casesPinnedToExistingPolicy: 1,
        casesDeferredUntilPolicyEffective: 0,
        requirementsCreated: 3,
        requirementsExisting: 3,
      });
      const [existingRequirements, laterRequirements] = await Promise.all([
        tx.caseDocumentRequirement.findMany({ where: { caseId: existingCase.id }, select: { policyVersion: true } }),
        tx.caseDocumentRequirement.findMany({ where: { caseId: laterCase.id }, select: { policyVersion: true } }),
      ]);
      assert.deepEqual([...new Set(existingRequirements.map((item) => item.policyVersion))], [ACTIVATION_POLICY_VERSION]);
      assert.deepEqual([...new Set(laterRequirements.map((item) => item.policyVersion))], [ACTIVATION_POLICY_VERSION + 1]);
      assert.equal(existingRequirements.length, 3);
      assert.equal(laterRequirements.length, 3);
      assert.equal((await checkCaseRequirementMaterializationParity(
        tx, organizationId, existingCase.id, "CREMATION_V1",
      )).ok, true);
      assert.equal((await checkCaseRequirementMaterializationParity(
        tx, organizationId, laterCase.id, "CREMATION_V1",
      )).ok, true);

      const upgradeReplay = await activateM3ApprovedPoliciesAndMaterializeExistingCases(
        tx,
        upgradedBundle,
        approvalExpectation(upgradedBundle),
        "synthetic-policy-run-0004",
        new Date("2026-08-13T11:00:01.000Z"),
      );
      assert.equal(upgradeReplay.replayed, true);
      assert.equal(upgradeReplay.materialization.casesMaterialized, 0);
      assert.equal(upgradeReplay.materialization.casesPinnedToExistingPolicy, 2);
      assert.equal(upgradeReplay.materialization.requirementsCreated, 0);
      assert.equal(upgradeReplay.materialization.requirementsExisting, 6);
      assert.equal(await tx.caseDocumentRequirement.count({
        where: { caseId: { in: [existingCase.id, laterCase.id] } },
      }), 6);
      assert.equal(await tx.operationalAuditEvent.count({
        where: {
          organizationId,
          entityId: existingCase.id,
          action: "document_requirements.materialized.v1",
          actorType: "platform-policy-operator",
        },
      }), 1);
      assert.equal(await tx.operationalAuditEvent.count({
        where: {
          organizationId,
          entityId: laterCase.id,
          action: "document_requirements.materialized.v1",
          actorType: "platform-policy-operator",
        },
      }), 1);
      throw new Error("ROLLBACK_M3_EXISTING_CASE_POLICY_TEST");
    }, { timeout: 20_000 }), /ROLLBACK_M3_EXISTING_CASE_POLICY_TEST/);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

test("M3 Finance login and API require current-session TOTP verification", opts, async () => {
  const fixtures = createFixtureContext("m3-finance-mfa");
  const password = "M3-Synthetic-Finance-Password-42!";
  const secret = generatePlatformMfaSecret();
  try {
    const finance = await fixtures.makeMember("finance", { role: "FINANCE" });
    const email = (await db.user.findUniqueOrThrow({ where: { id: finance.userId }, select: { email: true } })).email!;
    await db.user.update({
      where: { id: finance.userId },
      data: { passwordHash: hashPassword(password) },
    });

    const setupLogin = await login(makeRequest("/api/agent/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.30.1" },
      body: { email, password },
    }));
    assert.equal(setupLogin.status, 200);
    assert.equal((await setupLogin.clone().json()).redirectTo, "/setup/platform-admin-mfa");
    const unverifiedCookie = setupLogin.headers.get("set-cookie")?.split(";")[0];
    assert.ok(unverifiedCookie);
    assert.equal((await financeWorkspace(makeRequest("/api/agent/finance", { cookie: unverifiedCookie }))).status, 403);

    await db.user.update({
      where: { id: finance.userId },
      data: {
        platformMfaSecretEncrypted: encryptPlatformMfaSecret(secret),
        platformMfaEnabledAt: new Date(),
      },
    });
    const challenge = await login(makeRequest("/api/agent/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.30.2" },
      body: { email, password },
    }));
    assert.equal(challenge.status, 200);
    assert.equal((await challenge.json()).mfaRequired, true);
    assert.equal(challenge.headers.get("set-cookie"), null);

    const authenticated = await login(makeRequest("/api/agent/auth/login", {
      method: "POST",
      headers: { "x-forwarded-for": "127.0.30.3" },
      body: { email, password, mfaCode: totp(secret) },
    }));
    assert.equal(authenticated.status, 200);
    assert.equal((await authenticated.clone().json()).redirectTo, "/agent/finance");
    const cookie = authenticated.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    assert.equal((await financeWorkspace(makeRequest("/api/agent/finance", { cookie }))).status, 200);
    assert.equal((await financeWorkspace(makeRequest("/api/agent/finance", { cookie: unverifiedCookie }))).status, 403);
  } finally {
    await fixtures.cleanup();
    await fixtures.assertNoResidue();
  }
});

function baselinePolicyBundle(
  organizationId: string,
  approvedByUserId: number,
): M3ApprovedPolicyBundle {
  const releaseCandidate = {
    previewUrl: "https://td-agent-synthetic-review.vercel.app/",
    deploymentId: "dpl_M3SyntheticReviewerEvidence12345",
    implementationSha: "a".repeat(40),
    databaseFingerprint: "1".repeat(16),
  };
  const typeCodes = {
    identity: "M3_IT_IDENTITY_V1",
    death: "M3_IT_DEATH_RECORD_V1",
    cremation: "M3_IT_CREMATION_V1",
    burialPlot: "M3_IT_BURIAL_PLOT_V1",
    relationship: "M3_IT_RELATIONSHIP_V1",
  };
  return parseM3ApprovedPolicyBundle({
    schemaVersion: 3,
    releaseCandidate,
    organizationId,
    approvedByUserId,
    approvedAt: "2026-08-11T00:00:00.000Z",
    effectiveFrom: "2026-08-11T00:00:00.000Z",
    attestations: {
      finance: humanAttestation(
        "FINANCE_ACCOUNTING",
        M3_HUMAN_ATTESTATION_CHECKLISTS.finance,
        releaseCandidate,
      ),
      legalPrivacy: humanAttestation(
        "LEGAL_PRIVACY",
        M3_HUMAN_ATTESTATION_CHECKLISTS.legalPrivacy,
        releaseCandidate,
      ),
      ritualSme: humanAttestation(
        "RITUAL_OPERATIONS_SME",
        M3_HUMAN_ATTESTATION_CHECKLISTS.ritualSme,
        releaseCandidate,
      ),
    },
    documentTypes: [
      {
        code: typeCodes.identity,
        version: 1,
        name: "Synthetic identity evidence",
        description: null,
        allowedMimeTypes: ["application/pdf"],
        maxBytes: 1_000_000,
        source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
      },
      {
        code: typeCodes.death,
        version: 1,
        name: "Synthetic death-record evidence",
        description: null,
        allowedMimeTypes: ["application/pdf"],
        maxBytes: 1_000_000,
        source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
      },
      documentType(typeCodes.cremation, "Synthetic cremation evidence"),
      documentType(typeCodes.burialPlot, "Synthetic burial-plot evidence"),
      documentType(typeCodes.relationship, "Synthetic relationship evidence"),
    ],
    documentPolicies: [
      {
        scenario: "CREMATION_V1",
        version: ACTIVATION_POLICY_VERSION,
        source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
        rules: [
          rule("identity-record", typeCodes.identity, "identity-match"),
          rule("death-record", typeCodes.death, "death-record-match"),
          rule("cremation-authorization", typeCodes.cremation, "scenario-evidence"),
        ],
      },
      {
        scenario: "FAMILY_PLOT_BURIAL_V1",
        version: ACTIVATION_POLICY_VERSION,
        source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
        rules: [
          rule("identity-record", typeCodes.identity, "identity-match"),
          rule("death-record", typeCodes.death, "death-record-match"),
          rule("plot-entitlement", typeCodes.burialPlot, "plot-evidence"),
          rule("relationship-evidence", typeCodes.relationship, "relationship-match"),
        ],
      },
    ],
    signingPolicy: {
      version: "synthetic-legal-baseline",
      allowedEvidenceTypes: ["SYNTHETIC_ACK"],
      source: "Synthetic legal policy",
    },
    financialPolicy: {
      version: 1,
      correctionThresholdKopecks: 10_000,
      source: "Synthetic finance policy",
    },
  });
}

function humanAttestation(
  role: "FINANCE_ACCOUNTING" | "LEGAL_PRIVACY" | "RITUAL_OPERATIONS_SME",
  checklistIds: readonly string[],
  releaseCandidate: {
    previewUrl: string;
    deploymentId: string;
    implementationSha: string;
    databaseFingerprint: string;
  },
) {
  return {
    verdict: "PASS" as const,
    reviewer: {
      id: `synthetic-${role.toLowerCase()}-reviewer`,
      name: `Synthetic ${role} reviewer`,
      role,
      credentialReference: `synthetic-reviewer-registry:${role}`,
      experienceYears: role === "RITUAL_OPERATIONS_SME" ? 10 : null,
    },
    source: "Synthetic human verdict fixture",
    date: "2026-08-10T23:00:00.000Z",
    reviewedPreviewUrl: releaseCandidate.previewUrl,
    reviewedDeploymentId: releaseCandidate.deploymentId,
    reviewedImplementationSha: releaseCandidate.implementationSha,
    reviewedDatabaseFingerprint: releaseCandidate.databaseFingerprint,
    checklistAnswers: checklistIds.map((id) => ({
      id,
      verdict: "PASS" as const,
      notes: "Synthetic checklist result",
    })),
    scenarioResults: {
      cremation: { verdict: "PASS" as const, notes: "Synthetic cremation result" },
      familyPlotBurial: { verdict: "PASS" as const, notes: "Synthetic burial result" },
    },
  };
}

function approvalExpectation(bundle: M3ApprovedPolicyBundle) {
  return {
    previewUrl: bundle.releaseCandidate.previewUrl,
    deploymentId: bundle.releaseCandidate.deploymentId,
    implementationSha: bundle.releaseCandidate.implementationSha,
    databaseFingerprint: bundle.releaseCandidate.databaseFingerprint,
    bundleFingerprint: m3PolicyBundleFingerprint(bundle),
    financeAttestationFingerprint: m3AttestationFingerprint(bundle.attestations.finance),
    legalPrivacyAttestationFingerprint: m3AttestationFingerprint(bundle.attestations.legalPrivacy),
    ritualSmeAttestationFingerprint: m3AttestationFingerprint(bundle.attestations.ritualSme),
  };
}

function documentType(code: string, name: string) {
  return {
    code,
    version: 1,
    name,
    description: null,
    allowedMimeTypes: ["application/pdf"],
    maxBytes: 1_000_000,
    source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
  };
}

function rule(stableKey: string, documentTypeCode: string, checklist: string) {
  return {
    stableKey,
    kind: "REQUIRED",
    conditionKey: null,
    conditionExplanation: null,
    dueOffsetHours: null,
    ownerRole: "DOCUMENT_REVIEWER",
    blockingStage: "EXECUTION",
    acceptedDocumentTypeCodes: [documentTypeCode],
    reviewChecklist: [checklist],
    source: "SYNTHETIC_INTEGRATION_BASELINE_NOT_A_HUMAN_VERDICT",
  };
}
