import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const PREVIEW_URL = "https://td-agent-synthetic-review.vercel.app/";
const PREVIEW_DEPLOYMENT_ID = "dpl_M3SyntheticReviewerEvidence12345";
const PREVIEW_DATABASE_FINGERPRINT = "1234567890abcdef";
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

    writeFileSync(missionPath, missionYaml(releaseReadyState(), fixture.implementationSha));
    const relabelOnly = runValidator(fixture.root);
    assert.notEqual(relabelOnly.status, 0);
    assert.match(relabelOnly.stderr, /sign-off status disagrees|verdict disagrees|state disagrees/);

    writeEvidenceFiles(fixture.root, releaseReadyState(), fixture.implementationSha);
    const ready = runValidator(fixture.root);
    assert.equal(ready.status, 0, ready.stderr);

    const wrongDatabase = JSON.parse(readFileSync(signoffsPath, "utf8"));
    wrongDatabase.candidate.previewDatabaseFingerprint = "f".repeat(16);
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

    writeEvidenceFiles(fixture.root, blockedHumanState(), fixture.implementationSha);
    writeFileSync(missionPath, `${missionYaml(blockedHumanState(), fixture.implementationSha)}decoy:\n  finance_accounting: PASS\n`);
    const decoy = runValidator(fixture.root);
    assert.equal(decoy.status, 0, decoy.stderr);

    writeEvidenceFiles(fixture.root, releasedState(false), fixture.implementationSha);
    const unauthorizedRelease = runValidator(fixture.root);
    assert.notEqual(unauthorizedRelease.status, 0);
    assert.match(unauthorizedRelease.stderr, /RELEASED requires production_release_authorized=true/);

    writeEvidenceFiles(fixture.root, releasedState(true), fixture.implementationSha);
    const released = runValidator(fixture.root);
    assert.equal(released.status, 0, released.stderr);

    const resultsPath = join(evidenceDir, "test-results.json");
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
  for (const [key, filename] of [
    ["financeAccounting", "finance.md"],
    ["legalPrivacy", "privacy.md"],
    ["ritualOperationsSme", "ritual-rules.md"],
  ] as const) {
    const gate = signoffs.gates[key];
    const verdict = gate.status === "PASS" ? "PASS" : "AWAITING HUMAN";
    const identity = gate.attestation
      ? `\nReviewer: ${gate.attestation.reviewer.name} (${gate.attestation.reviewer.id})\n`
      : "\n";
    writeFileSync(join(evidenceDir, filename), [
      `# Synthetic ${filename}`,
      PREVIEW_URL,
      PREVIEW_DEPLOYMENT_ID,
      implementationSha,
      PREVIEW_DATABASE_FINGERPRINT,
      identity,
      `Current verdict: **${verdict}**.`,
      "",
    ].join("\n"));
  }
  for (const name of ["implementation.md", "migration.md", "security.md", "ux-uat.md", "review.md"]) {
    writeFileSync(join(evidenceDir, name), `# Synthetic ${name}\n`);
  }
  writeFileSync(join(evidenceDir, "release.md"), `# Release\n\n\`${state.state}\`\n`);
  writeFileSync(join(evidenceDir, "acceptance.json"), JSON.stringify({
    state: state.state,
    acceptance: [{ id: "fixture", status: "PASS" }],
  }));
  writeFileSync(join(evidenceDir, "test-results.json"), JSON.stringify({
    state: state.state,
    implementationSha,
    previewDeploymentId: PREVIEW_DEPLOYMENT_ID,
    previewDatabaseFingerprint: PREVIEW_DATABASE_FINGERPRINT,
    checks: { skipped: 0, notRun: 0, independentReview: { p0: 0, p1: 0 } },
    humanGates: {
      financeAccounting: state.gate,
      legalPrivacy: state.gate,
      ritualOperationsSme: state.gate,
    },
  }));
}

function humanSignoffs(state: EvidenceState, implementationSha: string) {
  const candidate = {
    previewUrl: PREVIEW_URL,
    previewDeploymentId: PREVIEW_DEPLOYMENT_ID,
    implementationSha,
    previewDatabaseFingerprint: PREVIEW_DATABASE_FINGERPRINT,
  };
  const gate = (
    key: keyof typeof CHECKLISTS,
    packet: string,
    role: "FINANCE_ACCOUNTING" | "LEGAL_PRIVACY" | "RITUAL_OPERATIONS_SME",
  ) => {
    if (state.gate === "AWAITING_HUMAN_VERDICT") {
      return { status: state.gate, packet, attestation: null, attestationFingerprint: null };
    }
    const attestation = {
      verdict: "PASS",
      reviewer: {
        id: `synthetic-${role.toLowerCase()}-reviewer`,
        name: `Synthetic ${role} reviewer`,
        role,
        credentialReference: `synthetic-registry:${role}`,
        experienceYears: role === "RITUAL_OPERATIONS_SME" ? 10 : null,
      },
      source: `Synthetic ${key} signed record`,
      date: "2026-08-25T12:00:00.000Z",
      reviewedPreviewUrl: PREVIEW_URL,
      reviewedDeploymentId: PREVIEW_DEPLOYMENT_ID,
      reviewedImplementationSha: implementationSha,
      reviewedDatabaseFingerprint: PREVIEW_DATABASE_FINGERPRINT,
      checklistAnswers: CHECKLISTS[key].map((id) => ({ id, verdict: "PASS", notes: "Synthetic PASS" })),
      scenarioResults: {
        cremation: { verdict: "PASS", notes: "Synthetic cremation PASS" },
        familyPlotBurial: { verdict: "PASS", notes: "Synthetic burial PASS" },
      },
    };
    return { status: state.gate, packet, attestation, attestationFingerprint: canonicalFingerprint(attestation) };
  };
  return {
    schemaVersion: 1,
    candidate,
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
    `preview_deployment_id: ${PREVIEW_DEPLOYMENT_ID}`,
    `preview_url: ${PREVIEW_URL}`,
    `preview_database_fingerprint: ${PREVIEW_DATABASE_FINGERPRINT}`,
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
  const canonicalize = (nested: unknown): unknown => {
    if (Array.isArray(nested)) return nested.map(canonicalize);
    if (nested && typeof nested === "object") {
      return Object.fromEntries(Object.entries(nested as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]));
    }
    return nested;
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runValidator(cwd: string) {
  const result = spawnSync(process.execPath, ["scripts/validate-mission-evidence.mjs"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, REQUIRED_MISSION_EVIDENCE: "M3" },
  });
  return { status: result.status, stderr: result.stderr ?? "" };
}
