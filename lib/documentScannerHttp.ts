import { createHash } from "node:crypto";
import type { DocumentScanner, DocumentScanInput, DocumentScanResult } from "./documentScanner";
import { readySnapshot } from "../services/document-scanner/protocol.mjs";

const PROVIDER = "clamav-http-v1";
const unavailable = (): DocumentScanResult => ({ status: "ERROR", provider: PROVIDER, resultCode: "SCAN_FAILED_CLOSED" });

export function createHttpDocumentScanner(
  env: Record<string, string | undefined> = process.env, transport: typeof fetch = fetch,
): DocumentScanner {
  let origin: URL | null = null;
  const secret = env.M3_SCANNER_AUTH_TOKEN;
  try {
    const value = new URL(env.M3_SCANNER_ORIGIN ?? "");
    if (value.protocol === "https:" && value.pathname === "/" && !value.search && !value.hash
      && !value.username && !value.password && secret && secret.length >= 32 && secret === secret.trim()) origin = value;
  } catch { /* Missing or malformed deployment configuration stays closed. */ }
  const request = async (path: string, init: RequestInit) => {
    if (!origin) throw new Error("Scanner configuration unavailable");
    const response = await transport(new URL(path, origin), {
      ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { ...init.headers, authorization: `Bearer ${secret}` },
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 2048) throw new Error("Scanner unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Scanner response missing");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2048) throw new Error("Scanner response too large");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  return {
    isOperational: () => origin !== null,
    async checkHealth() {
      try { const data = await request("/health", { method: "GET" }); return readySnapshot(data); }
      catch { return false; }
    },
    async scan(input: DocumentScanInput) {
      if (!input.bytes.length || input.bytes.length > 10 * 1024 * 1024
        || createHash("sha256").update(input.bytes).digest("hex") !== input.checksum) return unavailable();
      try {
        const data = await request("/scan", { method: "POST", body: Buffer.from(input.bytes),
          headers: { "content-type": input.mimeType, "x-document-sha256": input.checksum } });
        if (readySnapshot(data) && data.checksum === input.checksum
          && ((data.status === "CLEAN" && data.resultCode === "CLAMAV_CLEAN")
            || (data.status === "INFECTED" && data.resultCode === "CLAMAV_DETECTION"))) {
          return { status: data.status, provider: PROVIDER, resultCode: data.resultCode,
            evidence: { engineVersion: data.engineVersion, signatureVersion: data.signatureVersion, definitionsAt: data.definitionsAt } };
        }
      } catch { /* No provider response body, document contents or credentials enter logs. */ }
      return unavailable();
    },
  };
}
