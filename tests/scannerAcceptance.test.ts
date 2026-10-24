import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createScannerServer } from "../services/document-scanner/server.mjs";
import { acceptScanner, syntheticPdf } from "../scripts/ops/accept-document-scanner.mjs";

test("acceptance runner exercises the real HTTP boundary but labels simulated-engine results as phase-only", async () => {
  const secret = randomBytes(32).toString("hex");
  const server = createScannerServer({ secret, engine: {
    health: async () => ({ ready: true, engineVersion: "1.5.4", signatureVersion: 28157, definitionsAt: new Date().toISOString() }),
    scan: async (bytes) => bytes.includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) ? "INFECTED" : "CLEAN",
  } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const receipt = await acceptScanner(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`), secret, "normal");
    assert.equal(receipt.state, "PHASE_PASS_NOT_PRODUCTION_READINESS");
    assert.equal(receipt.observations.length, 7);
    assert.ok(receipt.observations.every((item) => item.pass));
    assert.equal(JSON.stringify(receipt).includes(secret), false);
    assert.ok(syntheticPdf().subarray(-6).includes(Buffer.from("%%EOF")));
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("acceptance preserves transport failures without credentials or arbitrary provider data", async () => {
  const token = randomBytes(32).toString("hex");
  for (const transport of [async () => { throw new Error(`SECRET:${token}`); }, async () => new Response("x".repeat(2049))]) {
    const receipt = await acceptScanner(new URL("https://scanner.example.invalid"), token, "normal", transport);
    assert.equal(receipt.state, "FAIL");
    assert.equal(receipt.observations.length, 7);
    assert.equal(JSON.stringify(receipt).includes(token), false);
    assert.equal(JSON.stringify(receipt).includes("SECRET"), false);
  }
});

test("an immediate outage is not misrepresented as an observed timeout", async () => {
  const result = await acceptScanner(new URL("https://scanner.example.invalid"), randomBytes(32).toString("hex"), "timeout",
    async () => Response.json({ error: "SCANNER_UNAVAILABLE" }, { status: 503 }));
  assert.equal(result.state, "FAIL");
  assert.equal(result.observations.length, 2);
});
