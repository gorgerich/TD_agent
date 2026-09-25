import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const PREVIEW_URL = "https://td-agent-synthetic-review.vercel.app/";
const PREVIEW_DEPLOYMENT_ID = "dpl_M3SyntheticReviewerEvidence12345";
const PREVIEW_DATABASE_FINGERPRINT = "1234567890abcdef";
const SOURCE_CI_URL = "https://github.com/gorgerich/TD_agent/actions/runs/123456789";
const POLICY_CONTENT_FINGERPRINT = "b".repeat(64);
const SOURCE_CI_REQUIRED_STEPS = [
  "Verify patch formatting",
  "Verify Week 2 and M1 legacy backfill fixtures",
  "Configure SSI predicate lock granularity",
  "Apply migrations to isolated test database",
  "Verify repeated migration deploy is a no-op",
  "Verify migration/schema parity",
  "Lint",
  "Typecheck",
  "Unit tests",
  "Integration tests",
  "Repeat M3 concurrency and policy gates five times",
  "Provision isolated M1 browser UAT fixture",
  "Provision isolated M1 RBAC Hardening browser UAT fixture",
  "Provision isolated M3 browser UAT fixture",
  "Verify encrypted production-like backup and real restore",
  "Production build",
  "Start production server",
  "Wait for server",
  "End-to-end tests",
  "Cleanup isolated M3 browser UAT fixture",
  "Cleanup isolated M1 browser UAT fixture",
  "Cleanup isolated M1 RBAC Hardening browser UAT fixture",
];
const REQUIRED_GATES = [
  "code_quality", "unit", "integration", "e2e", "migration_rehearsal", "schema_parity",
  "tenant_rbac", "document_access_storage", "ledger_idempotency_concurrency", "stage_guards",
  "reconciliation", "accessibility_mobile", "preview_uat", "independent_review",
];
const ACCEPTANCE_IDS = [
  "M3-W7-01", "M3-W7-02", "M3-W7-03", "M3-W7-04", "M3-W7-05",
  "M3-W6-01", "M3-W6-02", "M3-W6-03", "M3-W6-04", "M3-W6-05",
  "M3-GUARD-01", "M3-RECON-01", "M3-SEC-01", "M3-MIG-01", "M3-UX-01",
  "M3-UAT-01", "M3-REVIEW-01", "M3-GATE-01",
];
const CHECKLISTS = {
  financeAccounting: [
    "entry-policy", "manual-evidence", "four-eyes-threshold",
    "accounting-formulas", "export-scope", "reconciliation",
  ],
  legalPrivacy: [
    "legal-basis-consent", "retention-rights", "signing-boundary",
    "access-visibility", "metadata-minimization", "special-category",
  ],
  ritualOperationsSme: [
    "cremation-requirements", "family-plot-requirements", "accepted-document-types",
    "stage-blockers", "ownership-due-rules", "rejection-replacement-flow",
  ],
} as const;

type EvidenceState = {
  state: "BLOCKED_HUMAN_JUDGMENT" | "MISSION_RELEASE_READY" | "RELEASED";
  gate: "AWAITING_HUMAN_VERDICT" | "PASS";
  authorized: boolean;
  productionRelease: "NOT_PERFORMED" | "RELEASED";
};

test("MISSION_RELEASE_READY still rejects evidence for a stale source tree", () => {
  const fixture = createEvidenceRepository(releaseReadyState());
  try {
    const initial = runValidator(fixture.root);
    assert.equal(initial.status, 0, initial.stderr);

    writeFileSync(join(fixture.root, "lib", "runtime.ts"), "export const runtime = 2;\n");
    git(fixture.root, "add", "lib/runtime.ts");
    git(fixture.root, "commit", "-m", "unreviewed source change");
    const stale = runValidator(fixture.root);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /source changes relative to HEAD/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("M3 human packets and machine sign-offs control every terminal state", () => {
  const fixture = createEvidenceRepository(blockedHumanState());
  const evidenceDir = join(fixture.root, "docs", "evidence", "missions", "M3");
  const missionPath = join(evidenceDir, "mission.yaml");
  const signoffsPath = join(evidenceDir, "human-signoffs.json");
  try {
    const initial = runValidator(fixture.root);
    assert.equal(initial.status, 0, initial.stderr);

    const reviewPath = join(evidenceDir, "review.md");
    writeFileSync(
      reviewPath,
      readFileSync(reviewPath, "utf8").replace(fixture.implementationSha, "0".repeat(40)),
    );
    const staleReview = runValidator(fixture.root);
    assert.notEqual(staleReview.status, 0);
    assert.match(staleReview.stderr, /review\.md does not bind/);
    writeEvidenceFiles(fixture.root, blockedHumanState(), fixture.implementationSha);

    writeFileSync(missionPath, missionYaml(releaseReadyState(), fixture.implementationSha));
    const relabelOnly = runValidator(fixture.root);
    assert.notEqual(relabelOnly.status, 0);
    assert.match(relabelOnly.stderr, /sign-off status disagrees|verdict disagrees|state disagrees/);

    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);
    const ready = runValidator(fixture.root);
    assert.equal(ready.status, 0, ready.stderr);

    const untrustedReviewer = runValidator(fixture.root, { trustSignoffs: false });
    assert.notEqual(untrustedReviewer.status, 0);
    assert.match(untrustedReviewer.stderr, /protected role trust root/);

    const wrongDatabase = JSON.parse(readFileSync(signoffsPath, "utf8"));
    wrongDatabase.candidate.databaseFingerprint = "f".repeat(16);
    writeFileSync(signoffsPath, JSON.stringify(wrongDatabase, null, 2));
    const wrongDatabaseCandidate = runValidator(fixture.root);
    assert.notEqual(wrongDatabaseCandidate.status, 0);
    assert.match(wrongDatabaseCandidate.stderr, /database fingerprint must match mission.yaml/);
    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);

    rmSync(join(evidenceDir, "finance.md"));
    const missingPacket = runValidator(fixture.root);
    assert.notEqual(missingPacket.status, 0);
    assert.match(missingPacket.stderr, /missing finance\.md/);
    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);

    const signoffs = JSON.parse(readFileSync(signoffsPath, "utf8"));
    signoffs.gates.legalPrivacy.attestation.reviewer.id = signoffs.gates.financeAccounting.attestation.reviewer.id;
    signoffs.gates.legalPrivacy.attestationFingerprint = canonicalFingerprint(
      signoffs.gates.legalPrivacy.attestation,
    );
    writeFileSync(signoffsPath, JSON.stringify(signoffs, null, 2));
    const duplicateReviewer = runValidator(fixture.root);
    assert.notEqual(duplicateReviewer.status, 0);
    assert.match(duplicateReviewer.stderr, /three distinct reviewers/);

    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);
    const whitespaceAttestation = JSON.parse(readFileSync(signoffsPath, "utf8"));
    whitespaceAttestation.gates.financeAccounting.attestation.source =
      ` ${whitespaceAttestation.gates.financeAccounting.attestation.source}`;
    whitespaceAttestation.gates.financeAccounting.attestationFingerprint = canonicalFingerprint(
      whitespaceAttestation.gates.financeAccounting.attestation,
    );
    writeFileSync(signoffsPath, JSON.stringify(whitespaceAttestation, null, 2));
    const nonCanonicalSignedText = runValidator(fixture.root);
    assert.notEqual(nonCanonicalSignedText.status, 0);
    assert.match(nonCanonicalSignedText.stderr, /attestation source is required/);

    writeEvidenceFiles(fixture.root, blockedHumanState(), fixture.implementationSha);
    const financePacket = join(evidenceDir, "finance.md");
    writeFileSync(financePacket, `${readFileSync(financePacket, "utf8")}<!-- hidden PASS decoy -->\n`);
    const decoy = runValidator(fixture.root);
    assert.notEqual(decoy.status, 0);
    assert.match(decoy.stderr, /hidden HTML comments/);

    writeEvidenceFiles(fixture.root, blockedHumanState(), fixture.implementationSha);
    writeFileSync(financePacket, `${readFileSync(financePacket, "utf8")}\n\`\`\`md\n- [x] entry-policy: hidden\n\`\`\`\n`);
    const fencedDecoy = runValidator(fixture.root);
    assert.notEqual(fencedDecoy.status, 0);
    assert.match(fencedDecoy.stderr, /fenced-code checklist decoys/);

    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);
    const resultsPath = join(evidenceDir, "test-results.json");
    const omittedGate = JSON.parse(readFileSync(resultsPath, "utf8"));
    delete omittedGate.checks.integration;
    writeFileSync(resultsPath, JSON.stringify(omittedGate));
    const missingGate = runValidator(fixture.root);
    assert.notEqual(missingGate.status, 0);
    assert.match(missingGate.stderr, /checks\.integration\.status must equal PASS/);

    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);
    const acceptancePath = join(evidenceDir, "acceptance.json");
    const emptyAcceptance = JSON.parse(readFileSync(acceptancePath, "utf8"));
    emptyAcceptance.acceptance = [];
    writeFileSync(acceptancePath, JSON.stringify(emptyAcceptance));
    const missingAcceptance = runValidator(fixture.root);
    assert.notEqual(missingAcceptance.status, 0);
    assert.match(missingAcceptance.stderr, /acceptance IDs must contain the exact required unique set/);

    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);
    const staleCi = JSON.parse(readFileSync(resultsPath, "utf8"));
    staleCi.githubCiUrl = "https://github.com/gorgerich/TD_agent/actions/runs/999";
    writeFileSync(resultsPath, JSON.stringify(staleCi));
    const wrongCi = runValidator(fixture.root);
    assert.notEqual(wrongCi.status, 0);
    assert.match(wrongCi.stderr, /source CI/);

    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);
    writeFileSync(
      missionPath,
      missionYaml(releaseReadyState(), fixture.implementationSha).replace(SOURCE_CI_URL, "https://github.com/gorgerich/TD_agent/actions/runs/999"),
    );
    const forgedCiResults = JSON.parse(readFileSync(resultsPath, "utf8"));
    forgedCiResults.githubCiUrl = "https://github.com/gorgerich/TD_agent/actions/runs/999";
    forgedCiResults.checks.sourceCi.runId = 999;
    writeFileSync(resultsPath, JSON.stringify(forgedCiResults));
    const unverifiedCi = runValidator(fixture.root);
    assert.notEqual(unverifiedCi.status, 0);
    assert.match(unverifiedCi.stderr, /source CI attestation unavailable/);

    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);
    const staleSchema = JSON.parse(readFileSync(signoffsPath, "utf8"));
    staleSchema.schemaVersion = 1;
    writeFileSync(signoffsPath, JSON.stringify(staleSchema));
    const wrongSchema = runValidator(fixture.root);
    assert.notEqual(wrongSchema.status, 0);
    assert.match(wrongSchema.stderr, /schemaVersion must equal 2/);

    writeEvidenceFiles(fixture.root, releasedState(false), fixture.implementationSha);
    const unauthorizedRelease = runValidator(fixture.root);
    assert.notEqual(unauthorizedRelease.status, 0);
    assert.match(unauthorizedRelease.stderr, /RELEASED requires production_release_authorized=true/);

    writeEvidenceFiles(fixture.root, releasedState(true), fixture.implementationSha);
    const released = runValidator(fixture.root);
    assert.equal(released.status, 0, released.stderr);

    const results = JSON.parse(readFileSync(resultsPath, "utf8"));
    results.checks.skipped = 1;
    writeFileSync(resultsPath, JSON.stringify(results));
    const releasedSkip = runValidator(fixture.root);
    assert.notEqual(releasedSkip.status, 0);
    assert.match(releasedSkip.stderr, /skipped must equal 0/);

    writeEvidenceFiles(fixture.root, releasedState(true), fixture.implementationSha);
    writeFileSync(join(fixture.root, "lib", "runtime.ts"), "export const runtime = 3;\n");
    git(fixture.root, "add", "lib/runtime.ts");
    git(fixture.root, "commit", "-m", "released unreviewed source change");
    const releasedStale = runValidator(fixture.root);
    assert.notEqual(releasedStale.status, 0);
    assert.match(releasedStale.stderr, /source changes relative to HEAD/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function createEvidenceRepository(state: EvidenceState): { root: string; implementationSha: string } {
  const root = mkdtempSync(join(tmpdir(), "td-mission-evidence-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  copyFileSync(
    join(process.cwd(), "scripts", "validate-mission-evidence.mjs"),
    join(root, "scripts", "validate-mission-evidence.mjs"),
  );
  writeFileSync(join(root, "lib", "runtime.ts"), "export const runtime = 1;\n");
  writeEvidenceFiles(root, state, "0".repeat(40));

  git(root, "init");
  git(root, "config", "user.email", "validator@synthetic.invalid");
  git(root, "config", "user.name", "Synthetic validator");
  git(root, "add", ".");
  git(root, "commit", "-m", "implementation");
  const implementationSha = git(root, "rev-parse", "HEAD").trim();
  writeEvidenceFiles(root, state, implementationSha);
  git(root, "add", "docs/evidence");
  git(root, "commit", "-m", "evidence");
  return { root, implementationSha };
}

function writeEvidenceFiles(root: string, state: EvidenceState, implementationSha: string) {
  const evidenceDir = join(root, "docs", "evidence", "missions", "M3");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "mission.yaml"), missionYaml(state, implementationSha));
  const signoffs = humanSignoffs(state, implementationSha);
  writeFileSync(join(evidenceDir, "human-signoffs.json"), JSON.stringify(signoffs, null, 2));
  writeFileSync(
    join(evidenceDir, "reviewer-credentials.json"),
    JSON.stringify(reviewerCredentials(state, signoffs), null, 2),
  );
  for (const [key, filename] of [
    ["financeAccounting", "finance.md"],
    ["legalPrivacy", "privacy.md"],
    ["ritualOperationsSme", "ritual-rules.md"],
  ] as const) {
    const gate = signoffs.gates[key];
    const reviewer = gate.attestation?.reviewer;
    const checks = CHECKLISTS[key].map((id) => `- [${gate.status === "PASS" ? "x" : " "}] ${id}: Synthetic decision item`);
    writeFileSync(join(evidenceDir, filename), [
      "---",
      "schema: m3-human-packet-v2",
      `gate: ${key}`,
      `preview_url: ${PREVIEW_URL}`,
      `deployment_id: ${PREVIEW_DEPLOYMENT_ID}`,
      `deployment_sha: ${implementationSha}`,
      `implementation_sha: ${implementationSha}`,
      `database_fingerprint: ${PREVIEW_DATABASE_FINGERPRINT}`,
      `current_verdict: ${gate.status}`,
      `reviewer_id: ${reviewer?.id ?? "null"}`,
      `reviewer_name: ${reviewer?.name ?? "null"}`,
      `attestation_fingerprint: ${gate.attestationFingerprint ?? "null"}`,
      "---",
      `# Synthetic ${filename}`,
      "",
      ...checks,
      `- [${gate.status === "PASS" ? "x" : " "}] scenario-cremation: Synthetic scenario decision`,
      `- [${gate.status === "PASS" ? "x" : " "}] scenario-family-plot-burial: Synthetic scenario decision`,
      "",
    ].join("\n"));
  }
  for (const name of ["implementation.md", "migration.md", "security.md", "ux-uat.md"]) {
    writeFileSync(join(evidenceDir, name), `# Synthetic ${name}\n`);
  }
  writeFileSync(join(evidenceDir, "review.md"), [
    "---",
    "schema: m3-independent-review-v1",
    `reviewed_sha: ${implementationSha}`,
    "reviewer: Synthetic independent reviewer",
    "verdict: PASS",
    "p0: 0",
    "p1: 0",
    "p2: 0",
    "---",
    "# Synthetic review.md",
    "",
  ].join("\n"));
  writeFileSync(join(evidenceDir, "release.md"), `# Release\n\n\`${state.state}\`\n`);
  writeFileSync(join(evidenceDir, "acceptance.json"), JSON.stringify({
    mission: "M3-FULFILMENT-MONEY-TRUST",
    state: state.state,
    acceptance: ACCEPTANCE_IDS.map((id) => ({
      id,
      status: "PASS",
      requirement: `Synthetic requirement contract for ${id}`,
      evidence: `Synthetic deterministic evidence record for ${id}`,
    })),
  }));
  writeFileSync(join(evidenceDir, "test-results.json"), JSON.stringify({
    mission: "M3-FULFILMENT-MONEY-TRUST",
    state: state.state,
    implementationSha,
    githubCiUrl: SOURCE_CI_URL,
    previewDeploymentId: PREVIEW_DEPLOYMENT_ID,
    previewDeploymentSha: implementationSha,
    previewUrl: PREVIEW_URL,
    previewDatabaseFingerprint: PREVIEW_DATABASE_FINGERPRINT,
    checks: {
      sourceCi: { status: "PASS", runId: 123456789, headSha: implementationSha, testSkipped: 0 },
      gitDiffCheck: "PASS",
      prismaGenerate: "PASS",
      typecheck: "PASS",
      lint: "PASS",
      build: "PASS",
      unit: { status: "PASS", passed: 10, skipped: 0 },
      integration: { status: "PASS", passed: 10, skipped: 0, residue: 0 },
      e2e: { status: "PASS", skipped: 0 },
      migrationRehearsal: { status: "PASS", repeatedDeploy: "NO_OP", orphans: 0, duplicates: 0, tenantMismatches: 0 },
      schemaParity: "PASS",
      documentTruth: { status: "PASS" },
      financeTruth: { status: "PASS" },
      stageGuards: "PASS",
      tenantRbac: "PASS",
      reconciliation: { status: "PASS", discrepancies: 0 },
      accessibility: { status: "PASS", critical: 0, serious: 0, mobile: "PASS", zoom200: "PASS", horizontalOverflow: 0 },
      previewUat: {
        status: "PASS",
        deploymentId: PREVIEW_DEPLOYMENT_ID,
        deploymentSha: implementationSha,
        previewUrl: PREVIEW_URL,
        databaseFingerprint: PREVIEW_DATABASE_FINGERPRINT,
        skipped: 0,
        unexpected5xx: 0,
      },
      independentReview: {
        status: "PASS",
        reviewedSha: implementationSha,
        p0: 0,
        p1: 0,
        p2: 0,
        reviewer: "Synthetic independent reviewer",
      },
      evidenceSchema: "PASS",
      discoveryParity: { status: "PASS" },
      skipped: 0,
      notRun: 0,
    },
    humanGates: {
      financeAccounting: state.gate,
      legalPrivacy: state.gate,
      ritualOperationsSme: state.gate,
    },
    production: { writes: "NONE", databaseSchemaChanges: "NONE", deployment: "UNCHANGED" },
  }));
}

function reviewerCredentials(state: EvidenceState, signoffs: ReturnType<typeof humanSignoffs>) {
  const credential = (key: keyof typeof CHECKLISTS, role: string) => {
    const attestation = signoffs.gates[key].attestation;
    if (state.gate === "AWAITING_HUMAN_VERDICT" || !attestation) {
      return {
        status: "NOT_REGISTERED",
        reviewerRole: role,
        keyFingerprint: null,
        registrationAuditEventId: null,
        registrationDatabaseFingerprint: null,
        registeredAt: null,
        registeredByUserId: null,
        verificationMethod: null,
        verificationReferenceFingerprint: null,
      };
    }
    return {
      status: "REGISTERED",
      reviewerRole: role,
      keyFingerprint: attestation.signature.keyFingerprint,
      registrationAuditEventId: `audit-${key}-12345678`,
      registrationDatabaseFingerprint: PREVIEW_DATABASE_FINGERPRINT,
      registeredAt: "2026-08-25T11:00:00.000Z",
      registeredByUserId: 1,
      verificationMethod: "VIDEO_CALL",
      verificationReferenceFingerprint: "c".repeat(64),
    };
  };
  return {
    schemaVersion: 1,
    candidate: signoffs.candidate,
    credentials: {
      financeAccounting: credential("financeAccounting", "FINANCE_ACCOUNTING"),
      legalPrivacy: credential("legalPrivacy", "LEGAL_PRIVACY"),
      ritualOperationsSme: credential("ritualOperationsSme", "RITUAL_OPERATIONS_SME"),
    },
  };
}

function humanSignoffs(state: EvidenceState, implementationSha: string) {
  const candidate = {
    previewUrl: PREVIEW_URL,
    deploymentId: PREVIEW_DEPLOYMENT_ID,
    deploymentSha: implementationSha,
    implementationSha,
    databaseFingerprint: PREVIEW_DATABASE_FINGERPRINT,
  };
  const gate = (
    key: keyof typeof CHECKLISTS,
    packet: string,
    role: "FINANCE_ACCOUNTING" | "LEGAL_PRIVACY" | "RITUAL_OPERATIONS_SME",
  ) => {
    if (state.gate === "AWAITING_HUMAN_VERDICT") {
      return { status: state.gate, packet, attestation: null, attestationFingerprint: null };
    }
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString().trim();
    const keyFingerprint = createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
    const unsigned = {
      verdict: "PASS",
      reviewer: {
        id: `synthetic-${role.toLowerCase()}-reviewer`,
        name: `Synthetic ${role} reviewer`,
        role,
        credentialReference: `platform-audit-key:${keyFingerprint}`,
        experienceYears: role === "RITUAL_OPERATIONS_SME" ? 10 : null,
      },
      source: `Synthetic ${key} signed record`,
      date: "2026-08-25T12:00:00.000Z",
      reviewedPreviewUrl: PREVIEW_URL,
      reviewedDeploymentId: PREVIEW_DEPLOYMENT_ID,
      reviewedDeploymentSha: implementationSha,
      reviewedImplementationSha: implementationSha,
      reviewedDatabaseFingerprint: PREVIEW_DATABASE_FINGERPRINT,
      reviewedPolicyContentFingerprint: POLICY_CONTENT_FINGERPRINT,
      checklistAnswers: CHECKLISTS[key].map((id) => ({ id, verdict: "PASS", notes: "Synthetic PASS" })),
      scenarioResults: {
        cremation: { verdict: "PASS", notes: "Synthetic cremation PASS" },
        familyPlotBurial: { verdict: "PASS", notes: "Synthetic burial PASS" },
      },
    };
    const signature = {
      algorithm: "Ed25519",
      keyFingerprint,
      publicKeyPem,
      value: sign(null, Buffer.from(canonicalString(unsigned)), privateKey).toString("base64url"),
    };
    const attestation = { ...unsigned, signature };
    return { status: state.gate, packet, attestation, attestationFingerprint: canonicalFingerprint(attestation) };
  };
  return {
    schemaVersion: 2,
    candidate,
    policyContentFingerprint: state.gate === "PASS" ? POLICY_CONTENT_FINGERPRINT : null,
    gates: {
      financeAccounting: gate("financeAccounting", "finance.md", "FINANCE_ACCOUNTING"),
      legalPrivacy: gate("legalPrivacy", "privacy.md", "LEGAL_PRIVACY"),
      ritualOperationsSme: gate("ritualOperationsSme", "ritual-rules.md", "RITUAL_OPERATIONS_SME"),
    },
  };
}

function missionYaml(state: EvidenceState, implementationSha: string): string {
  return [
    "mission: M3",
    `state: ${state.state}`,
    `implementation_sha: ${implementationSha}`,
    `source_ci: ${SOURCE_CI_URL}`,
    `preview_deployment_id: ${PREVIEW_DEPLOYMENT_ID}`,
    `preview_deployment_sha: ${implementationSha}`,
    `preview_url: ${PREVIEW_URL}`,
    `preview_database_fingerprint: ${PREVIEW_DATABASE_FINGERPRINT}`,
    "required_gates:",
    ...REQUIRED_GATES.map((gate) => `  - ${gate}`),
    "passed_gates:",
    ...REQUIRED_GATES.map((gate) => `  - ${gate}`),
    "human_gates:",
    `  finance_accounting: ${state.gate}`,
    `  legal_privacy: ${state.gate}`,
    `  ritual_operations_sme: ${state.gate}`,
    `production_release_authorized: ${state.authorized}`,
    `production_release: ${state.productionRelease}`,
    "",
  ].join("\n");
}

function blockedHumanState(): EvidenceState {
  return { state: "BLOCKED_HUMAN_JUDGMENT", gate: "AWAITING_HUMAN_VERDICT", authorized: false, productionRelease: "NOT_PERFORMED" };
}

function releaseReadyState(): EvidenceState {
  return { state: "MISSION_RELEASE_READY", gate: "PASS", authorized: false, productionRelease: "NOT_PERFORMED" };
}

function releasedState(authorized: boolean): EvidenceState {
  return { state: "RELEASED", gate: "PASS", authorized, productionRelease: "RELEASED" };
}

function canonicalFingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalString(value)).digest("hex");
}

function canonicalString(value: unknown): string {
  const canonicalize = (nested: unknown): unknown => {
    if (Array.isArray(nested)) return nested.map(canonicalize);
    if (nested && typeof nested === "object") {
      return Object.fromEntries(Object.entries(nested as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]));
    }
    return nested;
  };
  return JSON.stringify(canonicalize(value));
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runValidator(cwd: string, options: { trustSignoffs?: boolean } = {}) {
  const evidenceDir = join(cwd, "docs", "evidence", "missions", "M3");
  const signoffs = JSON.parse(readFileSync(join(evidenceDir, "human-signoffs.json"), "utf8"));
  const keyFor = (key: keyof typeof CHECKLISTS) => signoffs.gates[key].attestation?.signature?.keyFingerprint ?? "";
  const sourceCiFixture = join(cwd, ".git", "m3-source-ci-attestation.json");
  writeFileSync(sourceCiFixture, JSON.stringify({
    "123456789": {
      run: {
        id: 123456789,
        repository: { full_name: "gorgerich/TD_agent" },
        head_repository: { full_name: "gorgerich/TD_agent" },
        head_sha: signoffs.candidate.implementationSha,
        event: "pull_request",
        status: "completed",
        conclusion: "success",
      },
      jobs: {
        jobs: [{
          name: "verify",
          conclusion: "success",
          steps: [
            ...SOURCE_CI_REQUIRED_STEPS.map((name) => ({ name, status: "completed", conclusion: "success" })),
            { name: "Validate authoritative mission evidence", status: "completed", conclusion: "success" },
          ],
        }],
      },
    },
  }));
  const result = spawnSync(process.execPath, ["scripts/validate-mission-evidence.mjs"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      REQUIRED_MISSION_EVIDENCE: "M3",
      M3_EVIDENCE_VALIDATOR_TEST_MODE: "YES",
      M3_SOURCE_CI_ATTESTATION_FILE: sourceCiFixture,
      M3_FINANCE_REVIEWER_KEY_FINGERPRINTS: options.trustSignoffs === false ? "" : keyFor("financeAccounting"),
      M3_LEGAL_PRIVACY_REVIEWER_KEY_FINGERPRINTS: options.trustSignoffs === false ? "" : keyFor("legalPrivacy"),
      M3_RITUAL_SME_REVIEWER_KEY_FINGERPRINTS: options.trustSignoffs === false ? "" : keyFor("ritualOperationsSme"),
    },
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}
