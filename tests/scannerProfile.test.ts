import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { sizedPdf, profileScanner } from "../scripts/ops/profile-document-scanner.mjs";

test("low-memory reload blocks new scans without disabling database validation or file limits", () => {
  const directives = (file: string) => readFileSync(file, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const config = directives("services/document-scanner/clamd.conf");
  for (const value of ["ConcurrentDatabaseReload no", "StreamMaxLength 10M", "MaxFileSize 10M", "MaxScanTime 10000", "AlertExceedsMax yes", "AlertEncryptedDoc yes", "AlertEncryptedArchive yes", "AlertBrokenMedia yes"]) {
    assert.deepEqual(config.filter((line) => line.split(/\s/)[0] === value.split(" ")[0]), [value]);
  }
  assert.deepEqual(directives("services/document-scanner/freshclam.conf").filter((line) => line.startsWith("TestDatabases ")), ["TestDatabases yes"]);
});

test("a rejected scan is settled and does not suppress remaining measurements", async () => {
  const result = await profileScanner({
    health: async () => ({ ready: true, engineVersion: "1.4.6", signatureVersion: 28163, definitionsAt: new Date().toISOString() }),
    scan: async () => { throw new Error("Synthetic scanner failure"); },
  });
  assert.equal(result.rows.length, 4);
  assert.ok(result.rows.every((row) => row.http === 503 && row.scanMs !== null && !row.state));
});

test("an unsettled readiness call also stops subsequent probes", async () => {
  const result = await profileScanner({ health: async () => new Promise(() => {}), scan: async () => "CLEAN" }, { clientMs: 100, settleMs: 150 });
  assert.ok(result.rows.slice(1).every((row) => row.state === "NOT_RUN_PREVIOUS_OPERATION_UNSETTLED"));
});

test("maximum-size PDF fixture rebuilds content length and cross-reference offsets", () => {
  const bytes = sizedPdf(10 * 1024 * 1024);
  assert.equal(bytes.length, 10 * 1024 * 1024);
  const text = bytes.toString("ascii");
  const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
  assert.equal(text.slice(xref, xref + 4), "xref");
  const length = Number(/\/Length (\d+)/.exec(text)?.[1]);
  const start = text.indexOf("stream\n") + 7;
  assert.equal(text.slice(start + length, start + length + 9), "endstream");
});

test("profile measures maximum-size ingress separately without claiming real-engine acceptance", async () => {
  const result = await profileScanner({
    health: async () => ({ ready: true, engineVersion: "1.4.6", signatureVersion: 28163, definitionsAt: new Date().toISOString() }),
    scan: async () => "CLEAN",
  });
  assert.equal(result.kind, "LOCAL_SYNTHETIC_PROFILE_NOT_PRODUCTION");
  assert.equal(result.rows.length, 4);
  for (const row of result.rows) {
    assert.equal(row.http, 200);
    assert.equal(row.scanStatus, "CLEAN");
    assert.ok(row.ingressBufferValidationMs !== null && row.scanMs !== null);
  }
});

test("unsettled profile operation stops subsequent probes instead of corrupting their measurements", async () => {
  let calls = 0;
  const result = await profileScanner({
    health: async () => ({ ready: true, engineVersion: "1.4.6", signatureVersion: 28163, definitionsAt: new Date().toISOString() }),
    scan: async () => { calls += 1; return new Promise(() => {}); },
  }, { clientMs: 100, settleMs: 150 });
  assert.equal(calls, 1);
  assert.equal(result.rows[0].scanMs, null);
  assert.ok(result.rows.slice(1).every((row) => row.state === "NOT_RUN_PREVIOUS_OPERATION_UNSETTLED"));
});
