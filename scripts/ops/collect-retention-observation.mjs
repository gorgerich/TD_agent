import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const project = "prj_1lA8bU4JS13sSJYKH22oCWuWkB5g";
const scope = "rics-projects-9baa2793";
const route = "/api/internal/rate-limit-retention";
const safeId = (value) => typeof value === "string" && /^[a-zA-Z0-9_:-]{1,160}$/.test(value) ? value : null;

export function observationWindow(now) {
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minute >= 180 && minute <= 275;
}

// Project only provider metadata and the fixed completion schema, never arbitrary log text.
export function sanitizeRetentionRecord(record) {
  if (!record || record.requestPath !== route) return null;
  const time = new Date(record.timestamp);
  if (!Number.isFinite(time.getTime())) return null;
  const status = record.responseStatusCode;
  const completions = [];
  const messages = [record.message, ...(Array.isArray(record.logs) ? record.logs.slice(0, 100).map((log) => log?.message) : [])];
  for (const message of messages) {
    try {
      const event = JSON.parse(message);
      if (event.event === "RATE_LIMIT_RETENTION_COMPLETED"
        && event.trigger === "AUTHENTICATED_ENDPOINT"
        && ["SUCCEEDED", "BACKLOG_REMAINS", "FAILED"].includes(event.outcome)
        && (event.deleted === null || (Number.isSafeInteger(event.deleted) && event.deleted >= 0 && event.deleted <= 4096))
        && (event.outcome === "FAILED" ? event.deleted === null : event.deleted !== null)) {
        completions.push({ outcome: event.outcome, deleted: event.deleted });
      }
    } catch { /* Non-completion messages are intentionally discarded. */ }
  }
  const completion = completions[0] ?? null;
  const conflicting = completions.some((event) => event.outcome !== completion?.outcome || event.deleted !== completion?.deleted);
  return {
    timestamp: time.toISOString(),
    deploymentId: /^dpl_[a-zA-Z0-9]+$/.test(record.deploymentId ?? "") ? record.deploymentId : null,
    requestId: safeId(record.requestId ?? record.id),
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    providerRequestType: record.requestType === "cron" ? "cron" : null,
    scheduledProvenance: record.requestType === "cron" ? "PROVIDER_CLASSIFIED" : "UNVERIFIED",
    cleanup: conflicting ? { outcome: "CONFLICTING_COMPLETION_LOGS", deleted: null }
      : completion ?? { outcome: "NOT_EXPOSED_IN_OBSERVED_LOG", deleted: null },
  };
}

/**
 * @param {Date} now
 * @param {(command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding) => {status: number | null, stdout: string}} run
 * @param {string} directory
 */
export function collectRetentionObservation(now = new Date(), run = spawnSync,
  directory = join(homedir(), "Library", "Application Support", "TD Agent M3 Operator", "cron-observations")) {
  if (!observationWindow(now)) return { state: "OUTSIDE_OBSERVATION_WINDOW" };
  // Use the existing CLI login, not a potentially stale token override or credential fallback.
  const env = { ...process.env };
  delete env.VERCEL_TOKEN;
  const result = run("vercel", ["logs", "--project", project, "--scope", scope,
    "--environment", "production", "--no-branch", "--since", "59m",
    "--query", `requestPath:${route}`, "--limit", "100", "--json"],
  { env, encoding: "utf8", timeout: 45_000, maxBuffer: 4 * 1024 * 1024 });
  const records = [];
  if (result.status === 0) {
    for (const line of result.stdout.split("\n")) {
      try {
        const record = sanitizeRetentionRecord(JSON.parse(line));
        if (record && new Date(record.timestamp).getTime() >= now.getTime() - 59 * 60_000
          && new Date(record.timestamp).getTime() <= now.getTime() + 60_000) records.push(record);
        if (records.length === 100) break;
      } catch { /* Do not persist CLI diagnostics or malformed output. */ }
    }
  }
  const receipt = {
    schema: "td-retention-observation-v1", observedAt: now.toISOString(), project, scope,
    readSucceeded: result.status === 0, records,
    limitation: "No manual cleanup. Missing classification/result is not scheduled success. Correlate provider request details and deployment SHA before certification.",
  };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!lstatSync(directory).isDirectory()) throw new Error("Invalid receipt directory");
  chmodSync(directory, 0o700);
  const path = join(directory, `${now.toISOString().replaceAll(":", "-")}-${randomUUID()}.json`);
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { state: result.status === 0 ? "OBSERVATION_SAVED" : "LOG_READ_FAILED_SAVED", path, records: records.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = collectRetentionObservation();
    console.log(JSON.stringify(result));
    if (result.state === "LOG_READ_FAILED_SAVED") process.exitCode = 1;
  }
  catch { console.error("RETENTION_OBSERVATION_SAVE_FAILED; no secrets printed"); process.exitCode = 1; }
}
