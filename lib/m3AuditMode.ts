import { createHash } from "node:crypto";
import { inspectDirectMigrationUrl } from "@/lib/migrationTarget";

export const M3_CPO_AUDIT_ORGANIZATION_ID = "m3-cpo-audit-20260923";
export const M3_PREVIEW_DATABASE_FINGERPRINT = "545a187f9e9d66b0";
const M3_PREVIEW_STORAGE_ID = "store_Ov8erHstuvfJ52Og";

export function getApprovedM3PreviewStorageId(): string | null {
  if (process.env.VERCEL_ENV !== "preview" || !isApprovedM3PreviewBranch()
    || process.env.M3_DOCUMENT_STORAGE === "isolated-filesystem"
    || process.env.BLOB_STORE_ID?.trim() !== M3_PREVIEW_STORAGE_ID) return null;
  // Mirror the installed Blob SDK's trusted context -> environment OIDC -> RW resolution.
  const context = (globalThis as typeof globalThis & {
    [key: symbol]: { get?: () => { headers?: Record<string, unknown> } } | undefined;
  })[Symbol.for("@vercel/request-context")];
  const contextToken = context?.get?.()?.headers?.["x-vercel-oidc-token"];
  if ((typeof contextToken === "string" && contextToken.trim()) || process.env.VERCEL_OIDC_TOKEN?.trim()) {
    return M3_PREVIEW_STORAGE_ID;
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    const store = /^vercel_blob_rw_([A-Za-z0-9]+)_.+$/.exec(token)?.[1];
    return store && `store_${store}` === M3_PREVIEW_STORAGE_ID ? M3_PREVIEW_STORAGE_ID : null;
  }
  return null;
}

export function isApprovedM3PreviewBranch(): boolean {
  return ["mission/m3-fulfilment-money-trust", "fix/m3-intake-transaction", "fix/m3-cpo-audit-repair"]
    .includes(process.env.VERCEL_GIT_COMMIT_REF ?? "");
}

export function isApprovedM3PreviewDatabase(): boolean {
  if (process.env.VERCEL_ENV !== "preview"
    || !isApprovedM3PreviewBranch()
    || process.env.PREVIEW_DB_ISOLATION !== "PASS") return false;
  try {
    const direct = inspectDirectMigrationUrl(process.env.DATABASE_URL_UNPOOLED);
    const pooled = new URL(process.env.DATABASE_URL ?? "");
    const host = pooled.hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
    const port = pooled.port === "6543" ? "5432" : pooled.port || "5432";
    const database = decodeURIComponent(pooled.pathname.replace(/^\//, ""));
    if (!["postgres:", "postgresql:"].includes(pooled.protocol) || !host || !database) return false;
    const pooledFingerprint = createHash("sha256")
      .update(`${host}:${port}/${database}`).digest("hex").slice(0, 16);
    return direct.fingerprint === M3_PREVIEW_DATABASE_FINGERPRINT
      && pooledFingerprint === direct.fingerprint;
  } catch {
    return false;
  }
}

function isIsolatedM3CiDatabase(): boolean {
  if (process.env.CI !== "true" || process.env.ALLOW_DB_TESTS !== "1"
    || process.env.PREVIEW_DB_ISOLATION !== "PASS"
    || process.env.VERCEL === "1"
    || process.env.VERCEL_GIT_COMMIT_REF !== "mission/m3-fulfilment-money-trust") return false;
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl || process.env.DATABASE_URL !== testUrl
    || process.env.DATABASE_URL_UNPOOLED !== testUrl) return false;
  try {
    const url = new URL(testUrl);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && url.hostname === "127.0.0.1"
      && url.port === "5432"
      && url.pathname === "/td_agent_test";
  } catch {
    return false;
  }
}

export function isM3ProductionWriteAllowed(organizationId: string): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.VERCEL_ENV === "preview") {
    return isApprovedM3PreviewDatabase() || isIsolatedM3CiDatabase();
  }
  return process.env.VERCEL_ENV === "production" && organizationId === M3_CPO_AUDIT_ORGANIZATION_ID;
}
