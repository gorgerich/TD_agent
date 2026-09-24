import { createHash } from "node:crypto";
import { inspectDirectMigrationUrl } from "@/lib/migrationTarget";

export const M3_CPO_AUDIT_ORGANIZATION_ID = "m3-cpo-audit-20260923";
export const M3_PREVIEW_DATABASE_FINGERPRINT = "545a187f9e9d66b0";

export function isApprovedM3PreviewDatabase(): boolean {
  if (process.env.VERCEL_ENV !== "preview"
    || process.env.VERCEL_GIT_COMMIT_REF !== "mission/m3-fulfilment-money-trust"
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

export function isM3ProductionWriteAllowed(organizationId: string): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.VERCEL_ENV === "preview") return isApprovedM3PreviewDatabase();
  return process.env.VERCEL_ENV === "production" && organizationId === M3_CPO_AUDIT_ORGANIZATION_ID;
}
