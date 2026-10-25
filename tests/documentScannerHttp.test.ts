import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createClamEngine, createScannerServer, parseDaemonVersion } from "../services/document-scanner/server.mjs";
import { createHttpDocumentScanner } from "../lib/documentScannerHttp";

const health = () => ({ ready: true, engineVersion: "1.5.4", signatureVersion: 28157, definitionsAt: new Date().toISOString() });
const pdf = Buffer.from("%PDF-1.7\nSynthetic test only\n%%EOF");
const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function harness(engine: NonNullable<Parameters<typeof createScannerServer>[0]["engine"]>, run: (value: {
  scanner: ReturnType<typeof createHttpDocumentScanner>; origin: string; secret: string;
}) => Promise<void>) {
  const secret = randomBytes(32).toString("base64url");
  const server = createScannerServer({ secret, engine });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const transport: typeof fetch = async (input, init) => {
    const target = new URL(String(input));
    assert.equal(target.origin, "https://scanner.example.invalid");
    assert.equal(init?.redirect, "error");
    return fetch(`${origin}${target.pathname}`, init);
  };
  const scanner = createHttpDocumentScanner({ M3_SCANNER_ORIGIN: "https://scanner.example.invalid", M3_SCANNER_AUTH_TOKEN: secret }, transport);
  try { await run({ scanner, origin, secret }); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("daemon readiness requires a recognized engine with fresh signature metadata", () => {
  const now = Date.parse("2026-10-24T11:00:00Z");
  assert.equal(parseDaemonVersion("ClamAV 1.5.4/28157/Sat Oct 24 10:00:00 2026\0", now)?.signatureVersion, 28157);
  for (const reply of ["PONG\0", "SECRET invalid", "ClamAV 1.5.4/28157/Tue Oct 20 10:00:00 2026\0", "ClamAV 1.5.4/28157/Sun Oct 25 10:00:00 2026\0"]) {
    assert.equal(parseDaemonVersion(reply, now), null);
  }
});

test("scanner configuration has no insecure default or caller-supplied storage URL", async () => {
  const secret = randomBytes(32).toString("hex");
  for (const origin of [undefined, "http://scanner.invalid", "https://a:b@scanner.invalid", "https://scanner.invalid/scan", "https://scanner.invalid/?key=SECRET", "https://scanner.invalid/#SECRET"]) {
    const scanner = createHttpDocumentScanner({ M3_SCANNER_ORIGIN: origin, M3_SCANNER_AUTH_TOKEN: secret }, async () => { throw new Error("Must not fetch"); });
    assert.equal(scanner.isOperational(), false);
    assert.equal(await scanner.checkHealth?.(), false);
  }
});

test("gateway authentication precedes engine and file processing", async () => {
  let calls = 0;
  await harness({ health: async () => { calls += 1; return health(); }, scan: async () => "CLEAN" }, async ({ origin }) => {
    for (const authorization of [undefined, "Bearer wrong"]) {
      const result = await fetch(`${origin}/scan`, { method: "POST", body: "SECRET", headers: authorization ? { authorization } : {} });
      assert.equal(result.status, 401);
    }
    assert.equal(calls, 0);
  });
});

test("real HTTP adapter validates checksums and propagates simulated engine clean/infected results", async () => {
  await harness({ health: async () => health(), scan: async (bytes) => bytes.includes(Buffer.from("EICAR")) ? "INFECTED" : "CLEAN" }, async ({ scanner }) => {
    assert.equal(await scanner.checkHealth?.(), true);
    for (const [bytes, type, expected] of [[pdf, "application/pdf", "CLEAN"], [Buffer.from("Synthetic EICAR unit boundary"), "application/octet-stream", "INFECTED"]] as const) {
      const result = await scanner.scan({ storageKey: "never-transmitted", bytes, checksum: checksum(bytes), mimeType: type });
      assert.equal(result.status, expected);
      assert.equal(result.evidence?.signatureVersion, 28157);
    }
    assert.equal((await scanner.scan({ storageKey: "never-transmitted", bytes: pdf, checksum: "0".repeat(64), mimeType: "application/pdf" })).status, "ERROR");
  });
});

test("malformed and unsupported input never reaches the scan engine", async () => {
  let calls = 0;
  await harness({ health: async () => health(), scan: async () => { calls += 1; return "CLEAN"; } }, async ({ scanner }) => {
    for (const [bytes, type] of [[Buffer.from("truncated"), "application/pdf"], [pdf, "text/html"]] as const) {
      assert.equal((await scanner.scan({ storageKey: "ignored", bytes, checksum: checksum(bytes), mimeType: type })).status, "ERROR");
    }
    assert.equal(calls, 0);
  });
});

test("unavailable scanner stays closed and a safe retry recovers without a false clean", async () => {
  let available = false;
  await harness({ health: async () => available ? health() : null, scan: async () => "CLEAN" }, async ({ scanner }) => {
    assert.equal(await scanner.checkHealth?.(), false);
    const input = { storageKey: "ignored", bytes: pdf, checksum: checksum(pdf), mimeType: "application/pdf" };
    assert.equal((await scanner.scan(input)).status, "ERROR");
    available = true;
    assert.equal(await scanner.checkHealth?.(), true);
    assert.equal((await scanner.scan(input)).status, "CLEAN");
  });
});

test("timeouts, malformed results, stale definitions and oversized provider output fail closed", async () => {
  const secret = randomBytes(32).toString("hex");
  for (const transport of [
    async () => { throw new DOMException("Synthetic timeout", "TimeoutError"); },
    async () => Response.json({ provider: "clamav-http-v1", ready: true, status: "CLEAN", resultCode: "CLAMAV_CLEAN", checksum: checksum(pdf) }),
    async () => Response.json({ provider: "clamav-http-v1", ...health(), definitionsAt: "2020-01-01T00:00:00Z", status: "CLEAN", resultCode: "CLAMAV_CLEAN", checksum: checksum(pdf) }),
    async () => Response.json({ provider: "clamav-http-v1", ...health(), definitionsAt: `${new Date().toISOString()} (SECRET)`, status: "CLEAN", resultCode: "CLAMAV_CLEAN", checksum: checksum(pdf) }),
    async () => new Response("x".repeat(2049)),
    async () => new Response(null, { status: 302, headers: { location: "https://other.invalid" } }),
  ]) {
    const scanner = createHttpDocumentScanner({ M3_SCANNER_ORIGIN: "https://scanner.example.invalid", M3_SCANNER_AUTH_TOKEN: secret }, transport);
    assert.equal(await scanner.checkHealth?.(), false);
    assert.equal((await scanner.scan({ storageKey: "ignored", bytes: pdf, checksum: checksum(pdf), mimeType: "application/pdf" })).status, "ERROR");
  }
});

test("concurrent HTTP scans respect one admitted scan instead of building an unbounded queue", async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const resume = new Promise<void>((resolve) => { release = resolve; });
  await harness({ health: async () => health(), scan: async () => { enter(); await resume; return "CLEAN"; } }, async ({ scanner }) => {
    const input = { storageKey: "ignored", bytes: pdf, checksum: checksum(pdf), mimeType: "application/pdf" };
    const first = scanner.scan(input);
    await entered;
    try { assert.equal((await scanner.scan(input)).status, "ERROR"); }
    finally { release(); }
    assert.equal((await first).status, "CLEAN");
  });
});

test("scanner deadline aborts an actual stalled HTTP request without returning CLEAN", async () => {
  // Stall the upstream itself: the gateway has its own earlier ten-second deadline.
  const upstream = createServer((request) => { request.resume(); });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const local = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  const scanner = createHttpDocumentScanner({ M3_SCANNER_ORIGIN: "https://scanner.example.invalid", M3_SCANNER_AUTH_TOKEN: randomBytes(32).toString("hex") },
    async (_input, init) => fetch(local, init));
  const started = performance.now();
  try {
    const result = await scanner.scan({ storageKey: "ignored", bytes: pdf, checksum: checksum(pdf), mimeType: "application/pdf" });
    assert.equal(result.status, "ERROR");
    assert.ok(performance.now() - started >= 11_000);
    assert.ok(performance.now() - started < 16_000);
  } finally {
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("scan child deadline kills a stalled subprocess and never maps timeout to CLEAN", async () => {
  const root = mkdtempSync(join(tmpdir(), "td-clam-process-deadline-"));
  const pidFile = join(root, "pid");
  const prior = process.env.PATH;
  writeFileSync(join(root, "clamdscan"), `#!/bin/sh\nprintf '%s' "$$" > ${JSON.stringify(pidFile)}\nexec /bin/sleep 30\n`, { mode: 0o700 });
  process.env.PATH = `${root}:${prior ?? ""}`;
  try {
    const started = performance.now();
    assert.equal(await createClamEngine().scan(pdf), "ERROR");
    assert.ok(performance.now() - started >= 9_000);
    assert.ok(performance.now() - started < 14_000);
    const pid = Number(readFileSync(pidFile, "utf8"));
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    if (prior === undefined) delete process.env.PATH; else process.env.PATH = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
