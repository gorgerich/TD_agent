import assert from "node:assert/strict";
import { test } from "node:test";
import { GET as financeWorkspace } from "../../app/api/agent/finance/route";
import { POST as login } from "../../app/api/agent/auth/login/route";
import {
  applyM3ApprovedPolicyBundle,
  parseM3ApprovedPolicyBundle,
  type M3ApprovedPolicyBundle,
} from "../../lib/m3PolicyActivation";
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
    const approver = await db.user.findUniqueOrThrow({
      where: { email: "m3-policy-approver@synthetic.invalid" },
      select: { id: true },
    });

    // Document policies are intentionally platform-wide. Exercise replacement inside
    // one rollback-only transaction so concurrent suites never observe a synthetic
    // global policy or lose their installed baseline.
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: approver.id }, data: { platformRole: "SUPER_ADMIN" } });
      const firstBundle = baselinePolicyBundle(organizationId, approver.id);
      const first = await applyM3ApprovedPolicyBundle(tx, firstBundle);
      const replay = await applyM3ApprovedPolicyBundle(tx, firstBundle);
      assert.equal(first.replayed, false);
      assert.equal(replay.replayed, true);
      assert.equal(replay.bundleFingerprint, first.bundleFingerprint);
      assert.equal(await tx.platformAuditEvent.count({
        where: { actorUserId: approver.id, action: "M3_POLICIES_ACTIVATED" },
      }), 1);
      assert.equal(await tx.contractSigningPolicy.count({ where: { organizationId, status: "APPROVED" } }), 1);
      assert.equal(await tx.financialControlPolicy.count({ where: { organizationId, status: "APPROVED" } }), 1);

      await assert.rejects(applyM3ApprovedPolicyBundle(tx, {
        ...firstBundle,
        signingPolicy: { ...firstBundle.signingPolicy, source: "Conflicting signed policy content" },
      }), /conflicts with approved bundle/);
      assert.equal(await tx.platformAuditEvent.count({
        where: { actorUserId: approver.id, action: "M3_POLICIES_ACTIVATED" },
      }), 1);
      throw new Error("ROLLBACK_M3_POLICY_ACTIVATION_TEST");
    }, { timeout: 20_000 }), /ROLLBACK_M3_POLICY_ACTIVATION_TEST/);
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
  const attestation = {
    verdict: "PASS" as const,
    source: "Synthetic human verdict fixture",
    date: "2026-08-13T09:00:00.000Z",
  };
  const typeCodes = {
    identity: "M3_IT_IDENTITY_V1",
    death: "M3_IT_DEATH_RECORD_V1",
    cremation: "M3_IT_CREMATION_V1",
    burialPlot: "M3_IT_BURIAL_PLOT_V1",
    relationship: "M3_IT_RELATIONSHIP_V1",
  };
  return parseM3ApprovedPolicyBundle({
    schemaVersion: 1,
    organizationId,
    approvedByUserId,
    approvedAt: "2026-08-11T00:00:00.000Z",
    effectiveFrom: "2026-08-11T00:00:00.000Z",
    attestations: { finance: attestation, legalPrivacy: attestation, ritualSme: attestation },
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
