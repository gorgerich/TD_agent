import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

test("MISSION_RELEASE_READY still rejects evidence for a stale source tree", () => {
  const root = mkdtempSync(join(tmpdir(), "td-mission-evidence-"));
  try {
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "lib"), { recursive: true });
    const evidenceDir = join(root, "docs", "evidence", "missions", "M3");
    mkdirSync(evidenceDir, { recursive: true });
    copyFileSync(join(process.cwd(), "scripts", "validate-mission-evidence.mjs"), join(root, "scripts", "validate-mission-evidence.mjs"));
    writeFileSync(join(root, "lib", "runtime.ts"), "export const runtime = 1;\n");
    writeFileSync(join(evidenceDir, "mission.yaml"), "mission: M3\nstate: MISSION_RELEASE_READY\n");
    for (const name of ["implementation.md", "migration.md", "security.md", "ux-uat.md", "review.md", "release.md"]) {
      writeFileSync(join(evidenceDir, name), "# Synthetic validator fixture\n");
    }
    writeFileSync(join(evidenceDir, "acceptance.json"), JSON.stringify({ acceptance: [{ id: "fixture", status: "PASS" }] }));
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
