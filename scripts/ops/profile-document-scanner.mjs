import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClamEngine, createScannerServer, MAX_BYTES } from "../../services/document-scanner/server.mjs";
import { syntheticPdf } from "./accept-document-scanner.mjs";

// A real content stream, correct byte length and rebuilt xref, not post-xref padding.
export function sizedPdf(size) {
  const build = (padding) => {
    let text = "%PDF-1.4\n";
    const offsets = [0];
    const bodies = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
      `<< /Length ${padding + 1} >>\nstream\n${" ".repeat(padding)}\nendstream`];
    for (const [index, body] of bodies.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${body}\nendobj\n`; }
    const xref = Buffer.byteLength(text);
    text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(text);
  };
  let padding = size - build(0).length;
  for (let i = 0; i < 5; i++) { const bytes = build(padding); if (bytes.length === size) return bytes; padding += size - bytes.length; }
  throw new Error("Synthetic fixture size mismatch");
}

const memory = () => {
  for (const path of ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]) {
    try { const value = Number(readFileSync(path, "utf8")); if (Number.isSafeInteger(value) && value > 0) return value; } catch { /* Local kernel may expose another cgroup layout. */ }
  }
  return null;
};

const cpuUsec = () => {
  try { return Number(/^usage_usec (\d+)$/m.exec(readFileSync("/sys/fs/cgroup/cpu.stat", "utf8"))?.[1]) || null; }
  catch { return null; }
};

export async function profileScanner(engine = createClamEngine(), { clientMs = 12_000, settleMs = 16_000 } = {}) {
  const token = randomBytes(32).toString("hex");
  const rows = [];
  const small = syntheticPdf();
  const padded = Buffer.concat([small.subarray(0, -6), Buffer.alloc(MAX_BYTES - small.length, 32), small.subarray(-6)]);
  const valid = sizedPdf(MAX_BYTES);
  // Different valid whitespace per run avoids mistaking a daemon cache hit for cold throughput.
  for (const [index, value] of randomBytes(64).entries()) valid[1024 + index] = value % 2 ? 10 : 32;
    const fixtures = [["small-pdf", small], ["original-post-xref-padding-10MiB", padded], ["valid-content-stream-10MiB", valid], ["repeat-valid-10MiB", valid]];
    for (const [index, [name, bytes]] of fixtures.entries()) {
      const stage = { pending: 0 };
      const server = createScannerServer({ secret: token, engine: {
        async health() { stage.pending++; const start = performance.now(); try { return await engine.health(); }
          finally { stage.pending--; stage.healthMs = performance.now() - start; stage.healthEnd = performance.now(); } },
        async scan(input) { stage.pending++; stage.scanStart = performance.now(); try { return await engine.scan(input); }
          finally { stage.pending--; stage.scanMs = performance.now() - stage.scanStart; } },
      } });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      let sampledPeakBytes = memory(), status = null, scanStatus = null;
      const sample = setInterval(() => { const value = memory(); if (value !== null) sampledPeakBytes = Math.max(sampledPeakBytes ?? 0, value); }, 25);
      const start = performance.now(), cpuStart = cpuUsec();
      try {
        const response = await fetch(`${origin}/scan`, { method: "POST", headers: { authorization: `Bearer ${token}`,
          "content-type": "application/pdf", "x-document-sha256": createHash("sha256").update(bytes).digest("hex") },
        body: bytes, signal: AbortSignal.timeout(clientMs) });
        status = response.status;
        const result = await response.json();
        scanStatus = ["CLEAN", "INFECTED"].includes(result.status) ? result.status : "ERROR";
      } catch { scanStatus = "CLIENT_DEADLINE_OR_TRANSPORT_ERROR"; }
      const totalMs = Math.round(performance.now() - start);
      // Wait for the bounded server operation, never admit overlapping benchmark work.
      while (stage.pending > 0 && performance.now() - start < settleMs) await new Promise((resolve) => setTimeout(resolve, 25));
      clearInterval(sample);
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      const cpuEnd = cpuUsec();
      rows.push({ name, bytes: bytes.length, http: status, scanStatus, totalMs, healthMs: Math.round(stage.healthMs ?? 0),
        ingressBufferValidationMs: stage.scanStart ? Math.round(stage.scanStart - stage.healthEnd) : null,
        scanMs: stage.scanMs === undefined ? null : Math.round(stage.scanMs), sampledPeakBytes,
        wholeContainerCpuUsec: cpuStart === null || cpuEnd === null ? null : cpuEnd - cpuStart });
      if (stage.pending > 0) {
        for (const [remaining] of fixtures.slice(index + 1)) rows.push({ name: remaining, state: "NOT_RUN_PREVIOUS_OPERATION_UNSETTLED" });
        break;
      }
    }
  return { kind: "LOCAL_SYNTHETIC_PROFILE_NOT_PRODUCTION", observedAt: new Date().toISOString(), rows,
    memoryMeaning: "25ms sampled whole test-container cgroup usage, not a guaranteed maximum or steady-state bill" };
}

async function main() {
  if (process.env.CONFIRM_LOCAL_SCANNER_PROFILE !== "YES") { console.error("LOCAL_PROFILE_CONFIRMATION_REQUIRED"); process.exitCode = 1; }
  else { try { console.log(JSON.stringify(await profileScanner())); } catch { console.error("LOCAL_PROFILE_FAILED_NO_SECRETS"); process.exitCode = 1; } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
