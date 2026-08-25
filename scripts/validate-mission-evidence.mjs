import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve("docs/evidence/missions");
const errors = [];
const requiredMission = process.env.REQUIRED_MISSION_EVIDENCE;
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
  const missionState = missionText
    ? (/^state:\s*(\S+)\s*$/m.exec(missionText)?.[1] ?? "")
    : "";
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
  // The mission currently being released must retain source parity even after it reaches
  // MISSION_RELEASE_READY. Other release-ready missions are frozen historical records.
  const requiresSourceParity = missionState !== ""
    && !released
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
    ...(directory.name === "M3" ? ["finance.md", "privacy.md", "ritual-rules.md"] : []),
  ];
  for (const required of requiredFiles) {
    if (!fs.existsSync(path.join(missionDir, required))) errors.push(`${directory.name}: missing ${required}`);
  }
  if (directory.name === "M3") validateM3HumanReleaseBoundary(missionText, missionState, errors);
  for (const jsonName of ["test-results.json", "acceptance.json"]) {
    const jsonPath = path.join(missionDir, jsonName);
    if (!fs.existsSync(jsonPath)) continue;
    const value = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    // These hold for EVERY mission that records results at all, not only the terminal one.
    // Gating them on requiredMission meant a mission could certify a SHA that is not in
    // this history, or record skipped tests, with nothing to catch it.
    // Look at status-bearing values, not the serialized blob: an acceptance *requirement*
    // may legitimately contain the words "NOT_RUN=0" as prose.
    if (!released && statusValues(value).includes("NOT_RUN")) {
      errors.push(`${directory.name}/${jsonName}: NOT_RUN is forbidden`);
    }
    if (jsonName === "test-results.json" && !released) {
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

function validateM3HumanReleaseBoundary(missionText, missionState, target) {
  const gates = {
    finance: missionScalar(missionText, "finance_accounting"),
    legalPrivacy: missionScalar(missionText, "legal_privacy"),
    ritualSme: missionScalar(missionText, "ritual_operations_sme"),
  };
  const releaseAuthorized = missionScalar(missionText, "production_release_authorized");
  const productionRelease = missionScalar(missionText, "production_release");
  const requireAllGates = (expected) => {
    for (const [gate, actual] of Object.entries(gates)) {
      if (actual !== expected) target.push(`M3: ${gate} human gate must equal ${expected}`);
    }
  };

  if (missionState === "BLOCKED_HUMAN_JUDGMENT") {
    requireAllGates("AWAITING_HUMAN_VERDICT");
    if (releaseAuthorized !== "false") {
      target.push("M3: BLOCKED_HUMAN_JUDGMENT requires production_release_authorized=false");
    }
    if (productionRelease !== "NOT_PERFORMED") {
      target.push("M3: BLOCKED_HUMAN_JUDGMENT requires production_release=NOT_PERFORMED");
    }
    return;
  }

  if (missionState === "MISSION_RELEASE_READY") {
    requireAllGates("PASS");
    if (releaseAuthorized !== "false") {
      target.push("M3: MISSION_RELEASE_READY requires production_release_authorized=false");
    }
    if (productionRelease !== "NOT_PERFORMED") {
      target.push("M3: MISSION_RELEASE_READY requires production_release=NOT_PERFORMED");
    }
    return;
  }

  if (missionState === "RELEASED") {
    requireAllGates("PASS");
    if (releaseAuthorized !== "true") {
      target.push("M3: RELEASED requires production_release_authorized=true");
    }
    if (productionRelease !== "RELEASED") {
      target.push("M3: RELEASED requires production_release=RELEASED");
    }
  }
}

function missionScalar(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*${escaped}:\\s*(\\S+)\\s*$`, "m").exec(text)?.[1] ?? "";
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
