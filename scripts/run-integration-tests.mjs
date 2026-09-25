import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import path from "node:path";

const root = process.cwd();
const requestedFiles = process.argv.slice(2);
const files = requestedFiles.length > 0
  ? requestedFiles
  : (await readdir(path.join(root, "tests/integration")))
    .filter((name) => name.endsWith(".itest.ts"))
    .sort()
    .map((name) => `tests/integration/${name}`);

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for integration tests.");

const baseUrl = new URL(process.env.TEST_DATABASE_URL);
const approvedDatabase = [
  "td_agent_test",
  "td_agent_m1_local_20260718",
  "td_agent_m2_test",
  "td_agent_m3_20260811_a",
  "td_agent_m3_20260811_b",
].includes(decodeURIComponent(baseUrl.pathname.slice(1)).toLowerCase());
if (!["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname.toLowerCase()) || !approvedDatabase) {
  throw new Error("Integration schema isolation requires an approved local throwaway database.");
}

function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Integration child terminated by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

function schemaEnvironment(file, index) {
  const label = path.basename(file, ".itest.ts").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  const schema = `it_${process.pid}_${index}_${label}`.slice(0, 63);
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schema);
  const databaseUrl = url.toString();
  return {
    schema,
    baselineInstalled: false,
    env: {
      ...process.env,
      ALLOW_DB_TESTS: "1",
      TEST_DATABASE_URL: databaseUrl,
      DATABASE_URL: databaseUrl,
      DATABASE_URL_UNPOOLED: databaseUrl,
    },
  };
}

const targets = files.map(schemaEnvironment);
let testExit = 0;

try {
  for (const target of targets) {
    const migrateExit = await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], target.env);
    if (migrateExit !== 0) throw new Error(`Integration migration failed for ${target.schema}.`);
    const installExit = await run(["--import", "tsx", "tests/integration/_m3Baseline.ts", "install"], target.env);
    if (installExit !== 0) throw new Error(`M3 integration baseline install failed for ${target.schema}.`);
    target.baselineInstalled = true;
  }

  const exits = Array(targets.length).fill(1);
  let nextTarget = 0;
  const workers = Array.from({
    length: Math.min(targets.length, Math.max(2, Math.min(4, availableParallelism() - 1))),
  }, async () => {
    while (nextTarget < targets.length) {
      const index = nextTarget;
      nextTarget += 1;
      exits[index] = await run(["--import", "tsx", "--test", files[index]], targets[index].env);
    }
  });
  await Promise.all(workers);
  if (exits.some((code) => code !== 0)) testExit = 1;
} finally {
  for (const target of targets) {
    if (target.baselineInstalled) {
      const cleanupExit = await run(["--import", "tsx", "tests/integration/_m3Baseline.ts", "cleanup"], target.env);
      if (cleanupExit !== 0) testExit = 1;
    }
    const dropExit = await new Promise((resolve, reject) => {
      const child = spawn("psql", [process.env.TEST_DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-c", `DROP SCHEMA IF EXISTS \"${target.schema}\" CASCADE`], {
        cwd: root,
        env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" },
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) reject(new Error(`Schema cleanup terminated by ${signal}.`));
        else resolve(code ?? 1);
      });
    });
    if (dropExit !== 0) testExit = 1;
  }
}

process.exitCode = testExit;
