import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { inspectDirectMigrationUrl } from "../../lib/migrationTarget";
import { censusOfTarget, findForeignRows, m3UatNamespace } from "../../tests/e2e/uatFixtureGuard";

const PROJECT_ID = "317daa1f-dd94-4c1e-84bb-929abd290d9f";
const ENVIRONMENT_ID = "6a4dc3cb-2eb0-4d33-bbcb-c024fad8dd5c";
const SERVICE_ID = "857fe7b5-0392-4579-9c09-aa10d174b51d";
const PREVIEW_FINGERPRINT = "545a187f9e9d66b0";
const PRODUCTION_FINGERPRINT = "0257665af2dd90a4";
const RUN_ID = "owner-preview-20260925";
const namespace = m3UatNamespace(RUN_ID);
const retainedNamespace = m3UatNamespace("preview-eb568f5");
const credentialDirectory = path.join(homedir(), "Library", "Application Support", "TD Agent M3 Preview UAT");
const credentialFile = path.join(credentialDirectory, "credentials.json");
let stage = "RAILWAY_BINDING";

async function main() {
  if (process.env.CI || process.env.VERCEL === "1") throw new Error("Local owner-run only");
  for (const [name, expected] of Object.entries({
    RAILWAY_PROJECT_ID: PROJECT_ID,
    RAILWAY_ENVIRONMENT_ID: ENVIRONMENT_ID,
    RAILWAY_SERVICE_ID: SERVICE_ID,
  })) {
    if (process.env[name] !== expected) throw new Error(`${name} does not match the exact Railway Preview target`);
  }

  stage = "FINGERPRINT";
  const url = previewPublicUrl();
  const target = inspectDirectMigrationUrl(url);
  if (target.fingerprint === PRODUCTION_FINGERPRINT) throw new Error("Production fingerprint refused");
  if (target.fingerprint !== PREVIEW_FINGERPRINT) throw new Error("Railway Preview fingerprint mismatch");

  stage = "DB_CONNECTION";
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    const state = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5000ms'");
      stage = "DB_IDENTITY";
      const [identity] = await tx.$queryRaw<Array<{ database: string; readOnly: string; recovery: boolean }>>`
        SELECT current_database() AS database,
          current_setting('transaction_read_only') AS "readOnly",
          pg_is_in_recovery() AS recovery
      `;
      stage = "DB_MIGRATION";
      const [migrationTable] = await tx.$queryRaw<Array<{ present: boolean }>>`
        SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present
      `;
      if (!migrationTable?.present) throw new Error("Preview migration table is absent");
      const [migration] = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM _prisma_migrations
        WHERE migration_name = '20260811172829_m3_fulfilment_money_trust'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      `;
      if (migration?.count !== 1n) throw new Error("M3 migration is not complete on Preview");
      stage = "DB_CENSUS";
      const census = await censusOfTarget(tx);
      const [organizations, users, cases, requirements] = await Promise.all([
        tx.organization.count({ where: { id: { in: namespace.organizationIds } } }),
        tx.user.count({ where: { email: { in: namespace.userEmails } } }),
        tx.case.count({ where: { id: { in: [`m3-uat-case:${RUN_ID}:cremation`, `m3-uat-case:${RUN_ID}:burial`] } } }),
        tx.caseDocumentRequirement.count({ where: { organizationId: namespace.organizationIds[0] } }),
      ]);
      return { identity, migrationCount: migration?.count ?? 0n, census, organizations, users, cases, requirements };
    }, { maxWait: 5_000, timeout: 15_000 });

    if (!state.identity || state.identity.database !== target.database || state.identity.recovery || state.identity.readOnly !== "on") {
      throw new Error("Connected database identity or read-only preflight mismatch");
    }
    if (state.migrationCount !== 1n) throw new Error("M3 migration is not complete on Preview");
    stage = "DB_FOREIGN_DATA";
    const foreign = findForeignRows(state.census, [namespace, retainedNamespace]);
    if (foreign.length) {
      const categories: Record<string, number> = {};
      for (const row of foreign) {
        const category = row.slice(0, row.indexOf(":"));
        categories[category] = (categories[category] ?? 0) + 1;
      }
      process.stdout.write(`${JSON.stringify({ status: "BLOCKED_FOREIGN_DATA", count: foreign.length, categories })}\n`);
      throw new Error("Preview contains data outside the two exact synthetic namespaces");
    }

    stage = "DB_FIXTURE_STATE";
    const ready = state.organizations === 2 && state.users === 6 && state.cases === 2 && state.requirements === 7;
    const empty = state.organizations === 0 && state.users === 0 && state.cases === 0 && state.requirements === 0;
    if (!ready && !empty) throw new Error("Preview fixture is partial; refusing to overwrite it");
    stage = "LOCAL_CREDENTIALS";
    const existingCredentials = readCredentials();
    if (ready) {
      if (!existingCredentials) throw new Error("Fixture exists but local credentials are absent; refusing rotation");
      process.stdout.write(`${JSON.stringify({ status: "READY_REPLAY", fingerprint: target.fingerprint, runId: RUN_ID, credentialsFile: credentialFile })}\n`);
      return;
    }

    const password = existingCredentials?.password ?? randomBytes(48).toString("base64url");
    if (!existingCredentials) saveCredentials(password);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: url,
      EXPECTED_DATABASE_FINGERPRINT: PREVIEW_FINGERPRINT,
      M3_PRODUCTION_DATABASE_FINGERPRINT: PRODUCTION_FINGERPRINT,
      M3_UAT_FIXTURE: "1",
      M3_OWNER_SEED_NO_MFA: "1",
      M3_OWNER_SEED_RETAINED_RUN_ID: "preview-eb568f5",
      M3_UAT_RUN_ID: RUN_ID,
      M3_UAT_PASSWORD: password,
    };
    delete env.M3_ALLOW_REMOTE_FIXTURE_CLEANUP;
    stage = "FIXTURE_PROVISION";
    const result = spawnSync(process.execPath, ["--import", "tsx", "tests/e2e/m3-fixture.ts", "provision"], {
      cwd: process.cwd(), env, encoding: "utf8", timeout: 180_000, maxBuffer: 64 * 1024,
    });
    if (result.status !== 0) throw new Error("Synthetic fixture provisioning failed; no cleanup attempted");
    const provisioned = JSON.parse(result.stdout.trim()) as { status?: string };
    if (provisioned.status !== "READY") throw new Error("Synthetic fixture did not report READY");
    process.stdout.write(`${JSON.stringify({ status: "READY", fingerprint: target.fingerprint, runId: RUN_ID, organizations: 2, users: 6, cases: 2, credentialsFile: credentialFile, financeMfa: "ENROLLMENT_REQUIRED" })}\n`);
  } finally {
    await db.$disconnect();
  }
}

function previewPublicUrl(): string {
  if (process.env.DATABASE_PUBLIC_URL) return process.env.DATABASE_PUBLIC_URL;
  const { PGUSER, PGPASSWORD, PGDATABASE, RAILWAY_TCP_PROXY_DOMAIN, RAILWAY_TCP_PROXY_PORT } = process.env;
  if (!PGUSER || !PGPASSWORD || !PGDATABASE || !RAILWAY_TCP_PROXY_DOMAIN || !RAILWAY_TCP_PROXY_PORT) {
    throw new Error("Railway Preview public connection fields are incomplete");
  }
  const url = new URL("postgresql://preview.invalid");
  url.hostname = RAILWAY_TCP_PROXY_DOMAIN;
  url.port = RAILWAY_TCP_PROXY_PORT;
  url.username = PGUSER;
  url.password = PGPASSWORD;
  url.pathname = `/${PGDATABASE}`;
  return url.toString();
}

function readCredentials(): { password: string } | null {
  if (existsSync(credentialDirectory)) {
    const directory = lstatSync(credentialDirectory);
    if (!directory.isDirectory() || (directory.mode & 0o077) !== 0) {
      throw new Error("Local credential directory permissions are unsafe");
    }
  }
  if (!existsSync(credentialFile)) return null;
  const stat = lstatSync(credentialFile);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Local credential file permissions are unsafe");
  const value = JSON.parse(readFileSync(credentialFile, "utf8")) as { password?: unknown };
  if (typeof value.password !== "string" || value.password.length < 32) throw new Error("Local credential file is invalid");
  return { password: value.password };
}

function saveCredentials(password: string) {
  mkdirSync(credentialDirectory, { recursive: true, mode: 0o700 });
  if ((lstatSync(credentialDirectory).mode & 0o077) !== 0) throw new Error("Local credential directory permissions are unsafe");
  const handle = openSync(credentialFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(handle, JSON.stringify({ password }), "utf8");
  } finally {
    closeSync(handle);
  }
}

void main().catch(() => {
  process.stderr.write(`M3 Preview seed BLOCKED_${stage}; no secrets printed.\n`);
  process.exitCode = 1;
});
