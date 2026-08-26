import fs from "node:fs";
import path from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve("docs/evidence/missions");
const errors = [];
const requiredMission = process.env.REQUIRED_MISSION_EVIDENCE;
const M3_REQUIRED_GATES = [
  "code_quality",
  "unit",
  "integration",
  "e2e",
  "migration_rehearsal",
  "schema_parity",
  "tenant_rbac",
  "document_access_storage",
  "ledger_idempotency_concurrency",
  "stage_guards",
  "reconciliation",
  "accessibility_mobile",
  "preview_uat",
  "independent_review",
];
const M3_REQUIRED_ACCEPTANCE_IDS = [
  "M3-W7-01",
  "M3-W7-02",
  "M3-W7-03",
  "M3-W7-04",
  "M3-W7-05",
  "M3-W6-01",
  "M3-W6-02",
  "M3-W6-03",
  "M3-W6-04",
  "M3-W6-05",
  "M3-GUARD-01",
  "M3-RECON-01",
  "M3-SEC-01",
  "M3-MIG-01",
  "M3-UX-01",
  "M3-UAT-01",
  "M3-REVIEW-01",
  "M3-GATE-01",
];
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
  const previewDeploymentSha = missionTopLevelScalar(missionText, "preview_deployment_sha");
  const previewUrl = missionTopLevelScalar(missionText, "preview_url");
  const previewDatabaseFingerprint = missionTopLevelScalar(missionText, "preview_database_fingerprint");
  const sourceCi = missionTopLevelScalar(missionText, "source_ci");

  if (!/^[0-9a-f]{40}$/.test(implementationSha)) target.push("M3: mission implementation_sha is invalid");
  if (!/^dpl_[A-Za-z0-9]{8,}$/.test(previewDeploymentId)) target.push("M3: mission Preview deployment ID is invalid");
  if (!/^[0-9a-f]{40}$/.test(previewDeploymentSha)) target.push("M3: mission preview_deployment_sha is invalid");
  if (!isExactPreviewUrl(previewUrl)) target.push("M3: mission Preview URL is invalid");
  if (!/^[0-9a-f]{16}$/.test(previewDatabaseFingerprint)) target.push("M3: mission Preview database fingerprint is invalid");
  if (!/^https:\/\/github\.com\/gorgerich\/TD_agent\/actions\/runs\/\d+$/.test(sourceCi)) {
    target.push("M3: mission source_ci must be an exact TD_agent GitHub Actions run URL");
  }

  assertExactSet(missionNestedList(missionText, "required_gates"), M3_REQUIRED_GATES, "M3 required_gates", target);
  assertExactSet(missionNestedList(missionText, "passed_gates"), M3_REQUIRED_GATES, "M3 passed_gates", target);

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
  if (!fs.existsSync(signoffsPath)) {
    validateM3DeterministicEvidence(
      missionDir,
      missionState,
      implementationSha,
      previewDeploymentId,
      previewDeploymentSha,
      previewUrl,
      previewDatabaseFingerprint,
      sourceCi,
      target,
    );
    return;
  }
  let signoffs;
  try {
    signoffs = JSON.parse(fs.readFileSync(signoffsPath, "utf8"));
  } catch {
    target.push("M3: human-signoffs.json must be valid JSON");
    return;
  }
  if (!hasExactKeys(signoffs, ["schemaVersion", "candidate", "policyContentFingerprint", "gates"])) {
    target.push("M3: human-signoffs.json fields are incomplete or unexpected");
  }
  if (signoffs.schemaVersion !== 2) target.push("M3: human-signoffs.json schemaVersion must equal 2");
  const candidate = signoffs.candidate ?? {};
  if (!hasExactKeys(candidate, ["previewUrl", "deploymentId", "deploymentSha", "implementationSha", "databaseFingerprint"])) {
    target.push("M3: human sign-off candidate fields are incomplete or unexpected");
  }
  if (!/^dpl_[A-Za-z0-9]{8,}$/.test(candidate.deploymentId ?? "")) target.push("M3: human sign-off deployment ID is invalid");
  if (!/^[0-9a-f]{40}$/.test(candidate.deploymentSha ?? "")) target.push("M3: human sign-off deployment SHA is invalid");
  if (!/^[0-9a-f]{40}$/.test(candidate.implementationSha ?? "")) target.push("M3: human sign-off implementation SHA is invalid");
  if (candidate.implementationSha !== implementationSha) {
    target.push("M3: human sign-off implementation SHA must match mission.yaml");
  }
  if (candidate.deploymentId !== previewDeploymentId) {
    target.push("M3: human sign-off Preview deployment must match mission.yaml");
  }
  if (candidate.deploymentSha !== previewDeploymentSha) {
    target.push("M3: human sign-off Preview deployment SHA must match mission.yaml");
  }
  if (candidate.previewUrl !== previewUrl) {
    target.push("M3: human sign-off Preview URL must match mission.yaml");
  }
  if (candidate.databaseFingerprint !== previewDatabaseFingerprint) {
    target.push("M3: human sign-off Preview database fingerprint must match mission.yaml");
  }
  if (!/^[0-9a-f]{16}$/.test(candidate.databaseFingerprint ?? "")) {
    target.push("M3: human sign-off Preview database fingerprint is invalid");
  }
  if (!isExactPreviewUrl(candidate.previewUrl)) target.push("M3: human sign-off Preview URL is invalid");
  if (expectedGate === "PASS" && !/^[0-9a-f]{64}$/.test(signoffs.policyContentFingerprint ?? "")) {
    target.push("M3: PASS human sign-offs require an exact policy content fingerprint");
  }
  if (expectedGate === "AWAITING_HUMAN_VERDICT" && signoffs.policyContentFingerprint !== null) {
    target.push("M3: awaiting human sign-offs cannot claim a policy content fingerprint");
  }
  if (!hasExactKeys(signoffs.gates, Object.keys(M3_HUMAN_GATE_CONTRACTS))) {
    target.push("M3: human-signoffs gates are incomplete or unexpected");
  }

  const reviewerIds = [];
  const reviewerNames = [];
  const reviewerCredentials = [];
  const reviewerKeys = [];
  for (const [key, contract] of Object.entries(M3_HUMAN_GATE_CONTRACTS)) {
    const gate = signoffs.gates?.[key];
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) {
      target.push(`M3: human-signoffs.json is missing ${key}`);
      continue;
    }
    if (!hasExactKeys(gate, ["status", "packet", "attestation", "attestationFingerprint"])) {
      target.push(`M3: ${key} gate fields are incomplete or unexpected`);
    }
    if (gate.status !== missionGates[key]) target.push(`M3: ${key} sign-off status disagrees with mission.yaml`);
    if (gate.packet !== contract.packet) target.push(`M3: ${key} sign-off packet must equal ${contract.packet}`);
    const packetPath = path.join(missionDir, contract.packet);
    if (fs.existsSync(packetPath)) validateM3HumanPacket(packetPath, key, contract, gate, candidate, target);

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
    validateM3PassAttestation(
      key,
      contract,
      gate,
      { ...candidate, policyContentFingerprint: signoffs.policyContentFingerprint },
      target,
    );
    if (typeof gate.attestation?.reviewer?.id === "string") reviewerIds.push(normalizeIdentity(gate.attestation.reviewer.id));
    if (typeof gate.attestation?.reviewer?.name === "string") reviewerNames.push(normalizeIdentity(gate.attestation.reviewer.name));
    if (typeof gate.attestation?.reviewer?.credentialReference === "string") reviewerCredentials.push(gate.attestation.reviewer.credentialReference);
    if (typeof gate.attestation?.signature?.keyFingerprint === "string") reviewerKeys.push(gate.attestation.signature.keyFingerprint);
  }
  for (const values of [reviewerIds, reviewerNames, reviewerCredentials, reviewerKeys]) {
    if (values.length === 3 && new Set(values).size !== values.length) {
      target.push("M3: Finance, Legal/Privacy, and Ritual SME require three distinct reviewers and credentials");
      break;
    }
  }

  validateM3StateAgreement(
    missionDir,
    missionState,
    missionGates,
    implementationSha,
    previewDeploymentId,
    previewDeploymentSha,
    previewUrl,
    previewDatabaseFingerprint,
    sourceCi,
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
    "reviewedDeploymentSha",
    "reviewedImplementationSha",
    "reviewedDatabaseFingerprint",
    "reviewedPolicyContentFingerprint",
    "checklistAnswers",
    "scenarioResults",
    "signature",
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
  if (typeof reviewer.name !== "string" || reviewer.name.trim().length < 3 || reviewer.name.trim().length > 160) {
    target.push(`M3: ${key} reviewer name is invalid`);
  }
  if (reviewer.role !== contract.role) target.push(`M3: ${key} reviewer role must equal ${contract.role}`);
  if (!/^platform-audit-key:[0-9a-f]{64}$/.test(reviewer.credentialReference ?? "")) {
    target.push(`M3: ${key} reviewer credential reference is required`);
  }
  if (contract.role === "RITUAL_OPERATIONS_SME" && !(Number.isInteger(reviewer.experienceYears) && reviewer.experienceYears > 0 && reviewer.experienceYears <= 80)) {
    target.push("M3: Ritual SME reviewer experienceYears is required");
  }
  if (reviewer.experienceYears !== null && !(Number.isInteger(reviewer.experienceYears) && reviewer.experienceYears > 0 && reviewer.experienceYears <= 80)) {
    target.push(`M3: ${key} reviewer experienceYears is invalid`);
  }
  if (typeof attestation.source !== "string" || attestation.source.trim().length < 3 || attestation.source.trim().length > 500) {
    target.push(`M3: ${key} attestation source is required`);
  }
  if (!isIsoDateTime(attestation.date)) target.push(`M3: ${key} attestation date is invalid`);
  if (attestation.reviewedPreviewUrl !== candidate.previewUrl) {
    target.push(`M3: ${key} attestation Preview URL does not match candidate`);
  }
  if (attestation.reviewedDeploymentId !== candidate.deploymentId) {
    target.push(`M3: ${key} attestation deployment does not match candidate`);
  }
  if (attestation.reviewedDeploymentSha !== candidate.deploymentSha) {
    target.push(`M3: ${key} attestation deployment SHA does not match candidate`);
  }
  if (attestation.reviewedImplementationSha !== candidate.implementationSha) {
    target.push(`M3: ${key} attestation SHA does not match candidate`);
  }
  if (attestation.reviewedDatabaseFingerprint !== candidate.databaseFingerprint) {
    target.push(`M3: ${key} attestation database fingerprint does not match candidate`);
  }
  if (attestation.reviewedPolicyContentFingerprint !== candidate.policyContentFingerprint) {
    target.push(`M3: ${key} attestation policy content fingerprint does not match candidate`);
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
    const notesLength = String(answer?.notes ?? "").trim().length;
    if (
      !hasExactKeys(answer, ["id", "verdict", "notes"])
      || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(answer?.id ?? "")
      || answer.verdict !== "PASS"
      || notesLength < 3
      || notesLength > 1_000
    ) {
      target.push(`M3: ${key} checklist answers must be complete PASS records`);
      break;
    }
  }
  for (const scenario of ["cremation", "familyPlotBurial"]) {
    const result = attestation.scenarioResults?.[scenario];
    const notesLength = String(result?.notes ?? "").trim().length;
    if (!hasExactKeys(result, ["verdict", "notes"]) || result.verdict !== "PASS" || notesLength < 3 || notesLength > 1_000) {
      target.push(`M3: ${key} ${scenario} scenario result must be a complete PASS record`);
    }
  }
  if (!hasExactKeys(attestation.scenarioResults, ["cremation", "familyPlotBurial"])) {
    target.push(`M3: ${key} scenario results are incomplete or unexpected`);
  }
  const signature = attestation.signature ?? {};
  if (!hasExactKeys(signature, ["algorithm", "keyFingerprint", "publicKeyPem", "value"])) {
    target.push(`M3: ${key} attestation signature fields are incomplete or unexpected`);
  }
  if (signature.algorithm !== "Ed25519" || !/^[0-9a-f]{64}$/.test(signature.keyFingerprint ?? "")) {
    target.push(`M3: ${key} attestation signature metadata is invalid`);
  }
  if (!/^[A-Za-z0-9_-]{64,256}$/.test(signature.value ?? "")) {
    target.push(`M3: ${key} attestation signature value is invalid`);
  }
  if (
    typeof signature.publicKeyPem !== "string"
    || signature.publicKeyPem.length < 80
    || signature.publicKeyPem.length > 2_000
    || !signature.publicKeyPem.startsWith("-----BEGIN PUBLIC KEY-----")
    || !signature.publicKeyPem.endsWith("-----END PUBLIC KEY-----")
  ) {
    target.push(`M3: ${key} reviewer public key encoding is invalid`);
  }
  try {
    const publicKey = createPublicKey(signature.publicKeyPem);
    const keyFingerprint = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
    if (publicKey.asymmetricKeyType !== "ed25519" || keyFingerprint !== signature.keyFingerprint) {
      target.push(`M3: ${key} reviewer public key fingerprint is invalid`);
    }
    if (reviewer.credentialReference !== `platform-audit-key:${keyFingerprint}`) {
      target.push(`M3: ${key} reviewer credential reference does not bind the signing key`);
    }
    const signedPayload = Object.fromEntries(Object.entries(attestation).filter(([field]) => field !== "signature"));
    if (!verify(null, Buffer.from(canonicalString(signedPayload)), publicKey, Buffer.from(signature.value, "base64url"))) {
      target.push(`M3: ${key} attestation signature verification failed`);
    }
  } catch {
    target.push(`M3: ${key} reviewer public key is invalid`);
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
  previewDeploymentSha,
  previewUrl,
  previewDatabaseFingerprint,
  sourceCi,
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
      if (value.previewDeploymentSha !== previewDeploymentSha) {
        target.push("M3: test-results.json Preview deployment SHA disagrees with mission.yaml");
      }
      if (value.previewUrl !== previewUrl) {
        target.push("M3: test-results.json Preview URL disagrees with mission.yaml");
      }
      if (value.previewDatabaseFingerprint !== previewDatabaseFingerprint) {
        target.push("M3: test-results.json Preview database fingerprint disagrees with mission.yaml");
      }
      if (value.githubCiUrl !== sourceCi) target.push("M3: test-results.json source CI disagrees with mission.yaml");
      for (const [key, expected] of Object.entries(missionGates)) {
        if (value.humanGates?.[key] !== expected) {
          target.push(`M3: test-results.json ${key} human gate disagrees with mission.yaml`);
        }
      }
    }
  }
  validateM3DeterministicEvidence(
    missionDir,
    missionState,
    implementationSha,
    previewDeploymentId,
    previewDeploymentSha,
    previewUrl,
    previewDatabaseFingerprint,
    sourceCi,
    target,
  );
}

function validateM3HumanPacket(packetPath, key, contract, gate, candidate, target) {
  const packetName = path.basename(packetPath);
  const text = fs.readFileSync(packetPath, "utf8");
  if (text.includes("<!--")) target.push(`M3: ${packetName} cannot contain hidden HTML comments`);
  const parsed = parseExactFrontmatter(text);
  if (!parsed) {
    target.push(`M3: ${packetName} requires one exact machine-readable frontmatter block`);
    return;
  }
  const expectedKeys = [
    "schema",
    "gate",
    "preview_url",
    "deployment_id",
    "deployment_sha",
    "implementation_sha",
    "database_fingerprint",
    "current_verdict",
    "reviewer_id",
    "reviewer_name",
    "attestation_fingerprint",
  ];
  if (!hasExactKeys(parsed.values, expectedKeys)) {
    target.push(`M3: ${packetName} frontmatter fields are incomplete or unexpected`);
  }
  const reviewer = gate.status === "PASS" ? gate.attestation?.reviewer : null;
  const expected = {
    schema: "m3-human-packet-v2",
    gate: key,
    preview_url: candidate.previewUrl,
    deployment_id: candidate.deploymentId,
    deployment_sha: candidate.deploymentSha,
    implementation_sha: candidate.implementationSha,
    database_fingerprint: candidate.databaseFingerprint,
    current_verdict: gate.status,
    reviewer_id: reviewer?.id ?? "null",
    reviewer_name: reviewer?.name ?? "null",
    attestation_fingerprint: gate.attestationFingerprint ?? "null",
  };
  if (canonicalFingerprint(parsed.values) !== canonicalFingerprint(expected)) {
    target.push(`M3: ${packetName} frontmatter does not exactly identify current human verdict and candidate`);
  }

  const checklistRows = [...parsed.body.matchAll(/^- \[([ xX])\] ([a-z0-9][a-z0-9-]{2,79}):\s+.+$/gm)]
    .map((match) => ({ checked: match[1].toLowerCase() === "x", id: match[2] }));
  const requiredRows = [...contract.checklist, "scenario-cremation", "scenario-family-plot-burial"];
  assertExactSet(checklistRows.map((row) => row.id), requiredRows, `M3 ${packetName} checklist`, target);
  const expectedChecked = gate.status === "PASS";
  if (checklistRows.some((row) => row.checked !== expectedChecked)) {
    target.push(`M3: ${packetName} checklist marks disagree with human-signoffs status`);
  }
}

function parseExactFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0 || normalized.indexOf("\n---\n", end + 5) >= 0) return null;
  const values = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) return null;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[a-z_]+$/.test(key) || !value || Object.hasOwn(values, key)) return null;
    values[key] = value;
  }
  return { values, body: normalized.slice(end + 5) };
}

function validateM3DeterministicEvidence(
  missionDir,
  missionState,
  implementationSha,
  previewDeploymentId,
  previewDeploymentSha,
  previewUrl,
  previewDatabaseFingerprint,
  sourceCi,
  target,
) {
  const acceptance = readJson(path.join(missionDir, "acceptance.json"), "M3 acceptance.json", target);
  if (acceptance) {
    if (acceptance.state !== missionState) target.push("M3: acceptance.json state disagrees with mission.yaml");
    const records = Array.isArray(acceptance.acceptance) ? acceptance.acceptance : [];
    assertExactSet(records.map((item) => item?.id), M3_REQUIRED_ACCEPTANCE_IDS, "M3 acceptance IDs", target);
    for (const record of records) {
      if (!record || record.status !== "PASS" || String(record.requirement ?? "").trim().length < 10 || String(record.evidence ?? "").trim().length < 10) {
        target.push(`M3: ${record?.id ?? "acceptance"} must be a complete PASS record`);
      }
    }
  }

  const results = readJson(path.join(missionDir, "test-results.json"), "M3 test-results.json", target);
  if (!results) return;
  if (results.state !== missionState) target.push("M3: test-results.json state disagrees with mission.yaml");
  if (results.implementationSha !== implementationSha) target.push("M3: test-results implementation SHA mismatch");
  if (results.githubCiUrl !== sourceCi) target.push("M3: test-results source CI mismatch");
  if (results.previewDeploymentId !== previewDeploymentId) target.push("M3: test-results Preview deployment mismatch");
  if (results.previewDeploymentSha !== previewDeploymentSha) target.push("M3: test-results Preview deployment SHA mismatch");
  if (results.previewUrl !== previewUrl) target.push("M3: test-results Preview URL mismatch");
  if (results.previewDatabaseFingerprint !== previewDatabaseFingerprint) target.push("M3: test-results Preview database fingerprint mismatch");

  const checks = results.checks ?? {};
  if (
    checks.sourceCi?.status !== "PASS"
    || checks.sourceCi?.headSha !== implementationSha
    || checks.sourceCi?.testSkipped !== 0
    || Number(checks.sourceCi?.runId) !== Number(sourceCi.split("/").pop())
  ) {
    target.push("M3: source CI must be exact-head PASS with skipped=0");
  }
  for (const key of ["gitDiffCheck", "prismaGenerate", "typecheck", "lint", "build", "schemaParity", "stageGuards", "tenantRbac", "evidenceSchema"]) {
    if (checks[key] !== "PASS") target.push(`M3: checks.${key} must equal PASS`);
  }
  for (const key of ["unit", "integration", "e2e", "migrationRehearsal", "documentTruth", "financeTruth", "reconciliation", "accessibility", "previewUat", "independentReview", "discoveryParity"]) {
    if (checks[key]?.status !== "PASS") target.push(`M3: checks.${key}.status must equal PASS`);
  }
  if (!(Number.isInteger(checks.unit?.passed) && checks.unit.passed > 0) || checks.unit?.skipped !== 0) {
    target.push("M3: unit gate must report positive passed count and skipped=0");
  }
  if (!(Number.isInteger(checks.integration?.passed) && checks.integration.passed > 0) || checks.integration?.skipped !== 0 || checks.integration?.residue !== 0) {
    target.push("M3: integration gate must report positive passed count, skipped=0, residue=0");
  }
  if (checks.e2e?.skipped !== 0) target.push("M3: E2E skipped must equal 0");
  if (checks.migrationRehearsal?.repeatedDeploy !== "NO_OP" || checks.migrationRehearsal?.orphans !== 0 || checks.migrationRehearsal?.duplicates !== 0 || checks.migrationRehearsal?.tenantMismatches !== 0) {
    target.push("M3: migration rehearsal must prove no-op, zero orphans/duplicates/tenant mismatches");
  }
  if (checks.reconciliation?.discrepancies !== 0) target.push("M3: reconciliation discrepancies must equal 0");
  if (checks.accessibility?.critical !== 0 || checks.accessibility?.serious !== 0 || checks.accessibility?.mobile !== "PASS" || checks.accessibility?.zoom200 !== "PASS" || checks.accessibility?.horizontalOverflow !== 0) {
    target.push("M3: accessibility/mobile gate is incomplete");
  }
  if (checks.independentReview?.reviewedSha !== implementationSha || checks.independentReview?.p0 !== 0 || checks.independentReview?.p1 !== 0) {
    target.push("M3: independent review must bind exact implementation with p0=0 and p1=0");
  }
  if (
    checks.previewUat?.deploymentId !== previewDeploymentId
    || checks.previewUat?.deploymentSha !== previewDeploymentSha
    || checks.previewUat?.previewUrl !== previewUrl
    || checks.previewUat?.databaseFingerprint !== previewDatabaseFingerprint
    || checks.previewUat?.skipped !== 0
    || checks.previewUat?.unexpected5xx !== 0
  ) {
    target.push("M3: Preview UAT must bind exact deployment/SHA/DB with skipped=0 and unexpected5xx=0");
  }
  if (checks.skipped !== 0 || checks.notRun !== 0) target.push("M3: terminal checks require skipped=0 and notRun=0");
  if (results.production?.writes !== "NONE" || results.production?.databaseSchemaChanges !== "NONE" || results.production?.deployment !== "UNCHANGED") {
    target.push("M3: technical mission evidence must prove Production unchanged");
  }
}

function readJson(filePath, label, target) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    target.push(`${label} must be valid JSON`);
    return null;
  }
}

function assertExactSet(actual, expected, label, target) {
  const normalized = actual.filter((value) => typeof value === "string");
  const sortedActual = [...normalized].sort();
  const sortedExpected = [...expected].sort();
  if (
    normalized.length !== actual.length
    || new Set(normalized).size !== normalized.length
    || sortedActual.length !== sortedExpected.length
    || sortedActual.some((value, index) => value !== sortedExpected[index])
  ) {
    target.push(`${label} must contain the exact required unique set`);
  }
}

function isExactPreviewUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".vercel.app") && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function isIsoDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function normalizeIdentity(value) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
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

function missionNestedList(text, section) {
  const lines = text.split(/\r?\n/);
  let sectionCount = 0;
  let inside = false;
  const values = [];
  for (const line of lines) {
    if (line === `${section}:`) {
      sectionCount += 1;
      inside = true;
      continue;
    }
    if (inside && line && !/^\s/.test(line)) inside = false;
    if (!inside) continue;
    const match = /^  -\s+([A-Za-z0-9_-]+)\s*$/.exec(line);
    if (match) values.push(match[1]);
    else if (line.trim()) return [];
  }
  return sectionCount === 1 ? values : [];
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

function canonicalString(value) {
  const canonicalize = (nested) => {
    if (Array.isArray(nested)) return nested.map(canonicalize);
    if (nested && typeof nested === "object") {
      return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)).map(
        ([key, item]) => [key, canonicalize(item)],
      ));
    }
    return nested;
  };
  return JSON.stringify(canonicalize(value));
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
