import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRetentionObservation, observationWindow, sanitizeRetentionRecord } from "../scripts/ops/collect-retention-observation.mjs";

const base = {
  timestamp: "2026-10-24T03:17:00Z", requestPath: "/api/internal/rate-limit-retention",
  id: "iad1-1792811820000-abcdef", deploymentId: "dpl_Synthetic123", responseStatusCode: 200,
};

test("retention capture uses UTC and the configured observation window", () => {
  for (const [time, expected] of [["02:59", false], ["03:00", true], ["04:35", true], ["04:36", false]] as const) {
    assert.equal(observationWindow(new Date(`2026-10-24T${time}:00Z`)), expected);
  }
});

test("HTTP success, user agent and arbitrary messages never fabricate cron or cleanup proof", () => {
  const record = sanitizeRetentionRecord({ ...base, headers: { authorization: "SECRET" },
    userAgent: "vercel-cron/1.0", message: "SECRET person@example.invalid", email: "person@example.invalid" });
  assert.equal(record?.scheduledProvenance, "UNVERIFIED");
  assert.deepEqual(record?.cleanup, { outcome: "NOT_EXPOSED_IN_OBSERVED_LOG", deleted: null });
  assert.equal(JSON.stringify(record).includes("SECRET"), false);
  assert.equal(JSON.stringify(record).includes("person@"), false);
});

test("only provider classification and the bounded fixed completion schema are retained", () => {
  const record = sanitizeRetentionRecord({ ...base, requestType: "cron", message: JSON.stringify({
    event: "RATE_LIMIT_RETENTION_COMPLETED", trigger: "AUTHENTICATED_ENDPOINT", outcome: "BACKLOG_REMAINS", deleted: 4096,
    password: "SECRET", email: "person@example.invalid",
  }) });
  assert.equal(record?.providerRequestType, "cron");
  assert.deepEqual(record?.cleanup, { outcome: "BACKLOG_REMAINS", deleted: 4096 });
  assert.equal(JSON.stringify(record).includes("SECRET"), false);
});

test("invalid counts and unrelated or malformed requests are not accepted as cleanup proof", () => {
  for (const deleted of [-1, 4097, 0.5, "SECRET", null]) {
    assert.equal(sanitizeRetentionRecord({ ...base, message: JSON.stringify({
      event: "RATE_LIMIT_RETENTION_COMPLETED", trigger: "AUTHENTICATED_ENDPOINT", outcome: "SUCCEEDED", deleted,
    }) })?.cleanup.outcome, "NOT_EXPOSED_IN_OBSERVED_LOG");
  }
  assert.equal(sanitizeRetentionRecord({ ...base, requestPath: "/agent/login" }), null);
  assert.equal(sanitizeRetentionRecord({ ...base, timestamp: "SECRET" }), null);
  assert.equal(sanitizeRetentionRecord({ ...base, deploymentId: "SECRET?token=value", id: "person@example.invalid" })?.requestId, null);
});

test("CLI nested completion logs are captured and conflicting completion logs fail closed", () => {
  const event = { event: "RATE_LIMIT_RETENTION_COMPLETED", trigger: "AUTHENTICATED_ENDPOINT", outcome: "SUCCEEDED", deleted: 3 };
  const record = { ...base, message: "unrelated SECRET", logs: [
    { message: "unrelated person@example.invalid" }, { message: JSON.stringify(event) },
  ] };
  const captured = sanitizeRetentionRecord(record);
  assert.deepEqual(captured?.cleanup, { outcome: "SUCCEEDED", deleted: 3 });
  assert.equal(captured?.scheduledProvenance, "UNVERIFIED");
  assert.equal(JSON.stringify(captured).includes("SECRET"), false);
  assert.equal(JSON.stringify(captured).includes("person@"), false);
  assert.equal(sanitizeRetentionRecord({ ...record, message: JSON.stringify({ ...event, deleted: 4 }) })?.cleanup.outcome, "CONFLICTING_COMPLETION_LOGS");
});

test("capture persists private bounded receipts, preserves failures and never calls cleanup", () => {
  const root = mkdtempSync(join(tmpdir(), "td-retention-observation-test-"));
  const directory = join(root, "receipts");
  const now = new Date("2026-10-24T03:30:00Z");
  const runner: Parameters<typeof collectRetentionObservation>[1] = (command, args) => {
    assert.equal(command, "vercel");
    assert.equal(args?.[0], "logs");
    assert.ok(args?.includes("--no-branch"));
    assert.ok(!args?.includes("api"));
    return { status: 0, signal: null, pid: 0, output: [], stderr: "SECRET diagnostic", stdout: [
      JSON.stringify({ ...base, requestType: "cron", message: "SECRET" }),
      JSON.stringify({ ...base, timestamp: "2026-10-23T03:17:00Z" }),
    ].join("\n") };
  };
  try {
    collectRetentionObservation(now, runner, directory);
    chmodSync(directory, 0o755);
    collectRetentionObservation(now, () => ({ status: 1, signal: null, pid: 0, output: [], stdout: "SECRET", stderr: "SECRET" }), directory);
    const paths = readdirSync(directory).map((name) => join(directory, name));
    assert.equal(paths.length, 2);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    const receipts = paths.map((path) => {
      assert.equal(statSync(path).mode & 0o777, 0o600);
      const text = readFileSync(path, "utf8");
      assert.equal(text.includes("SECRET"), false);
      return JSON.parse(text);
    });
    assert.equal(receipts.find((receipt) => receipt.readSucceeded)?.records.length, 1);
    assert.equal(receipts.find((receipt) => !receipt.readSucceeded)?.records.length, 0);
    collectRetentionObservation(new Date("2026-10-24T12:00:00Z"), () => { throw new Error("Must not run"); }, directory);
    assert.equal(readdirSync(directory).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
