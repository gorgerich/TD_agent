export function isDeployedProductionDocumentRuntime(): boolean {
  return process.env.VERCEL_ENV === "production"
    || (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "preview");
}
