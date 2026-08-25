import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

test("MISSION_RELEASE_READY still rejects evidence for a stale source tree", () => {
  const root = createEvidenceRepository(releaseReadyMission());
  try {
    assert.equal(runValidator(root).status, 0);
    writeFileSync(join(root, "lib", "runtime.ts"), "export const runtime = 2;\n");
    git(root, "add", "lib/runtime.ts");
    git(root, "commit", "-m", "unreviewed source change");
    const stale = runValidator(root);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /source changes relative to HEAD/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("M3 terminal states fail closed around all three human decisions", () => {
  const root = createEvidenceRepository(blockedHumanMission());
  const missionPath = join(root, "docs", "evidence", "missions", "M3", "mission.yaml");
  const financePacket = join(root, "docs", "evidence", "missions", "M3", "finance.md");
  try {
    assert.equal(runValidator(root).status, 0);

    writeFileSync(missionPath, blockedHumanMission().replace("BLOCKED_HUMAN_JUDGMENT", "MISSION_RELEASE_READY"));
    const pendingReady = runValidator(root);
    assert.notEqual(pendingReady.status, 0);
    assert.match(pendingReady.stderr, /human gate must equal PASS/);

    writeFileSync(missionPath, releaseReadyMission());
    assert.equal(runValidator(root).status, 0);

    rmSync(financePacket);
    const missingPacket = runValidator(root);
    assert.notEqual(missingPacket.status, 0);
    assert.match(missingPacket.stderr, /missing finance\.md/);
    writeFileSync(financePacket, "# Synthetic finance packet\n");

    writeFileSync(missionPath, releasedMission({ authorized: false }));
    const unauthorizedRelease = runValidator(root);
    assert.notEqual(unauthorizedRelease.status, 0);
    assert.match(unauthorizedRelease.stderr, /RELEASED requires production_release_authorized=true/);

    writeFileSync(missionPath, releasedMission({ authorized: true }));
    assert.equal(runValidator(root).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function createEvidenceRepository(missionYaml: string): string {
  const root = mkdtempSync(join(tmpdir(), "td-mission-evidence-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  const evidenceDir = join(root, "docs", "evidence", "missions", "M3");
  mkdirSync(evidenceDir, { recursive: true });
  copyFileSync(
    join(process.cwd(), "scripts", "validate-mission-evidence.mjs"),
    join(root, "scripts", "validate-mission-evidence.mjs"),
  );
  writeFileSync(join(root, "lib", "runtime.ts"), "export const runtime = 1;\n");
  writeFileSync(join(evidenceDir, "mission.yaml"), missionYaml);
  for (const name of [
    "implementation.md",
    "migration.md",
    "security.md",
    "ux-uat.md",
    "review.md",
    "release.md",
    "finance.md",
    "privacy.md",
    "ritual-rules.md",
  ]) {
    writeFileSync(join(evidenceDir, name), `# Synthetic ${name}\n`);
  }
  writeFileSync(
    join(evidenceDir, "acceptance.json"),
    JSON.stringify({ acceptance: [{ id: "fixture", status: "PASS" }] }),
  );
  writeFileSync(join(evidenceDir, "test-results.json"), JSON.stringify({
    implementationSha: "0".repeat(40),
    checks: { skipped: 0, notRun: 0, independentReview: { p0: 0, p1: 0 } },
  }));

  git(root, "init");
  git(root, "config", "user.email", "validator@synthetic.invalid");
  git(root, "config", "user.name", "Synthetic validator");
  git(root, "add", ".");
  git(root, "commit", "-m", "implementation");
  const implementationSha = git(root, "rev-parse", "HEAD").trim();
  writeFileSync(join(evidenceDir, "test-results.json"), JSON.stringify({
    implementationSha,
    checks: { skipped: 0, notRun: 0, independentReview: { p0: 0, p1: 0 } },
  }));
  git(root, "add", "docs/evidence");
  git(root, "commit", "-m", "evidence");
  return root;
}

function blockedHumanMission(): string {
  return missionYaml({
    state: "BLOCKED_HUMAN_JUDGMENT",
    gate: "AWAITING_HUMAN_VERDICT",
    authorized: false,
    productionRelease: "NOT_PERFORMED",
  });
}

function releaseReadyMission(): string {
  return missionYaml({
    state: "MISSION_RELEASE_READY",
    gate: "PASS",
    authorized: false,
    productionRelease: "NOT_PERFORMED",
  });
}

function releasedMission({ authorized }: { authorized: boolean }): string {
  return missionYaml({
    state: "RELEASED",
    gate: "PASS",
    authorized,
    productionRelease: "RELEASED",
  });
}

function missionYaml(input: {
  state: string;
  gate: string;
  authorized: boolean;
  productionRelease: string;
}): string {
  return [
    "mission: M3",
    `state: ${input.state}`,
    "human_gates:",
    `  finance_accounting: ${input.gate}`,
    `  legal_privacy: ${input.gate}`,
    `  ritual_operations_sme: ${input.gate}`,
    `production_release_authorized: ${input.authorized}`,
    `production_release: ${input.productionRelease}`,
    "",
  ].join("\n");
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
