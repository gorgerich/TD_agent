import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve("docs/evidence/missions");
const errors = [];
const requiredMission = process.env.REQUIRED_MISSION_EVIDENCE;
const M3_HUMAN_GATE_CONTRACTS = {
  financeAccounting: {
    yamlKey: "finance_accounting",
    packet: "finance.md",
    role: "FINANCE_ACCOUNTING",
    checklist: [
      "entry-policy",
      "manual-evidence",
      "four-eyes-threshold",
      "accounting-formulas",
      "export-scope",
      "reconciliation",
    ],
  },
  legalPrivacy: {
    yamlKey: "legal_privacy",
    packet: "privacy.md",
    role: "LEGAL_PRIVACY",
    checklist: [
      "legal-basis-consent",
      "retention-rights",
      "signing-boundary",
      "access-visibility",
      "metadata-minimization",
      "special-category",
    ],
  },
  ritualOperationsSme: {
    yamlKey: "ritual_operations_sme",
    packet: "ritual-rules.md",
    role: "RITUAL_OPERATIONS_SME",
    checklist: [
      "cremation-requirements",
      "family-plot-requirements",
      "accepted-document-types",
      "stage-blockers",
      "ownership-due-rules",
      "rejection-replacement-flow",
    ],
  },
};
if (requiredMission && !fs.existsSync(path.join(root, requiredMission))) {
  errors.push(`${requiredMission}: evidence directory is required`);
}
for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const missionDir = path.join(root, directory.name);
  const requiresTerminalEvidence = directory.name === requiredMission;
  // A mission already marked RELEASED is a historical record. Re-validating it would make
  // an unrelated change to today's mission fail on a frozen artifact that nobody may edit.
  const missionYamlPath = path.join(missionDir, "mission.yaml");
  const missionText = fs.existsSync(missionYamlPath) ? fs.readFileSync(missionYamlPath, "utf8") : "";
  const missionState = missionText ? missionTopLevelScalar(missionText, "state") : "";
  const KNOWN_STATES = new Set([
    "PLANNED",
    "CONTRACT_LOCKED",
    "IMPLEMENTATION_VERIFIED",
    "MISSION_RELEASE_READY",
    "BLOCKED_AUTHORITY",
    "BLOCKED_EXTERNAL_ACCESS",
    "BLOCKED_SAFETY",
    "BLOCKED_HUMAN_JUDGMENT",
    "RELEASED",
  ]);
  if (!KNOWN_STATES.has(missionState)) {
    // Fail closed: an absent, misspelled or comment-suffixed state used to silently disable
    // the SHA-integrity check below with no diagnostic.
    errors.push(`${directory.name}: mission.yaml state is missing or unrecognised (${missionState || "none"})`);
  }
  const released = missionState === "RELEASED";
  const historicalReleased = released && !requiresTerminalEvidence;
  // The mission currently being released must retain source parity even after it reaches
  // MISSION_RELEASE_READY. Other release-ready missions are frozen historical records.
  const requiresSourceParity = missionState !== ""
    && !historicalReleased
    && (requiresTerminalEvidence || missionState !== "MISSION_RELEASE_READY");
  const requiredFiles = [
    "mission.yaml",
    "implementation.md",
    "test-results.json",
    "acceptance.json",
    "migration.md",
    "security.md",
    "ux-uat.md",
    "review.md",
    "release.md",
    ...(directory.name === "M3"
      ? ["finance.md", "privacy.md", "ritual-rules.md", "human-signoffs.json"]
      : []),
  ];
  for (const required of requiredFiles) {
    if (!fs.existsSync(path.join(missionDir, required))) errors.push(`${directory.name}: missing ${required}`);
  }
  if (directory.name === "M3") {
    validateM3HumanReleaseBoundary(missionDir, missionText, missionState, errors);
  }
  for (const jsonName of ["test-results.json", "acceptance.json"]) {
    const jsonPath = path.join(missionDir, jsonName);
    if (!fs.existsSync(jsonPath)) continue;
    const value = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    // These hold for EVERY mission that records results at all, not only the terminal one.
    // Gating them on requiredMission meant a mission could certify a SHA that is not in
    // this history, or record skipped tests, with nothing to catch it.
    // Look at status-bearing values, not the serialized blob: an acceptance *requirement*
    // may legitimately contain the words "NOT_RUN=0" as prose.
    if (!historicalReleased && statusValues(value).includes("NOT_RUN")) {
      errors.push(`${directory.name}/${jsonName}: NOT_RUN is forbidden`);
    }
    if (jsonName === "test-results.json" && !historicalReleased) {
      if (value.checks?.skipped !== 0) errors.push(`${directory.name}: skipped must equal 0`);
      if (value.checks?.notRun !== 0) errors.push(`${directory.name}: notRun must equal 0`);
      if (typeof value.implementationSha !== "string" || !/^[0-9a-f]{40}$/.test(value.implementationSha)) {
        errors.push(`${directory.name}: implementationSha must be a full commit SHA`);
      } else if (!isAncestor(value.implementationSha)) {
        errors.push(`${directory.name}: implementationSha is not an ancestor of HEAD`);
      } else if (requiresSourceParity && !hasSameSourceTreeAsHead(value.implementationSha)) {
        // Ancestry is satisfied by every commit in history, including the mission's own base,
        // so it cannot catch evidence that certifies an older commit. Requiring exact HEAD
        // would be circular, because recording the SHA is itself a commit. Require instead
        // that the certified commit and HEAD have an identical source tree — differing only
        // under docs/evidence.
        errors.push(
          `${directory.name}: implementationSha ${value.implementationSha} has source changes relative to HEAD`,
        );
      }
      // Only the terminal gates stay scoped to the mission under release.
      if (requiresTerminalEvidence) {
        if (value.checks?.independentReview?.p0 !== 0 || value.checks?.independentReview?.p1 !== 0) {
          errors.push(`${directory.name}: independent review must have p0=0 and p1=0`);
        }
      }
    }
    if (jsonName === "acceptance.json") {
      for (const item of value.acceptance ?? []) {
        if (requiresTerminalEvidence && item.status !== "PASS") {
          errors.push(`${directory.name}: ${item.id ?? "acceptance"} is not PASS`);
        }
      }
    }
  }
}

function validateM3HumanReleaseBoundary(missionDir, missionText, missionState, target) {
  const missionGates = Object.fromEntries(Object.entries(M3_HUMAN_GATE_CONTRACTS).map(
    ([key, contract]) => [key, missionNestedScalar(missionText, "human_gates", contract.yamlKey)],
  ));
  const releaseAuthorized = missionTopLevelScalar(missionText, "production_release_authorized");
  const productionRelease = missionTopLevelScalar(missionText, "production_release");
  const implementationSha = missionTopLevelScalar(missionText, "implementation_sha");
  const previewDeploymentId = missionTopLevelScalar(missionText, "preview_deployment_id");
  const previewUrl = missionTopLevelScalar(missionText, "preview_url");
  const previewDatabaseFingerprint = missionTopLevelScalar(missionText, "preview_database_fingerprint");

  let expectedGate = null;
  if (missionState === "BLOCKED_HUMAN_JUDGMENT") {
    expectedGate = "AWAITING_HUMAN_VERDICT";
    if (releaseAuthorized !== "false") {
      target.push("M3: BLOCKED_HUMAN_JUDGMENT requires production_release_authorized=false");
    }
    if (productionRelease !== "NOT_PERFORMED") {
      target.push("M3: BLOCKED_HUMAN_JUDGMENT requires production_release=NOT_PERFORMED");
    }
  } else if (missionState === "MISSION_RELEASE_READY") {
    expectedGate = "PASS";
    if (releaseAuthorized !== "false") {
      target.push("M3: MISSION_RELEASE_READY requires production_release_authorized=false");
    }
    if (productionRelease !== "NOT_PERFORMED") {
      target.push("M3: MISSION_RELEASE_READY requires production_release=NOT_PERFORMED");
    }
  } else if (missionState === "RELEASED") {
    expectedGate = "PASS";
    if (releaseAuthorized !== "true") {
      target.push("M3: RELEASED requires production_release_authorized=true");
    }
    if (productionRelease !== "RELEASED") {
      target.push("M3: RELEASED requires production_release=RELEASED");
    }
  }

  if (expectedGate) {
    for (const [gate, actual] of Object.entries(missionGates)) {
      if (actual !== expectedGate) target.push(`M3: ${gate} human gate must equal ${expectedGate}`);
    }
  }

  const signoffsPath = path.join(missionDir, "human-signoffs.json");
  if (!fs.existsSync(signoffsPath)) return;
  let signoffs;
  try {
    signoffs = JSON.parse(fs.readFileSync(signoffsPath, "utf8"));
  } catch {
    target.push("M3: human-signoffs.json must be valid JSON");
    return;
  }
  if (signoffs.schemaVersion !== 1) target.push("M3: human-signoffs.json schemaVersion must equal 1");
  const candidate = signoffs.candidate ?? {};
  if (candidate.implementationSha !== implementationSha) {
    target.push("M3: human sign-off implementation SHA must match mission.yaml");
  }
  if (candidate.previewDeploymentId !== previewDeploymentId) {
    target.push("M3: human sign-off Preview deployment must match mission.yaml");
  }
  if (candidate.previewUrl !== previewUrl) {
    target.push("M3: human sign-off Preview URL must match mission.yaml");
  }
  if (candidate.previewDatabaseFingerprint !== previewDatabaseFingerprint) {
    target.push("M3: human sign-off Preview database fingerprint must match mission.yaml");
  }
  if (!/^[0-9a-f]{16}$/.test(candidate.previewDatabaseFingerprint ?? "")) {
    target.push("M3: human sign-off Preview database fingerprint is invalid");
  }

  const reviewerIds = [];
  for (const [key, contract] of Object.entries(M3_HUMAN_GATE_CONTRACTS)) {
    const gate = signoffs.gates?.[key];
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
      target.push(`M3: human-signoffs.json is missing ${key}`);
      continue;
    }
    if (gate.status !== missionGates[key]) target.push(`M3: ${key} sign-off status disagrees with mission.yaml`);
    if (gate.packet !== contract.packet) target.push(`M3: ${key} sign-off packet must equal ${contract.packet}`);
    const packetPath = path.join(missionDir, contract.packet);
    if (fs.existsSync(packetPath)) {
      const packet = fs.readFileSync(packetPath, "utf8");
      const packetVerdict = gate.status === "PASS" ? "PASS" : "AWAITING HUMAN";
      for (const exact of [
        candidate.previewUrl,
        candidate.previewDeploymentId,
        candidate.implementationSha,
        candidate.previewDatabaseFingerprint,
      ]) {
        if (typeof exact !== "string" || !packet.includes(exact)) {
          target.push(`M3: ${contract.packet} does not identify the exact reviewed candidate`);
          break;
        }
      }
      if (!packet.includes(`Current verdict: **${packetVerdict}**.`)) {
        target.push(`M3: ${contract.packet} verdict disagrees with human-signoffs.json`);
      }
      if (gate.status === "PASS") {
        for (const identity of [gate.attestation?.reviewer?.id, gate.attestation?.reviewer?.name]) {
          if (typeof identity !== "string" || !packet.includes(identity)) {
            target.push(`M3: ${contract.packet} does not record the reviewed human identity`);
            break;
          }
        }
      }
    }

    if (gate.status === "AWAITING_HUMAN_VERDICT") {
      if (gate.attestation !== null || gate.attestationFingerprint !== null) {
        target.push(`M3: ${key} awaiting gate cannot contain an attestation`);
      }
      continue;
    }
    if (gate.status !== "PASS") {
      target.push(`M3: ${key} sign-off status is invalid`);
      continue;
    }
    validateM3PassAttestation(key, contract, gate, candidate, target);
    if (typeof gate.attestation?.reviewer?.id === "string") reviewerIds.push(gate.attestation.reviewer.id);
  }
  if (reviewerIds.length === 3 && new Set(reviewerIds).size !== reviewerIds.length) {
    target.push("M3: Finance, Legal/Privacy, and Ritual SME require three distinct reviewers");
  }

  validateM3StateAgreement(
    missionDir,
    missionState,
    missionGates,
    implementationSha,
    previewDeploymentId,
    previewDatabaseFingerprint,
    target,
  );
}

function validateM3PassAttestation(key, contract, gate, candidate, target) {
  const attestation = gate.attestation;
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    target.push(`M3: ${key} PASS requires an attestation object`);
    return;
  }
  const expectedKeys = [
    "verdict",
    "reviewer",
    "source",
    "date",
    "reviewedPreviewUrl",
    "reviewedDeploymentId",
    "reviewedImplementationSha",
    "reviewedDatabaseFingerprint",
    "checklistAnswers",
    "scenarioResults",
  ];
  if (!hasExactKeys(attestation, expectedKeys)) target.push(`M3: ${key} attestation fields are incomplete or unexpected`);
  if (attestation.verdict !== "PASS") target.push(`M3: ${key} attestation verdict must equal PASS`);
  const reviewer = attestation.reviewer ?? {};
  if (!hasExactKeys(reviewer, ["id", "name", "role", "credentialReference", "experienceYears"])) {
    target.push(`M3: ${key} reviewer identity fields are incomplete or unexpected`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(reviewer.id ?? "")) {
    target.push(`M3: ${key} reviewer ID is invalid`);
  }
  if (typeof reviewer.name !== "string" || reviewer.name.trim().length < 3) {
    target.push(`M3: ${key} reviewer name is invalid`);
  }
  if (reviewer.role !== contract.role) target.push(`M3: ${key} reviewer role must equal ${contract.role}`);
  if (typeof reviewer.credentialReference !== "string" || reviewer.credentialReference.trim().length < 3) {
    target.push(`M3: ${key} reviewer credential reference is required`);
  }
  if (contract.role === "RITUAL_OPERATIONS_SME" && !(Number.isInteger(reviewer.experienceYears) && reviewer.experienceYears > 0)) {
    target.push("M3: Ritual SME reviewer experienceYears is required");
  }
  if (typeof attestation.source !== "string" || attestation.source.trim().length < 3) {
    target.push(`M3: ${key} attestation source is required`);
  }
  if (!Number.isFinite(Date.parse(attestation.date ?? ""))) target.push(`M3: ${key} attestation date is invalid`);
  if (attestation.reviewedPreviewUrl !== candidate.previewUrl) {
    target.push(`M3: ${key} attestation Preview URL does not match candidate`);
  }
  if (attestation.reviewedDeploymentId !== candidate.previewDeploymentId) {
    target.push(`M3: ${key} attestation deployment does not match candidate`);
  }
  if (attestation.reviewedImplementationSha !== candidate.implementationSha) {
    target.push(`M3: ${key} attestation SHA does not match candidate`);
  }
  if (attestation.reviewedDatabaseFingerprint !== candidate.previewDatabaseFingerprint) {
    target.push(`M3: ${key} attestation database fingerprint does not match candidate`);
  }
  const answers = Array.isArray(attestation.checklistAnswers) ? attestation.checklistAnswers : [];
  const answerIds = answers.map((answer) => answer?.id);
  const actual = [...answerIds].sort();
  const expected = [...contract.checklist].sort();
  if (
    actual.length !== expected.length
    || new Set(actual).size !== actual.length
    || actual.some((id, index) => id !== expected[index])
  ) {
    target.push(`M3: ${key} attestation must answer the exact role checklist`);
  }
  for (const answer of answers) {
    if (!hasExactKeys(answer, ["id", "verdict", "notes"]) || answer.verdict !== "PASS" || String(answer.notes ?? "").trim().length < 3) {
      target.push(`M3: ${key} checklist answers must be complete PASS records`);
      break;
    }
  }
  for (const scenario of ["cremation", "familyPlotBurial"]) {
    const result = attestation.scenarioResults?.[scenario];
    if (!hasExactKeys(result, ["verdict", "notes"]) || result.verdict !== "PASS" || String(result.notes ?? "").trim().length < 3) {
      target.push(`M3: ${key} ${scenario} scenario result must be a complete PASS record`);
    }
  }
  if (!hasExactKeys(attestation.scenarioResults, ["cremation", "familyPlotBurial"])) {
    target.push(`M3: ${key} scenario results are incomplete or unexpected`);
  }
  const fingerprint = canonicalFingerprint(attestation);
  if (gate.attestationFingerprint !== fingerprint) {
    target.push(`M3: ${key} attestation fingerprint does not match its canonical content`);
  }
}

function validateM3StateAgreement(
  missionDir,
  missionState,
  missionGates,
  implementationSha,
  previewDeploymentId,
  previewDatabaseFingerprint,
  target,
) {
  const releasePath = path.join(missionDir, "release.md");
  if (fs.existsSync(releasePath) && !fs.readFileSync(releasePath, "utf8").includes(`\`${missionState}\``)) {
    target.push("M3: release.md terminal state disagrees with mission.yaml");
  }
  for (const jsonName of ["acceptance.json", "test-results.json"]) {
    const jsonPath = path.join(missionDir, jsonName);
    if (!fs.existsSync(jsonPath)) continue;
    let value;
    try {
      value = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch {
      continue;
    }
    if (value.state !== missionState) target.push(`M3: ${jsonName} state disagrees with mission.yaml`);
    if (jsonName === "test-results.json") {
      if (value.implementationSha !== implementationSha) {
        target.push("M3: test-results.json implementation SHA disagrees with mission.yaml");
      }
      if (value.previewDeploymentId !== previewDeploymentId) {
        target.push("M3: test-results.json Preview deployment disagrees with mission.yaml");
      }
      if (value.previewDatabaseFingerprint !== previewDatabaseFingerprint) {
        target.push("M3: test-results.json Preview database fingerprint disagrees with mission.yaml");
      }
      for (const [key, expected] of Object.entries(missionGates)) {
        if (value.humanGates?.[key] !== expected) {
          target.push(`M3: test-results.json ${key} human gate disagrees with mission.yaml`);
        }
      }
    }
  }
}

function missionTopLevelScalar(text, key) {
  return uniqueScalar(text, new RegExp(`^${escapePattern(key)}:\\s*(\\S+)\\s*$`, "gm"));
}

function missionNestedScalar(text, section, key) {
  const lines = text.split(/\r?\n/);
  let sectionCount = 0;
  const values = [];
  let inside = false;
  for (const line of lines) {
    if (line === `${section}:`) {
      sectionCount += 1;
      inside = true;
      continue;
    }
    if (inside && line && !/^\s/.test(line)) inside = false;
    if (!inside) continue;
    const match = new RegExp(`^  ${escapePattern(key)}:\\s*(\\S+)\\s*$`).exec(line);
    if (match) values.push(match[1]);
  }
  return sectionCount === 1 && values.length === 1 ? values[0] : "";
}

function uniqueScalar(text, pattern) {
  const values = [...text.matchAll(pattern)].map((match) => match[1]);
  return values.length === 1 ? values[0] : "";
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalFingerprint(value) {
  const canonicalize = (nested) => {
    if (Array.isArray(nested)) return nested.map(canonicalize);
    if (nested && typeof nested === "object") {
      return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)).map(
        ([key, item]) => [key, canonicalize(item)],
      ));
    }
    return nested;
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

/** Every value under a `status`/`state` key, at any depth. */
function statusValues(node) {
  const found = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if ((key === "status" || key === "state") && typeof nested === "string") found.push(nested);
      walk(nested);
    }
  };
  walk(node);
  return found;
}

/**
 * The commit the evidence must describe. On a pull_request, actions/checkout leaves HEAD at
 * refs/pull/N/merge — base merged into the branch — so comparing against HEAD would fail the
 * moment any unrelated commit lands on main, reading as an evidence violation caused by this
 * mission. The workflow passes the PR head as PR_HEAD_SHA;
 * GITHUB_* is a reserved prefix, so it cannot be used for this.
 */
function reviewedSha() {
  return process.env.PR_HEAD_SHA?.trim() || "HEAD";
}

/** True when `sha` and the reviewed commit differ only under docs/evidence. */
function hasSameSourceTreeAsHead(sha) {
  try {
    execFileSync("git", ["diff", "--quiet", sha, reviewedSha(), "--", ".", ":(exclude)docs/evidence"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isAncestor(sha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, reviewedSha()], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("Mission evidence schema: PASS\n");
