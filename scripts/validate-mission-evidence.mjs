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
  const released = fs.existsSync(missionYamlPath)
    && /^state:\s*RELEASED\s*$/m.test(fs.readFileSync(missionYamlPath, "utf8"));
  for (const required of ["mission.yaml", "implementation.md", "test-results.json", "acceptance.json", "migration.md", "security.md", "ux-uat.md", "review.md", "release.md"]) {
    if (!fs.existsSync(path.join(missionDir, required))) errors.push(`${directory.name}: missing ${required}`);
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
      } else if (requiresTerminalEvidence && !hasSameSourceTreeAsHead(value.implementationSha)) {
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

/** True when `sha` and HEAD differ only under docs/evidence. */
function hasSameSourceTreeAsHead(sha) {
  try {
    execFileSync("git", ["diff", "--quiet", sha, "HEAD", "--", ".", ":(exclude)docs/evidence"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isAncestor(sha) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { stdio: "ignore" });
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
