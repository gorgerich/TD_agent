import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { ESLint } from "eslint";
import { assertProductionTraceBoundary, TOOLING_ONLY_PACKAGES } from "../scripts/check-production-dependency-boundary.mjs";

const require = createRequire(import.meta.url);

test("screenshot test dependency preserves Sharp runtime-optional native packages", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  assert.equal(manifest.optionalDependencies.sharp, lock.packages["node_modules/sharp"].version);
  const nativePackages = Object.entries(lock.packages)
    .filter(([name]) => name.startsWith("node_modules/@img/sharp-"));
  assert.ok(nativePackages.length > 0, "The native-package guard must not be vacuous");
  for (const [name, value] of nativePackages) {
    const entry = value as { dev?: boolean; optional?: boolean };
    assert.notEqual(entry.dev, true, `${name} must survive production-only installation`);
    assert.equal(entry.optional, true, `${name} must retain the existing optional platform boundary`);
  }
});

test("production boundary rejects vulnerable tooling in nested runtime traces and malformed/missing files", () => {
  const manifest = "/synthetic/app/.next/server/app/api/example/route.js.nft.json";
  for (const name of TOOLING_ONLY_PACKAGES) {
    for (const prefix of ["node_modules/", "node_modules/parent/node_modules/"]) {
      const file = path.relative(path.dirname(manifest), `/synthetic/app/${prefix}${name}/index.js`);
      assert.throws(() => assertProductionTraceBoundary(manifest, { files: [file] }), /Tooling-only dependency/);
    }
  }
  for (const value of [null, {}, { files: [1] }]) assert.throws(() => assertProductionTraceBoundary(manifest, value), /Invalid/);
  assert.doesNotThrow(() => assertProductionTraceBoundary(manifest, { files: ["../../../../node_modules/not-braces/index.js"] }));
});

test("actual Next lint configuration never sends source filenames or untrusted patterns to the vulnerable rootDir glob path", async () => {
  const eslint = new ESLint();
  const config = await eslint.calculateConfigForFile("app/agent/login/page.tsx");
  assert.ok(config);
  assert.equal(config.settings?.next?.rootDir, undefined, "Adding rootDir globs requires a renewed dependency risk assessment");
  const pluginDirectory = path.dirname(require.resolve("@next/eslint-plugin-next/package.json"));
  const source = readFileSync(path.join(pluginDirectory, "dist/utils/get-root-dirs.js"), "utf8");
  const exports: { getRootDirs?: (context: unknown) => string[] } = {};
  let globCalls = 0;
  vm.runInNewContext(source, { exports, require: (name: string) => {
    assert.equal(name, "fast-glob");
    return { globSync: () => { globCalls++; throw new Error("Untrusted rootDir glob reached"); } };
  } });
  assert.ok(exports.getRootDirs);
  const maliciousFilename = `${"{".repeat(10_000)}x${"}".repeat(10_000)}.tsx`;
  assert.equal(exports.getRootDirs({ cwd: process.cwd(), settings: config.settings ?? {}, filename: maliciousFilename })[0], process.cwd());
  assert.equal(globCalls, 0);
  assert.throws(() => exports.getRootDirs!({ cwd: process.cwd(), settings: { next: { rootDir: maliciousFilename } } }), /Untrusted rootDir glob reached/);
  assert.equal(globCalls, 1, "Instrumentation must actually trap the vulnerable branch");
});
