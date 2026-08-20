import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
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

const env = {
  ...process.env,
  ALLOW_DB_TESTS: "1",
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  DATABASE_URL_UNPOOLED: process.env.TEST_DATABASE_URL,
};

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Integration child terminated by ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}

let testExit = 1;
try {
  const installExit = await run(["--import", "tsx", "tests/integration/_m3Baseline.ts", "install"]);
  if (installExit !== 0) throw new Error("M3 integration baseline install failed.");
  testExit = await run(["--import", "tsx", "--test", ...files]);
} finally {
  const cleanupExit = await run(["--import", "tsx", "tests/integration/_m3Baseline.ts", "cleanup"]);
  if (cleanupExit !== 0) throw new Error("M3 integration baseline cleanup failed.");
}

process.exitCode = testExit;
