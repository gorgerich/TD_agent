import { createServer } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readySnapshot, SCANNER_PROVIDER } from "./protocol.mjs";

export const MAX_BYTES = 10 * 1024 * 1024;
const PROVIDER = SCANNER_PROVIDER;
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "application/octet-stream"]);

/** @typedef {{ready: boolean, engineVersion: string, signatureVersion: number, definitionsAt: string}} EngineHealth */
/** @typedef {{health: () => Promise<EngineHealth | null>, scan: (bytes: Buffer) => Promise<string>}} Engine */

export function parseDaemonVersion(reply, now = Date.now()) {
  const match = /^ClamAV ([\d.]+)\/(\d+)\/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\0$/.exec(reply);
  if (!match) return null;
  const at = Date.parse(`${match[3]} UTC`);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > 48 * 60 * 60_000) return null;
  return { ready: true, engineVersion: match[1], signatureVersion: Number(match[2]), definitionsAt: new Date(at).toISOString() };
}

/** @returns {Engine} */
export function createClamEngine() {
  return {
    health: () => new Promise((resolve) => {
      const socket = createConnection(process.env.CLAMD_SOCKET ?? "/run/clamav/clamd.sock");
      let reply = "", settled = false;
      const finish = (value) => { if (!settled) { settled = true; socket.destroy(); resolve(value); } };
      const timer = setTimeout(() => finish(null), 2_000);
      socket.once("close", () => { clearTimeout(timer); finish(null); });
      socket.once("error", () => finish(null));
      socket.once("connect", () => socket.write("zVERSION\0"));
      socket.on("data", (chunk) => {
        reply += chunk.toString("utf8");
        if (reply.length > 1024) finish(null);
        else if (reply.includes("\0")) finish(parseDaemonVersion(reply));
      });
    }),
    scan: (bytes) => new Promise((resolve) => {
      // clamdscan owns the INSTREAM protocol; no caller path or shell interpolation.
      const child = spawn("clamdscan", ["--config-file=/etc/clamav/clamd.conf", "--stream", "--no-summary", "-"], { stdio: ["pipe", "ignore", "ignore"] });
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, 10_000);
      child.once("error", () => { clearTimeout(timer); resolve("ERROR"); });
      child.once("close", (code) => { clearTimeout(timer); resolve(code === 0 ? "CLEAN" : code === 1 ? "INFECTED" : "ERROR"); });
      child.stdin.on("error", () => { /* The child's terminal status is authoritative. */ });
      child.stdin.end(bytes);
    }),
  };
}

function validBody(bytes, type) {
  if (type === "application/octet-stream") return true; // Authenticated engine acceptance, not a business upload MIME permission.
  if (type === "application/pdf") return bytes.subarray(0, 5).toString() === "%PDF-" && bytes.subarray(-1024).includes(Buffer.from("%%EOF"));
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

/** @param {{secret?: string, engine?: Engine}} options */
export function createScannerServer({ secret, engine = createClamEngine() }) {
  if (typeof secret !== "string" || secret.trim().length < 32 || secret !== secret.trim()) throw new Error("Scanner authentication configuration required");
  const expected = Buffer.from(`Bearer ${secret}`);
  let busy = false;
  const server = createServer(async (req, res) => {
    const send = (code, payload) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", "Connection": "close" }); res.end(JSON.stringify(payload)); };
    if (req.url === "/live" && req.method === "GET") return send(200, { live: true });
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(401, { error: "UNAUTHORIZED" });
    if (!((req.method === "GET" && req.url === "/health") || (req.method === "POST" && req.url === "/scan"))) return send(404, { error: "NOT_FOUND" });
    if (busy) return send(429, { error: "BUSY" });
    busy = true;
    try {
      const health = await engine.health();
      if (!readySnapshot({ provider: PROVIDER, ...health })) return send(503, { error: "SCANNER_UNAVAILABLE" });
      if (req.url === "/health") return send(200, { provider: PROVIDER, ...health });
      const size = req.headers["content-length"];
      const type = req.headers["content-type"];
      const checksum = req.headers["x-document-sha256"];
      if (typeof size !== "string" || !/^[1-9]\d{0,7}$/.test(size) || Number(size) > MAX_BYTES) return send(413, { error: "SIZE_LIMIT" });
      if (!TYPES.has(type)) return send(415, { error: "UNSUPPORTED_TYPE" });
      if (typeof checksum !== "string" || !/^[0-9a-f]{64}$/.test(checksum)) return send(422, { error: "CHECKSUM_REQUIRED" });
      req.setTimeout(10_000, () => req.destroy());
      const chunks = [];
      let received = 0;
      for await (const chunk of req) {
        received += chunk.length;
        if (received > MAX_BYTES || received > Number(size)) return send(413, { error: "SIZE_LIMIT" });
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (received !== Number(size) || createHash("sha256").update(bytes).digest("hex") !== checksum) return send(422, { error: "CHECKSUM_MISMATCH" });
      if (!validBody(bytes, type)) return send(422, { error: "MALFORMED_DOCUMENT" });
      const status = await engine.scan(bytes);
      if (!["CLEAN", "INFECTED"].includes(status)) return send(503, { error: "SCAN_FAILED_CLOSED" });
      send(200, { provider: PROVIDER, status, checksum, resultCode: status === "CLEAN" ? "CLAMAV_CLEAN" : "CLAMAV_DETECTION", ...health });
    } catch {
      if (!res.headersSent && !res.destroyed) send(503, { error: "SCAN_FAILED_CLOSED" });
    } finally { busy = false; }
  });
  server.maxConnections = 32;
  server.headersTimeout = 5_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 1_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid scanner port");
  createScannerServer({ secret: process.env.SCANNER_AUTH_TOKEN }).listen(port, "0.0.0.0");
}
