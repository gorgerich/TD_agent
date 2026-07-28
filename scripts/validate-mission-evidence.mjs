import fs from "node:fs";
import path from "node:path";

const root = path.resolve("docs/evidence/missions");
const errors = [];
for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const missionDir = path.join(root, directory.name);
  for (const required of ["mission.yaml", "implementation.md", "test-results.json", "acceptance.json", "migration.md", "security.md", "ux-uat.md", "review.md", "release.md"]) {
    if (!fs.existsSync(path.join(missionDir, required))) errors.push(`${directory.name}: missing ${required}`);
  }
  for (const jsonName of ["test-results.json", "acceptance.json"]) {
    const jsonPath = path.join(missionDir, jsonName);
    if (!fs.existsSync(jsonPath)) continue;
    const value = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const serialized = JSON.stringify(value);
    if (serialized.includes("NOT_RUN")) errors.push(`${directory.name}/${jsonName}: NOT_RUN is forbidden`);
    if (jsonName === "test-results.json") {
      if (value.checks?.skipped !== 0) errors.push(`${directory.name}: skipped must equal 0`);
      if (value.checks?.notRun !== 0) errors.push(`${directory.name}: notRun must equal 0`);
    }
    if (jsonName === "acceptance.json") {
      for (const item of value.acceptance ?? []) {
        if (item.status !== "PASS") errors.push(`${directory.name}: ${item.id ?? "acceptance"} is not PASS`);
      }
    }
  }
}

if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("Mission evidence schema: PASS\n");
