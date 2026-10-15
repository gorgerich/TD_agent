import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";

const root = process.cwd();
assert.ok(process.argv.slice(2).every((argument) => ["--targeted", "--browser", "--cpo-browser"].includes(argument)), "Unknown local gate option");
const targetedOnly = process.argv.includes("--targeted");
const cpoBrowserOnly = process.argv.includes("--cpo-browser");
const browserOnly = process.argv.includes("--browser") || cpoBrowserOnly;
assert.ok(process.argv.length <= 3, "Choose one gate scope");
const direct = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://silkwayrally@127.0.0.1:5432/td_agent_test");
assert.ok(["localhost", "127.0.0.1", "::1"].includes(direct.hostname));
assert.equal(direct.pathname, "/td_agent_test");
assert.ok(["postgres:", "postgresql:"].includes(direct.protocol));
const fingerprint = createHash("sha256").update(`${direct.hostname}:${direct.port || "5432"}${direct.pathname}`).digest("hex").slice(0, 16);
assert.notEqual(fingerprint, "0257665af2dd90a4");
const runId = `cpo-repair-${randomBytes(8).toString("hex")}`;
const schema = `m3_cpo_repair_${randomBytes(8).toString("hex")}`;
const url = new URL(direct);
url.searchParams.set("schema", schema);
const output = mkdtempSync(path.join(tmpdir(), "td-agent-cpo-gate-"));
const socket = createServer();
await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
function base32(bytes) {
  let value = 0, bits = 0, result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { result += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return result;
}
const pgBin = process.env.LOCAL_POSTGRES_BIN ?? (existsSync("/usr/local/opt/postgresql@18/bin/pg_dump") ? "/usr/local/opt/postgresql@18/bin" : "");
const env = { ...process.env, PATH: pgBin ? `${pgBin}:${process.env.PATH}` : process.env.PATH, CI: "true", DATABASE_URL: url.href, DATABASE_URL_UNPOOLED: url.href, TEST_DATABASE_URL: url.href,
  ALLOW_DB_TESTS: "1", APP_ENCRYPTION_KEY: randomBytes(32).toString("hex"), SESSION_SECRET: randomBytes(48).toString("hex"),
  DEMO_MODE: "1", RELEASE_WRITE_FREEZE: "disabled", EXPECTED_DATABASE_FINGERPRINT: fingerprint,
  M1_UAT_FIXTURE: "1", M2_UAT_FIXTURE: "1", M3_UAT_FIXTURE: "1", M1_UAT_RUN_ID: runId, M2_UAT_RUN_ID: runId, M3_UAT_RUN_ID: runId,
  M1_UAT_PASSWORD: randomBytes(36).toString("base64url") + "!Aa9", M2_UAT_PASSWORD: randomBytes(36).toString("base64url") + "!Aa9",
  M3_UAT_PASSWORD: randomBytes(36).toString("base64url") + "!Aa9", M2_UAT_ACTIVATION_TOKEN: randomBytes(32).toString("base64url"),
  M2_UAT_RECOVERY_TOKEN: randomBytes(32).toString("base64url"), M2_UAT_MFA_SECRET: base32(randomBytes(20)),
  M3_UAT_MFA_SECRET: base32(randomBytes(20)), M3_UAT_MFA_SECRET_B: base32(randomBytes(20)),
  M3_PAYMENT_WEBHOOK_SECRET: randomBytes(32).toString("hex"), M3_PAYMENT_WEBHOOK_PROVIDER: "synthetic",
  M3_PRODUCTION_DATABASE_FINGERPRINT: "0257665af2dd90a4", E2E_BASE_URL: `http://127.0.0.1:${port}`,
  M3_CPO_REPAIR_FIXTURE: "1", M3_CPO_REPAIR_SCHEMA: schema };
// Never inherit a deployed environment or storage credential into the local harness.
for (const key of Object.keys(env)) if (key.startsWith("VERCEL_") || key.startsWith("BLOB_") || key.startsWith("M3_PREVIEW_")) delete env[key];
function sourceDigest() {
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
  assert.equal(listed.status, 0);
  const hash = createHash("sha256");
  for (const file of [...new Set(listed.stdout.split("\0"))].filter((file) => /\.(?:tsx?|mjs|json|sql|ya?ml|css)$/.test(file)).sort()) {
    hash.update(file + "\0").update(existsSync(path.join(root, file)) ? readFileSync(path.join(root, file)) : "DELETED");
  }
  return hash.digest("hex");
}
const report = { scope: targetedOnly ? "TARGETED_REPEAT" : cpoBrowserOnly ? "CPO_BROWSER_REWORK" : browserOnly ? "BROWSER_REWORK" : "FULL", schema, fingerprint, sourceDigest: sourceDigest(), production: "UNCHANGED", gates: [] };
function save() { writeFileSync(path.join(output, "receipt.json"), JSON.stringify(report, null, 2), { mode: 0o600 }); }
function command(name, executable, args, overrides = {}) {
  const started = Date.now();
  const result = spawnSync(executable, args, { cwd: root, env: { ...env, ...overrides }, encoding: "utf8", timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  for (const [key, value] of Object.entries(env)) if (/PASSWORD|TOKEN|SECRET|ENCRYPTION_KEY/.test(key) && value) assert.ok(!log.includes(value), "SECRET_OUTPUT_DETECTED");
  writeFileSync(path.join(output, `${name}.log`), log, { mode: 0o600 });
  report.gates.push({ name, exit: result.status, durationMs: Date.now() - started }); save();
  console.log(JSON.stringify(report.gates.at(-1)));
  assert.equal(result.status, 0, `GATE_${name}_FAILED`);
  return log;
}
let server;
const ownedDatabases = [];
function createDatabase(suffix) {
  const name = `${schema}_${suffix}`;
  assert.match(name, /^[a-z0-9_]{1,63}$/);
  command(`${suffix}-create`, "psql", [direct.href, "-X", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${name}"`]);
  ownedDatabases.push(name);
  const result = new URL(direct); result.pathname = `/${name}`; result.search = "";
  return result;
}
function legacyFixture() {
  const fixture = createDatabase("legacy");
  const files = [
    "prisma/migrations/20260713000000_baseline/migration.sql", "tests/migrations/week2-backfill-fixtures.sql",
    "prisma/migrations/20260714090000_week2_canonical_case/migration.sql", "tests/migrations/week2-backfill-assertions.sql",
    "prisma/migrations/20260718090000_m1_operations_control_plane/migration.sql", "prisma/migrations/20260719190000_m1_operations_integrity/migration.sql", "tests/migrations/m1-operations-assertions.sql",
    "prisma/migrations/20260726090000_m2_platform_admin_rbac/migration.sql", "prisma/migrations/20260726150000_m2_platform_admin_activation/migration.sql",
    "prisma/migrations/20260728120000_m2_platform_admin_mfa/migration.sql", "prisma/migrations/20260728130000_m2_platform_admin_activation_revoke/migration.sql",
    "prisma/migrations/20260728190000_m1_platform_owner_recovery/migration.sql", "tests/migrations/m2-admin-assertions.sql", "tests/migrations/m2-commercial-fixtures.sql",
    "prisma/migrations/20260729170000_m2_commercial_trust_loop/migration.sql", "tests/migrations/m2-commercial-assertions.sql", "tests/migrations/m3-fulfilment-fixtures.sql",
    "prisma/migrations/20260811172829_m3_fulfilment_money_trust/migration.sql", "tests/migrations/m3-fulfilment-assertions.sql",
    "prisma/migrations/20261013183000_cpo_document_review_repair/migration.sql", "prisma/migrations/20261013190000_case_requirement_supersession/migration.sql", "tests/migrations/m3-fulfilment-assertions.sql",
  ];
  files.forEach((file, index) => command(`legacy-${index}`, "psql", [fixture.href, "-X", "-v", "ON_ERROR_STOP=1", "-f", file]));
}
function fixtureSnapshot(database) {
  const tables = JSON.parse(command("restore-table-list", "psql", [database.href, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c",
    `SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]'::json) FROM pg_tables WHERE schemaname='${schema}'`]));
  tables.forEach((table) => assert.match(table, /^[A-Za-z0-9_]+$/));
  const sql = `SELECT json_object_agg(name,value) FROM (${tables.map((table) => `SELECT '${table}' AS name,json_build_object('count',count(*),'digest',md5(coalesce(string_agg(md5(row_to_json(row)::text),'' ORDER BY md5(row_to_json(row)::text)),''))) AS value FROM "${schema}"."${table}" row`).join(" UNION ALL ")}) counts`;
  return JSON.parse(command("restore-counts-digests", "psql", [database.href, "-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]));
}
function encryptedFixtureRestore() {
  const before = fixtureSnapshot(direct);
  const keys = path.join(output, "keys"); mkdirSync(keys, { mode: 0o700 });
  const keyFile = path.join(keys, "restore.key");
  writeFileSync(keyFile, randomBytes(48).toString("hex"), { mode: 0o600, flag: "wx" });
  const archive = path.join(output, "fixture.dump.gpg");
  const dump = spawnSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--schema", schema, direct.href], { cwd: root, env, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(dump.status, 0, "FIXTURE_DUMP_FAILED");
  const encrypted = spawnSync("gpg", ["--batch", "--pinentry-mode", "loopback", "--passphrase-file", keyFile, "--symmetric", "--cipher-algo", "AES256", "--output", archive], { input: dump.stdout, env, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(encrypted.status, 0, "FIXTURE_ENCRYPTION_FAILED");
  const decoded = spawnSync("gpg", ["--batch", "--pinentry-mode", "loopback", "--passphrase-file", keyFile, "--decrypt", archive], { env, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(decoded.status, 0, "FIXTURE_DECRYPTION_FAILED");
  const clone = createDatabase("restore");
  const restored = spawnSync("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", "--dbname", clone.href], { input: decoded.stdout, env, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(restored.status, 0, "REAL_FIXTURE_RESTORE_FAILED");
  assert.deepEqual(fixtureSnapshot(clone), before);
  clone.searchParams.set("schema", schema);
  const override = { DATABASE_URL: clone.href, DATABASE_URL_UNPOOLED: clone.href };
  assert.match(command("restore-noop", process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], override), /No pending migrations/);
  command("restore-parity", process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-url", clone.href, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"], override);
  report.restore = { status: "PASS", syntheticOnly: true, countsAndDigests: "MATCH", encrypted: "AES256", plaintextDump: "NONE", tables: Object.keys(before).length };
  save();
}
try {
  if (targetedOnly) {
    for (let attempt = 1; attempt <= 5; attempt++) command(`targeted-${attempt}`, "npm", ["run", "test:integration", "--",
      "tests/integration/cpo02FirstOrganizationAdmin.itest.ts", "tests/integration/cpoAuditFinance.itest.ts",
      "tests/integration/cpoAuditDocuments.itest.ts", "tests/integration/cpoScenarioCorrection.itest.ts",
      "tests/integration/cpoMfaEnrollment.itest.ts", "tests/integration/cpoSessionRevocation.itest.ts", "tests/integration/commercialQuotes.itest.ts",
    ], { TEST_DATABASE_URL: direct.href, DATABASE_URL: direct.href, DATABASE_URL_UNPOOLED: direct.href });
  } else {
  command("diff", "git", ["diff", "--check"]);
  command("lint", "npm", ["run", "lint"]);
  command("typecheck", "npm", ["run", "typecheck"]);
  if (!browserOnly) {
    command("unit", "npm", ["run", "test:unit"]);
    command("integration", "npm", ["run", "test:integration"], { TEST_DATABASE_URL: direct.href, DATABASE_URL: direct.href, DATABASE_URL_UNPOOLED: direct.href });
    legacyFixture();
  }
  command("migration", process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  assert.match(command("noop", process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]), /No pending migrations/);
  command("parity", process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-url", url.href, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
  command("build", "npm", ["run", "build"]);
  for (const mission of ["m1", "m2", "m3"]) command(`${mission}-fixture`, process.execPath, ["--import", "tsx", `tests/e2e/${mission}-fixture.ts`, "provision"]);
  env.M3_CPO_REPAIR_FIXTURE_JSON = command("cpo-fixture", process.execPath, ["--import", "tsx", "tests/e2e/cpo-repair-fixture.ts", "provision"]).trim();
  encryptedFixtureRestore();
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    cwd: root, env: { ...env, M3_DOCUMENT_STORAGE: "isolated-filesystem", M3_DOCUMENT_SCANNER: "synthetic-preview", PREVIEW_DB_ISOLATION: "PASS", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "mission/m3-fulfilment-money-trust" }, stdio: "ignore",
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(`${env.E2E_BASE_URL}/agent/login`)).ok; } catch { /* Server is starting. */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(ready, "LOCAL_SERVER_UNAVAILABLE");
  if (cpoBrowserOnly) command("cpo-e2e", process.execPath, ["tests/e2e/cpo-repair.mjs"]);
  else command("e2e", "npm", ["run", "test:e2e"]);
  command("auth-failure-browser", process.execPath, ["tests/e2e/cpo-auth-infrastructure.mjs"]);
  command("component-browser", "npm", ["run", "test:ui-components"]);
  }
  assert.equal(sourceDigest(), report.sourceDigest, "SOURCE_CHANGED_DURING_GATE");
} finally {
  if (server && server.exitCode === null && server.signalCode === null) { server.kill(); await new Promise((resolve) => server.once("exit", resolve)); }
  // The schema name is generated locally and never accepted from a caller.
  const cleanup = spawnSync("psql", [direct.href, "-X", "-v", "ON_ERROR_STOP=1", "-c", `DROP SCHEMA IF EXISTS "${schema}" CASCADE`], { encoding: "utf8", env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" } });
  const dropped = ownedDatabases.map((name) => spawnSync("psql", [direct.href, "-X", "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE "${name}"`], { encoding: "utf8", env }).status);
  report.cleanup = cleanup.status === 0 && dropped.every((status) => status === 0) ? "PASS" : "FAIL"; save();
  console.log(JSON.stringify({ receipt: path.join(output, "receipt.json"), cleanup: report.cleanup }));
  assert.equal(cleanup.status, 0, "LOCAL_SCHEMA_CLEANUP_FAILED");
  assert.ok(dropped.every((status) => status === 0), "LOCAL_DATABASE_CLEANUP_FAILED");
}
