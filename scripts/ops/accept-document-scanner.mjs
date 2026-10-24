import { randomBytes, createHash } from "node:crypto";
import { lstatSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { readySnapshot } from "../../services/document-scanner/protocol.mjs";

export function syntheticPdf() {
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, body] of ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"].entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

export async function acceptScanner(origin, token, phase, transport = fetch) {
  const observations = [];
  const request = async (path, bytes, type, authorization = `Bearer ${token}`) => {
    const started = performance.now();
    try {
    const response = await transport(new URL(path, origin), { method: bytes ? "POST" : "GET", redirect: "error",
      signal: AbortSignal.timeout(15_000), headers: { authorization, ...(bytes ? {
        "content-type": type, "x-document-sha256": createHash("sha256").update(bytes).digest("hex"),
      } : {}) }, ...(bytes ? { body: bytes } : {}) });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response");
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2048) throw new Error("Oversized response");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { status: response.status, body, elapsedMs: Math.round(performance.now() - started) };
    } catch { return { status: null, body: { error: "TRANSPORT_UNAVAILABLE" }, elapsedMs: Math.round(performance.now() - started) }; }
  };
  const pdf = syntheticPdf();
  if (phase === "outage" || phase === "timeout") {
    for (const path of ["/health", "/scan"]) {
      const result = await request(path, path === "/scan" ? pdf : null, "application/pdf");
      observations.push({ test: `${phase}:${path}`, pass: result.status === 503
        && result.body.error === "SCANNER_UNAVAILABLE" && result.elapsedMs < 5_000
        && (phase !== "timeout" || result.elapsedMs >= 1_500), httpStatus: result.status, elapsedMs: result.elapsedMs });
    }
  } else {
    const status = await request("/health", null, "");
    observations.push({ test: "fresh-engine-health", pass: status.status === 200 && readySnapshot(status.body),
      httpStatus: status.status, engineVersion: typeof status.body.engineVersion === "string" && /^\d+\.\d+\.\d+$/.test(status.body.engineVersion) ? status.body.engineVersion : null,
      signatureVersion: Number.isSafeInteger(status.body.signatureVersion) ? status.body.signatureVersion : null,
      definitionsAt: readySnapshot(status.body) ? status.body.definitionsAt : null });
    const eicar = Buffer.from("WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=", "base64");
    for (const [name, bytes, type, http, scan] of [
      ["clean-pdf", pdf, "application/pdf", 200, "CLEAN"],
      ["eicar", eicar, "application/octet-stream", 200, "INFECTED"],
      ["corrupt-pdf", Buffer.from("%PDF-1.4\ntruncated"), "application/pdf", 422, null],
      ["unsupported-type", pdf, "text/html", 415, null],
      ["explicit-retry", pdf, "application/pdf", 200, "CLEAN"],
    ]) {
      const result = await request("/scan", bytes, type);
      const digest = createHash("sha256").update(bytes).digest("hex");
      observations.push({ test: name, pass: result.status === http && (scan === null
        ? result.body.status !== "CLEAN" : result.body.status === scan && readySnapshot(result.body) && result.body.checksum === digest),
      httpStatus: result.status, elapsedMs: result.elapsedMs });
    }
    const denied = await request("/scan", pdf, "application/pdf", `Bearer ${randomBytes(32).toString("hex")}`);
    observations.push({ test: "unauthorized", pass: denied.status === 401, httpStatus: denied.status });
  }
  return { schema: "td-scanner-acceptance-v1", observedAt: new Date().toISOString(), phase, observations,
    state: observations.every((item) => item.pass) ? "PHASE_PASS_NOT_PRODUCTION_READINESS" : "FAIL",
    limitation: "No aggregate Production PASS: correlate exact image/build, all phases, load/signature reload, private storage/app lifecycle and approved processing configuration." };
}

async function main() {
  try {
    if (process.env.CONFIRM_SCANNER_SYNTHETIC_ACCEPTANCE !== "YES" || /^(1|true)$/i.test(process.env.CI ?? "")) throw new Error("Operator confirmation required");
    const origin = new URL(process.env.SCANNER_ACCEPTANCE_ORIGIN ?? "");
    if (!((origin.protocol === "https:") || (origin.protocol === "http:" && origin.hostname === "127.0.0.1"))
      || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Invalid scanner target");
    const phase = process.argv[2] ?? "normal";
    if (!["normal", "outage", "timeout", "recovery"].includes(phase)) throw new Error("Invalid phase");
    const file = process.env.SCANNER_ACCEPTANCE_TOKEN_FILE;
    if (!file || !lstatSync(file).isFile() || (lstatSync(file).mode & 0o077) !== 0) throw new Error("Private operator token file required");
    const token = readFileSync(file, "utf8").trim();
    if (token.length < 32) throw new Error("Invalid token");
    const receipt = await acceptScanner(origin, token, phase);
    const directory = join(homedir(), "Library", "Application Support", "TD Agent M3 Operator", "scanner-acceptance");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${Date.now()}-${randomBytes(8).toString("hex")}.json`);
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ state: receipt.state, phase, receipt: path }));
    if (receipt.state === "FAIL") process.exitCode = 1;
  } catch { console.error("SCANNER_ACCEPTANCE_FAILED; no secrets printed"); process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
