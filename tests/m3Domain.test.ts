import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  assertLedgerAdjustmentForestCapacity,
  deriveCaseDocumentTruth,
  deriveLedgerSummary,
  evaluateDocumentRequirement,
  evaluateFulfilmentGuards,
  getDraftScenarioRequirementBlueprints,
  remainingRefundableKopecks,
  remainingSourceCapacityKopecks,
  requiresFourEyesApproval,
  type LedgerProjectionEntry,
} from "../lib/m3Domain";
import { getDocumentScanner } from "../lib/documentScanner";
import {
  M3_HUMAN_ATTESTATION_CHECKLISTS,
  assertM3HumanSignoffsAuthorizeBundle,
  m3AttestationSigningPayload,
  m3AttestationFingerprint,
  m3PolicyContentFingerprint,
  m3ReviewerPublicKeyFingerprint,
  parseM3ApprovedPolicyBundle,
} from "../lib/m3PolicyActivation";
import { commandFingerprint } from "../lib/m3Command";

test("M3-W7: an uploaded or quarantined file never satisfies a requirement", () => {
  const uploaded = evaluateDocumentRequirement([
    { versionNumber: 1, status: "UPLOADED", scanStatus: "PENDING", expiresAt: null },
  ], new Date("2026-08-11T12:00:00Z"));
  assert.deepEqual(uploaded, { status: "NOT_SATISFIED", verifiedVersionNumber: null });

  const quarantined = evaluateDocumentRequirement([
    { versionNumber: 1, status: "QUARANTINED", scanStatus: "PENDING", expiresAt: null },
  ], new Date("2026-08-11T12:00:00Z"));
  assert.deepEqual(quarantined, { status: "NOT_SATISFIED", verifiedVersionNumber: null });
});

test("M3-W7: only the latest clean verified version satisfies the requirement", () => {
  const verified = evaluateDocumentRequirement([
    { versionNumber: 1, status: "REJECTED", scanStatus: "CLEAN", expiresAt: null },
    { versionNumber: 2, status: "VERIFIED", scanStatus: "CLEAN", expiresAt: new Date("2026-09-01T00:00:00Z") },
  ], new Date("2026-08-11T12:00:00Z"));
  assert.deepEqual(verified, { status: "SATISFIED", verifiedVersionNumber: 2 });

  const supersededByRejected = evaluateDocumentRequirement([
    { versionNumber: 2, status: "VERIFIED", scanStatus: "CLEAN", expiresAt: null },
    { versionNumber: 3, status: "REJECTED", scanStatus: "CLEAN", expiresAt: null },
  ], new Date("2026-08-11T12:00:00Z"));
  assert.deepEqual(supersededByRejected, { status: "NOT_SATISFIED", verifiedVersionNumber: null });
});

test("M3-W7: case document truth projects materialized requirements without mutable policy lookups", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  const truth = deriveCaseDocumentTruth([
    {
      stableKey: "identity-record",
      blockingStage: "EXECUTION",
      versions: [{ versionNumber: 1, status: "VERIFIED", scanStatus: "CLEAN", expiresAt: null }],
    },
    {
      stableKey: "death-record",
      blockingStage: "EXECUTION",
      versions: [{ versionNumber: 1, status: "VERIFIED", scanStatus: "CLEAN", expiresAt: new Date("2026-08-12T00:00:00Z") }],
    },
    {
      stableKey: "cremation-authorization",
      blockingStage: "EXECUTION",
      versions: [{ versionNumber: 1, status: "UPLOADED", scanStatus: "CLEAN", expiresAt: null }],
    },
  ], now);

  assert.deepEqual(truth, {
    required: 3,
    uploaded: 3,
    verified: 2,
    ready: false,
    readyForExecution: false,
    guardState: {
      identity_verified: true,
      death_document_verified: true,
      cremation_authorization_verified: false,
      plot_entitlement_verified: false,
      relationship_verified: false,
    },
  });
});

test("M3-W7: an expired latest version fails case document truth closed", () => {
  const truth = deriveCaseDocumentTruth([{
    stableKey: "death-record",
    blockingStage: "EXECUTION",
    versions: [{
      versionNumber: 2,
      status: "VERIFIED",
      scanStatus: "CLEAN",
      expiresAt: new Date("2026-08-11T11:59:59Z"),
    }],
  }], new Date("2026-08-11T12:00:00Z"));

  assert.equal(truth.ready, false);
  assert.equal(truth.readyForExecution, false);
  assert.equal(truth.verified, 0);
  assert.equal(truth.guardState.death_document_verified, false);
});

test("M3-W7: cremation and family-plot draft policies are explicitly different and unapproved", () => {
  const cremation = getDraftScenarioRequirementBlueprints("CREMATION_V1");
  const burial = getDraftScenarioRequirementBlueprints("FAMILY_PLOT_BURIAL_V1");
  assert.equal(cremation.every((rule) => rule.policyStatus === "DRAFT_POLICY"), true);
  assert.equal(burial.every((rule) => rule.policyStatus === "DRAFT_POLICY"), true);
  assert.notDeepEqual(cremation.map((rule) => rule.stableKey), burial.map((rule) => rule.stableKey));
  assert.equal(cremation.some((rule) => rule.stableKey === "cremation-authorization"), true);
  assert.equal(burial.some((rule) => rule.stableKey === "plot-entitlement"), true);
});

test("M3-W6: 88,000 of a 176,000 obligation is PARTIALLY_PAID with 88,000 balance", () => {
  const entries: LedgerProjectionEntry[] = [
    { id: "obligation", type: "OBLIGATION", direction: "DEBIT", amountKopecks: 17_600_000, effective: true },
    { id: "payment", type: "PAYMENT", direction: "CREDIT", amountKopecks: 8_800_000, effective: true },
  ];
  assert.deepEqual(deriveLedgerSummary(entries, "RUB"), {
    state: "KNOWN",
    status: "PARTIALLY_PAID",
    currency: "RUB",
    obligationKopecks: 17_600_000,
    paidKopecks: 8_800_000,
    refundedKopecks: 0,
    balanceKopecks: 8_800_000,
  });
});

test("M3-W6: unknown obligation remains unknown instead of becoming zero", () => {
  assert.deepEqual(deriveLedgerSummary([], "RUB"), {
    state: "LEGACY_INCOMPLETE",
    status: null,
    currency: "RUB",
    obligationKopecks: null,
    paidKopecks: null,
    refundedKopecks: null,
    balanceKopecks: null,
  });
});

test("M3-W6: refunds and reversals preserve immutable source entries and affect the derived balance", () => {
  const entries: LedgerProjectionEntry[] = [
    { id: "o", type: "OBLIGATION", direction: "DEBIT", amountKopecks: 10_000, effective: true },
    { id: "p", type: "PAYMENT", direction: "CREDIT", amountKopecks: 10_000, effective: true },
    { id: "r", type: "REFUND", direction: "DEBIT", amountKopecks: 2_500, effective: true, relatedEntryId: "p" },
    { id: "rv", type: "REVERSAL", direction: "CREDIT", amountKopecks: 2_500, effective: true, relatedEntryId: "r" },
  ];
  const projection = deriveLedgerSummary(entries, "RUB");
  assert.equal(projection.status, "PAID");
  assert.equal(projection.paidKopecks, 10_000);
  assert.equal(projection.refundedKopecks, 0);
  assert.equal(projection.balanceKopecks, 0);
  assert.deepEqual(entries.map((entry) => entry.id), ["o", "p", "r", "rv"]);
});

test("M3-W6: partial refund reversal keeps only the effective refund in payment truth", () => {
  const projection = deriveLedgerSummary([
    { id: "o", type: "OBLIGATION", direction: "DEBIT", amountKopecks: 10_000, effective: true },
    { id: "p", type: "PAYMENT", direction: "CREDIT", amountKopecks: 10_000, effective: true },
    { id: "r", type: "REFUND", direction: "DEBIT", amountKopecks: 2_500, effective: true, relatedEntryId: "p" },
    { id: "rv", type: "REVERSAL", direction: "CREDIT", amountKopecks: 1_000, effective: true, relatedEntryId: "r" },
  ], "RUB");
  assert.equal(projection.status, "PARTIALLY_REFUNDED");
  assert.equal(projection.paidKopecks, 8_500);
  assert.equal(projection.refundedKopecks, 1_500);
  assert.equal(projection.balanceKopecks, 1_500);
});

test("M3-W6: an approved refund reversal reopens only the truthful payment refund capacity", () => {
  const entries: LedgerProjectionEntry[] = [
    { id: "o", type: "OBLIGATION", direction: "DEBIT", amountKopecks: 10_000, effective: true },
    { id: "p", type: "PAYMENT", direction: "CREDIT", amountKopecks: 10_000, effective: true },
    { id: "r1", type: "REFUND", direction: "DEBIT", amountKopecks: 10_000, effective: true, relatedEntryId: "p" },
    { id: "rv", type: "REVERSAL", direction: "CREDIT", amountKopecks: 10_000, effective: true, relatedEntryId: "r1" },
  ];
  assert.equal(remainingRefundableKopecks(entries, "p"), 10_000);

  entries.push({ id: "r2", type: "REFUND", direction: "DEBIT", amountKopecks: 3_500, effective: true, relatedEntryId: "p" });
  assert.equal(remainingRefundableKopecks(entries, "p"), 6_500);
});

test("M3-W6: refunds and finance adjustments share one immutable source capacity", () => {
  const entries: LedgerProjectionEntry[] = [
    { id: "p", type: "PAYMENT", direction: "CREDIT", amountKopecks: 10_000, effective: true },
    { id: "pending", type: "REVERSAL", direction: "DEBIT", amountKopecks: 2_000, effective: false, reserved: true, relatedEntryId: "p" },
    { id: "refund", type: "REFUND", direction: "DEBIT", amountKopecks: 8_000, effective: true, relatedEntryId: "p" },
  ];
  assert.equal(remainingSourceCapacityKopecks(entries, "p"), 0);
  entries.push({ id: "over", type: "REFUND", direction: "DEBIT", amountKopecks: 1, effective: true, relatedEntryId: "p" });
  assert.throws(() => remainingSourceCapacityKopecks(entries, "p"), /exceed the source entry amount/);
});

test("M3-W6: reversing an adjustment reopens only its outstanding source capacity", () => {
  const entries: LedgerProjectionEntry[] = [
    { id: "p", type: "PAYMENT", direction: "CREDIT", amountKopecks: 10_000, effective: true },
    { id: "correction", type: "CORRECTION", direction: "DEBIT", amountKopecks: 4_000, effective: true, relatedEntryId: "p" },
    { id: "reversal", type: "REVERSAL", direction: "CREDIT", amountKopecks: 1_500, effective: true, relatedEntryId: "correction" },
  ];
  assert.equal(remainingSourceCapacityKopecks(entries, "p"), 7_500);
  assert.equal(remainingSourceCapacityKopecks(entries, "correction"), 2_500);
});

test("M3-W6: nested pending adjustment cannot exceed an immutable ancestor", () => {
  const entries: LedgerProjectionEntry[] = [
    { id: "p", type: "PAYMENT", direction: "CREDIT", amountKopecks: 10_000, effective: true },
    { id: "refund", type: "REFUND", direction: "DEBIT", amountKopecks: 10_000, effective: true, relatedEntryId: "p" },
    { id: "reversal", type: "REVERSAL", direction: "CREDIT", amountKopecks: 10_000, effective: true, relatedEntryId: "refund" },
    {
      id: "nested-pending",
      type: "CORRECTION",
      direction: "CREDIT",
      amountKopecks: 1,
      effective: false,
      reserved: true,
      relatedEntryId: "reversal",
    },
  ];
  assert.equal(remainingSourceCapacityKopecks(entries.slice(0, 3), "reversal"), 10_000);
  assert.throws(
    () => assertLedgerAdjustmentForestCapacity(entries),
    /immutable root amount/,
  );
});

test("M3-W6: refund over-reversal fails closed", () => {
  assert.throws(() => deriveLedgerSummary([
    { id: "o", type: "OBLIGATION", direction: "DEBIT", amountKopecks: 10_000, effective: true },
    { id: "p", type: "PAYMENT", direction: "CREDIT", amountKopecks: 10_000, effective: true },
    { id: "r", type: "REFUND", direction: "DEBIT", amountKopecks: 2_500, effective: true, relatedEntryId: "p" },
    { id: "rv", type: "REVERSAL", direction: "CREDIT", amountKopecks: 2_501, effective: true, relatedEntryId: "r" },
  ], "RUB"), /cannot reverse more than the effective refund amount/);
});

test("M3-W6: missing Finance threshold fails closed into four-eyes approval", () => {
  assert.equal(requiresFourEyesApproval({ type: "CORRECTION", amountKopecks: 1, thresholdKopecks: null }), true);
  assert.equal(requiresFourEyesApproval({ type: "REVERSAL", amountKopecks: 1, thresholdKopecks: null }), true);
  assert.equal(requiresFourEyesApproval({ type: "PAYMENT", amountKopecks: 1, thresholdKopecks: null }), false);
});

test("M3-W6/W7: uploaded document and partial payment both block fulfilment", () => {
  const result = evaluateFulfilmentGuards({
    policyApproved: true,
    requiredDocuments: [{ stableKey: "death-record", status: "NOT_SATISFIED", owner: "DOCUMENT_REVIEWER", dueAt: null }],
    contractStatus: "SIGNED",
    paymentStatus: "PARTIALLY_PAID",
    pendingFinancialAdjustments: 0,
    reconciliationDiscrepancies: 0,
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers.map((blocker) => blocker.code).sort(), ["DOCUMENT_NOT_VERIFIED", "PAYMENT_BALANCE_REMAINS"]);
});

test("M3-W6: ledger projection is deterministic across 100 calculations", () => {
  const entries: LedgerProjectionEntry[] = [
    { id: "o", type: "OBLIGATION", direction: "DEBIT", amountKopecks: 176_000_00, effective: true },
    { id: "p", type: "PAYMENT", direction: "CREDIT", amountKopecks: 88_000_00, effective: true },
  ];
  const snapshots = Array.from({ length: 100 }, () => JSON.stringify(deriveLedgerSummary(entries, "RUB")));
  assert.equal(new Set(snapshots).size, 1);
});

test("M3-W7: synthetic scanner is available only to an explicitly isolated Preview", async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    isolation: process.env.PREVIEW_DB_ISOLATION,
    scanner: process.env.M3_DOCUMENT_SCANNER,
    allowDbTests: process.env.ALLOW_DB_TESTS,
  };
  try {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.VERCEL_ENV = "preview";
    process.env.M3_DOCUMENT_SCANNER = "synthetic-preview";
    process.env.PREVIEW_DB_ISOLATION = "FAIL";
    delete process.env.ALLOW_DB_TESTS;
    assert.equal(getDocumentScanner().isOperational(), false);

    process.env.PREVIEW_DB_ISOLATION = "PASS";
    const scanner = getDocumentScanner();
    assert.equal(scanner.isOperational(), true);
    assert.equal((await scanner.scan({
      storageKey: "synthetic",
      bytes: new TextEncoder().encode("synthetic clean document"),
      checksum: "a".repeat(64),
      mimeType: "application/pdf",
    })).status, "CLEAN");
  } finally {
    restoreEnv("NODE_ENV", previous.nodeEnv);
    restoreEnv("VERCEL_ENV", previous.vercelEnv);
    restoreEnv("PREVIEW_DB_ISOLATION", previous.isolation);
    restoreEnv("M3_DOCUMENT_SCANNER", previous.scanner);
    restoreEnv("ALLOW_DB_TESTS", previous.allowDbTests);
  }
});

test("M3 policy activation accepts only complete human-attested, scenario-distinct bundles", () => {
  const bundle = validPolicyBundle();
  const parsed = parseM3ApprovedPolicyBundle(bundle);
  assert.equal(parsed.documentPolicies.length, 2);
  assert.doesNotThrow(() => assertM3HumanSignoffsAuthorizeBundle(parsed, humanSignoffs(parsed)));

  assert.throws(() => assertM3HumanSignoffsAuthorizeBundle(parsed, {
    ...humanSignoffs(parsed),
    candidate: {
      ...parsed.releaseCandidate,
      deploymentId: "dpl_DifferentApprovedCandidate12345",
    },
  }), /human-signoffs release candidate/);

  const wrongAttestation = humanSignoffs(parsed);
  wrongAttestation.gates.financeAccounting.attestationFingerprint = "f".repeat(64);
  assert.throws(
    () => assertM3HumanSignoffsAuthorizeBundle(parsed, wrongAttestation),
    /human-signoffs attestation/,
  );

  assert.throws(() => assertM3HumanSignoffsAuthorizeBundle(parsed, {
    ...humanSignoffs(parsed),
    policyContentFingerprint: "e".repeat(64),
  }), /human-signoffs policy fingerprint/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: { ...bundle.attestations, finance: { ...bundle.attestations.finance, verdict: "PENDING" } },
  }), /Invalid input/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      finance: { ...bundle.attestations.finance, reviewedImplementationSha: "b".repeat(40) },
    },
  }), /exact reviewed release candidate/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      finance: { ...bundle.attestations.finance, reviewedDatabaseFingerprint: "2".repeat(16) },
    },
  }), /exact reviewed release candidate/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      legalPrivacy: {
        ...bundle.attestations.legalPrivacy,
        reviewer: { ...bundle.attestations.legalPrivacy.reviewer, role: "FINANCE_ACCOUNTING" },
      },
    },
  }), /reviewer role must be LEGAL_PRIVACY/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      legalPrivacy: {
        ...bundle.attestations.legalPrivacy,
        reviewer: {
          ...bundle.attestations.legalPrivacy.reviewer,
          id: bundle.attestations.finance.reviewer.id,
        },
      },
    },
  }), /Duplicate human attestation reviewer/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      legalPrivacy: {
        ...bundle.attestations.legalPrivacy,
        reviewer: {
          ...bundle.attestations.legalPrivacy.reviewer,
          name: bundle.attestations.finance.reviewer.name.toUpperCase(),
        },
      },
    },
  }), /Duplicate human attestation reviewer name/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      finance: {
        ...bundle.attestations.finance,
        source: ` ${bundle.attestations.finance.source}`,
      },
    },
  }), /canonical whitespace/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      finance: {
        ...bundle.attestations.finance,
        signature: { ...bundle.attestations.finance.signature, value: "B".repeat(86) },
      },
    },
  }), /attestation signature is invalid/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      finance: { ...bundle.attestations.finance, reviewedDeploymentSha: "c".repeat(40) },
    },
  }), /exact reviewed release candidate/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      ritualSme: {
        ...bundle.attestations.ritualSme,
        reviewer: { ...bundle.attestations.ritualSme.reviewer, experienceYears: null },
      },
    },
  }), /requires reviewer experienceYears/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: {
      ...bundle.attestations,
      ritualSme: {
        ...bundle.attestations.ritualSme,
        checklistAnswers: bundle.attestations.ritualSme.checklistAnswers.map((answer, index) => (
          index === 0 ? { ...answer, id: "unapproved-check" } : answer
        )),
      },
    },
  }), /exact required M3 checklist/);

  const incompleteFinance: Record<string, unknown> = { ...bundle.attestations.finance };
  delete incompleteFinance.scenarioResults;
  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: { ...bundle.attestations, finance: incompleteFinance },
  }), /Invalid input/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    documentPolicies: bundle.documentPolicies.map((policy) => ({
      ...policy,
      rules: [bundle.documentPolicies[0]!.rules[0]],
    })),
  }), /checklists must differ/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    documentPolicies: bundle.documentPolicies.map((policy, index) => index === 0 ? {
      ...policy,
      rules: [{ ...policy.rules[0], acceptedDocumentTypeCodes: ["UNAPPROVED_TYPE"] }],
    } : policy),
  }), /unapproved document type/);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    documentTypes: [
      ...bundle.documentTypes,
      { ...bundle.documentTypes[0], version: 2 },
    ],
  }), /Duplicate document type code/);
});

function validPolicyBundle() {
  const releaseCandidate = {
    previewUrl: "https://td-agent-synthetic-review.vercel.app/",
    deploymentId: "dpl_M3SyntheticReviewerEvidence12345",
    deploymentSha: "a".repeat(40),
    implementationSha: "a".repeat(40),
    databaseFingerprint: "1".repeat(16),
  };
  const commonRule = {
    kind: "REQUIRED" as const,
    conditionKey: null,
    conditionExplanation: null,
    dueOffsetHours: 24,
    ownerRole: "DOCUMENT_REVIEWER" as const,
    blockingStage: "EXECUTION" as const,
    reviewChecklist: ["synthetic-readable"],
    source: "Synthetic ritual fixture",
  };
  const policyContent = {
    schemaVersion: 3 as const,
    releaseCandidate,
    organizationId: "synthetic-org",
    approvedByUserId: 1,
    approvedAt: "2026-08-13T09:00:00.000Z",
    effectiveFrom: "2026-08-13T10:00:00.000Z",
    documentTypes: [
      {
        code: "APPLICANT_IDENTITY",
        version: 1,
        name: "Synthetic applicant identity",
        description: null,
        allowedMimeTypes: ["application/pdf" as const],
        maxBytes: 1_048_576,
        source: "Synthetic type fixture",
      },
      {
        code: "PLOT_ENTITLEMENT",
        version: 1,
        name: "Synthetic plot entitlement",
        description: null,
        allowedMimeTypes: ["application/pdf" as const],
        maxBytes: 1_048_576,
        source: "Synthetic type fixture",
      },
    ],
    documentPolicies: [
      {
        scenario: "CREMATION_V1" as const,
        version: 1,
        source: "Synthetic cremation policy",
        rules: [{
          ...commonRule,
          stableKey: "identity-record",
          acceptedDocumentTypeCodes: ["APPLICANT_IDENTITY"],
        }],
      },
      {
        scenario: "FAMILY_PLOT_BURIAL_V1" as const,
        version: 1,
        source: "Synthetic burial policy",
        rules: [{
          ...commonRule,
          stableKey: "plot-entitlement",
          acceptedDocumentTypeCodes: ["PLOT_ENTITLEMENT"],
        }],
      },
    ],
    signingPolicy: {
      version: "synthetic-legal-v1",
      allowedEvidenceTypes: ["SYNTHETIC_ACK"],
      source: "Synthetic legal fixture",
    },
    financialPolicy: {
      version: 1,
      correctionThresholdKopecks: 10_000,
      source: "Synthetic finance fixture",
    },
  };
  const policyContentFingerprint = commandFingerprint(policyContent);
  return {
    ...policyContent,
    attestations: {
      finance: humanAttestation(
        "FINANCE_ACCOUNTING",
        M3_HUMAN_ATTESTATION_CHECKLISTS.finance,
        releaseCandidate,
        policyContentFingerprint,
      ),
      legalPrivacy: humanAttestation(
        "LEGAL_PRIVACY",
        M3_HUMAN_ATTESTATION_CHECKLISTS.legalPrivacy,
        releaseCandidate,
        policyContentFingerprint,
      ),
      ritualSme: humanAttestation(
        "RITUAL_OPERATIONS_SME",
        M3_HUMAN_ATTESTATION_CHECKLISTS.ritualSme,
        releaseCandidate,
        policyContentFingerprint,
      ),
    },
  };
}

function humanAttestation(
  role: "FINANCE_ACCOUNTING" | "LEGAL_PRIVACY" | "RITUAL_OPERATIONS_SME",
  checklistIds: readonly string[],
  releaseCandidate: {
    previewUrl: string;
    deploymentId: string;
    deploymentSha: string;
    implementationSha: string;
    databaseFingerprint: string;
  },
  policyContentFingerprint: string,
) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
  const keyFingerprint = m3ReviewerPublicKeyFingerprint(publicKeyPem);
  const unsigned = {
    verdict: "PASS" as const,
    reviewer: {
      id: `synthetic-${role.toLowerCase()}-reviewer`,
      name: `Synthetic ${role} reviewer`,
      role,
      credentialReference: `platform-audit-key:${keyFingerprint}`,
      experienceYears: role === "RITUAL_OPERATIONS_SME" ? 10 : null,
    },
    source: "Synthetic human-verdict fixture",
    date: "2026-08-13T09:00:00.000Z",
    reviewedPreviewUrl: releaseCandidate.previewUrl,
    reviewedDeploymentId: releaseCandidate.deploymentId,
    reviewedDeploymentSha: releaseCandidate.deploymentSha,
    reviewedImplementationSha: releaseCandidate.implementationSha,
    reviewedDatabaseFingerprint: releaseCandidate.databaseFingerprint,
    reviewedPolicyContentFingerprint: policyContentFingerprint,
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
  const draft = {
    ...unsigned,
    signature: {
      algorithm: "Ed25519" as const,
      keyFingerprint,
      publicKeyPem,
      value: "A".repeat(86),
    },
  };
  return {
    ...draft,
    signature: {
      ...draft.signature,
      value: sign(null, Buffer.from(m3AttestationSigningPayload(draft)), privateKey).toString("base64url"),
    },
  };
}

function humanSignoffs(bundle: ReturnType<typeof parseM3ApprovedPolicyBundle>) {
  const gate = (packet: "finance.md" | "privacy.md" | "ritual-rules.md", attestation: typeof bundle.attestations.finance) => ({
    status: "PASS" as const,
    packet,
    attestation,
    attestationFingerprint: m3AttestationFingerprint(attestation),
  });
  return {
    schemaVersion: 2 as const,
    candidate: bundle.releaseCandidate,
    policyContentFingerprint: m3PolicyContentFingerprint(bundle),
    gates: {
      financeAccounting: gate("finance.md", bundle.attestations.finance),
      legalPrivacy: gate("privacy.md", bundle.attestations.legalPrivacy),
      ritualOperationsSme: gate("ritual-rules.md", bundle.attestations.ritualSme),
    },
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
