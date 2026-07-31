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
  for (const required of ["mission.yaml", "implementation.md", "test-results.json", "acceptance.json", "migration.md", "security.md", "ux-uat.md", "review.md", "release.md"]) {
    if (!fs.existsSync(path.join(missionDir, required))) errors.push(`${directory.name}: missing ${required}`);
  }
  for (const jsonName of ["test-results.json", "acceptance.json"]) {
    const jsonPath = path.join(missionDir, jsonName);
    if (!fs.existsSync(jsonPath)) continue;
    const value = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const serialized = JSON.stringify(value);
    if (requiresTerminalEvidence && serialized.includes("NOT_RUN")) {
      errors.push(`${directory.name}/${jsonName}: NOT_RUN is forbidden for terminal evidence`);
    }
    if (jsonName === "test-results.json") {
      if (requiresTerminalEvidence && value.checks?.skipped !== 0) errors.push(`${directory.name}: skipped must equal 0`);
      if (requiresTerminalEvidence && value.checks?.notRun !== 0) errors.push(`${directory.name}: notRun must equal 0`);
      if (requiresTerminalEvidence) {
        if (typeof value.implementationSha !== "string" || !/^[0-9a-f]{40}$/.test(value.implementationSha)) {
          errors.push(`${directory.name}: implementationSha must be a full commit SHA`);
        } else if (!isAncestor(value.implementationSha)) {
          errors.push(`${directory.name}: implementationSha is not an ancestor of HEAD`);
        }
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
