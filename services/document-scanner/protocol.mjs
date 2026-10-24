export const SCANNER_PROVIDER = "clamav-http-v1";

export function readySnapshot(value, now = Date.now()) {
  if (!value || value.provider !== SCANNER_PROVIDER || value.ready !== true
    || typeof value.engineVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(value.engineVersion)
    || !Number.isSafeInteger(value.signatureVersion) || value.signatureVersion <= 0
    || typeof value.definitionsAt !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.definitionsAt)) return false;
  const at = Date.parse(value.definitionsAt);
  return Number.isFinite(at) && new Date(at).toISOString() === value.definitionsAt
    && at <= now + 60_000 && now - at <= 48 * 60 * 60_000;
}
