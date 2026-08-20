import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveCaseDocumentTruth,
  deriveLedgerSummary,
  evaluateDocumentRequirement,
  evaluateFulfilmentGuards,
  getDraftScenarioRequirementBlueprints,
  remainingRefundableKopecks,
  requiresFourEyesApproval,
  type LedgerProjectionEntry,
} from "../lib/m3Domain";
import { getDocumentScanner } from "../lib/documentScanner";
import { parseM3ApprovedPolicyBundle } from "../lib/m3PolicyActivation";

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
  assert.equal(parseM3ApprovedPolicyBundle(bundle).documentPolicies.length, 2);

  assert.throws(() => parseM3ApprovedPolicyBundle({
    ...bundle,
    attestations: { ...bundle.attestations, finance: { ...bundle.attestations.finance, verdict: "PENDING" } },
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
});

function validPolicyBundle() {
  const attestation = {
    verdict: "PASS" as const,
    source: "Synthetic human-verdict fixture",
    date: "2026-08-13T09:00:00.000Z",
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
  return {
    schemaVersion: 1 as const,
    organizationId: "synthetic-org",
    approvedByUserId: 1,
    approvedAt: "2026-08-13T09:00:00.000Z",
    effectiveFrom: "2026-08-13T10:00:00.000Z",
    attestations: { finance: attestation, legalPrivacy: attestation, ritualSme: attestation },
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
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
