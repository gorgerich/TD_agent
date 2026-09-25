import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("M3 owner-run seed rejects wrong Railway binding before DB access and never prints URL", () => {
  const canary = "secret-canary-not-for-output";
  const exact = {
    RAILWAY_PROJECT_ID: "317daa1f-dd94-4c1e-84bb-929abd290d9f",
    RAILWAY_ENVIRONMENT_ID: "6a4dc3cb-2eb0-4d33-bbcb-c024fad8dd5c",
    RAILWAY_SERVICE_ID: "857fe7b5-0392-4579-9c09-aa10d174b51d",
  };
  for (const mismatch of [
    { RAILWAY_PROJECT_ID: "wrong-project" },
    { RAILWAY_ENVIRONMENT_ID: "wrong-environment" },
    { RAILWAY_SERVICE_ID: "wrong-service" },
  ]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/ops/seed-m3-railway-preview.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: "",
        VERCEL: "",
        ...exact,
        ...mismatch,
        DATABASE_PUBLIC_URL: `postgresql://user:${canary}@localhost:5432/preview`,
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /M3 Preview seed refused or failed/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(canary));
  }
});
