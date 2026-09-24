import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/ops/m3-preview-identity/route";

test("M3 Preview identity diagnostic fails closed outside the exact branch", async () => {
  const prior = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    PREVIEW_DB_ISOLATION: process.env.PREVIEW_DB_ISOLATION,
    M3_PREVIEW_DIAGNOSTIC_SECRET: process.env.M3_PREVIEW_DIAGNOSTIC_SECRET,
  };
  try {
    process.env.M3_PREVIEW_DIAGNOSTIC_SECRET = "synthetic-test-secret-with-more-than-32-characters";
    process.env.PREVIEW_DB_ISOLATION = "PASS";
    process.env.VERCEL_GIT_COMMIT_REF = "mission/m3-fulfilment-money-trust";
    process.env.VERCEL_ENV = "production";
    const request = new Request("https://preview.invalid/api/ops/m3-preview-identity", {
      headers: { "x-m3-preview-secret": process.env.M3_PREVIEW_DIAGNOSTIC_SECRET },
    });
    assert.equal((await GET(request)).status, 404);
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "another-branch";
    assert.equal((await GET(request)).status, 404);
    process.env.VERCEL_GIT_COMMIT_REF = "mission/m3-fulfilment-money-trust";
    assert.equal((await GET(new Request(request.url))).status, 404);
    assert.equal((await GET(new Request(request.url, {
      headers: { "x-m3-preview-secret": "wrong" },
    }))).status, 404);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
