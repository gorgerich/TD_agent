import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import test from "node:test";
import { fillProtected, sanitizedCpoFailure } from "./e2e/protectedInput.mjs";

test("CPO routes and auth-infrastructure waiters have explicit async ownership", () => {
  for (const file of ["cpo-repair.mjs", "cpo-auth-infrastructure.mjs"]) {
    const source = readFileSync(new URL(`./e2e/${file}`, import.meta.url), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const guarded = new Set<string>();
    let routes = 0, waiters = 0;
    const bindings = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer?.getText(ast).startsWith("asyncScope.guard(")) guarded.add(node.name.getText(ast));
      ts.forEachChild(node, bindings);
    };
    bindings(ast);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        if (node.expression.name.text === "route") {
          const callback = node.arguments[1]!.getText(ast);
          assert.ok(callback.startsWith("asyncScope.guard(") || guarded.has(callback), file);
          routes++;
        }
        if (/^waitFor(Response|Request|URL|Event|Navigation)$/.test(node.expression.name.text)) {
          assert.ok(ts.isCallExpression(node.parent));
          assert.equal(node.parent.expression.getText(ast), "observeLegacyPromise", file);
          waiters++;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.ok(waiters > 0, file);
    assert.equal(routes, file === "cpo-repair.mjs" ? 3 : 0, file);
  }
});

test("CPO preflight sanitizes malformed input before importing a browser or launching resources", () => {
  const result = spawnSync(process.execPath, ["tests/e2e/cpo-repair.mjs"], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, M3_CPO_REPAIR_FIXTURE: "1", M3_UAT_RUN_ID: "secret-policy-unit",
      M3_UAT_PASSWORD: "synthetic-password-canary-not-for-output", M3_UAT_MFA_SECRET: "A".repeat(32),
      E2E_BASE_URL: "synthetic-secret-malformed-url-canary", M3_CPO_REPAIR_FIXTURE_JSON: "null" },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^E2E_CPO_REPAIR_FAILED(?: cpo-repair\.mjs:\d{1,7}:\d{1,7})?\n$/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-malformed-url-canary|synthetic-password-canary-not-for-output/);
});

test("protected fill preserves the requested action and discards secret-bearing failures", async () => {
  const secret = "synthetic-secret-canary";
  let filled = "";
  await fillProtected({ fill: async (value: string) => { filled = value; } }, secret);
  assert.equal(filled, secret);
  const original = new Error(`locator.fill failed; fill(\"${secret}\")`);
  await assert.rejects(fillProtected({ fill: async () => { throw original; } }, secret), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.notEqual(error, original);
    assert.equal(error.message, "E2E_PROTECTED_INPUT_FAILED");
    assert.equal(error.cause, undefined);
    assert.ok(!String(error.stack).includes(secret));
    return true;
  });
});

test("CPO failure diagnostics emit only a static code and allowlisted source location", () => {
  const secret = "synthetic-password-token-canary";
  const original = new Error(secret, { cause: new Error(secret) });
  original.stack = `Error: ${secret}\nCall log: fill(\"${secret}\")\n    at login (/tmp/${secret}/cpo-repair.mjs:71:9)`;
  assert.equal(sanitizedCpoFailure(original), "E2E_CPO_REPAIR_FAILED cpo-repair.mjs:71:9\n");
  assert.equal(sanitizedCpoFailure(secret), "E2E_CPO_REPAIR_FAILED\n");
  Object.defineProperty(original, "stack", { get() { throw new Error(secret); } });
  assert.equal(sanitizedCpoFailure(original), "E2E_CPO_REPAIR_FAILED\n");
});

test("sanitized failure still exits nonzero without printing the original message or call log", () => {
  const script = `import { sanitizedCpoFailure } from './tests/e2e/protectedInput.mjs';
    try { throw new Error('synthetic-secret-canary'); }
    catch (error) { process.stderr.write(sanitizedCpoFailure(error)); process.exitCode = 1; }`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "E2E_CPO_REPAIR_FAILED\n");
});

test("auth failure browser preflight never prints malformed URL input", () => {
  for (const name of ["E2E_BASE_URL", "DATABASE_URL_UNPOOLED"]) {
    const result = spawnSync(process.execPath, ["tests/e2e/cpo-auth-infrastructure.mjs"], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, E2E_BASE_URL: "http://127.0.0.1:1", DATABASE_URL_UNPOOLED: "postgresql://synthetic@127.0.0.1:1/td_agent_test",
        [name]: "synthetic-secret-malformed-url-canary" },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED; no secrets printed\n");
  }
});

test("M3 fixture rejects malformed A/B seeds before target authorization or DB writes", () => {
  for (const name of ["M3_UAT_MFA_SECRET", "M3_UAT_MFA_SECRET_B"]) {
    for (const invalid of ["", "A".repeat(31), "A".repeat(33), "a".repeat(32)]) {
      const result = spawnSync(process.execPath, ["--import", "tsx", "tests/e2e/m3-fixture.ts", "provision"], {
        encoding: "utf8", timeout: 10_000,
        env: { ...process.env, M3_UAT_FIXTURE: "1", M3_UAT_RUN_ID: "secret-policy-unit", M3_OWNER_SEED_NO_MFA: "",
          DATABASE_URL: "postgresql://synthetic:connection-canary@127.0.0.1:1/td_agent_test",
          DATABASE_URL_UNPOOLED: "postgresql://synthetic:connection-canary@127.0.0.1:1/td_agent_test",
          EXPECTED_DATABASE_FINGERPRINT: "0000000000000000", M3_UAT_PASSWORD: "synthetic-password-canary-not-for-output",
          M3_UAT_MFA_SECRET: "A".repeat(32), M3_UAT_MFA_SECRET_B: "B".repeat(32), [name]: invalid },
      });
      assert.equal(result.status, 1);
      assert.equal(result.signal, null);
      assert.match(result.stderr, new RegExp(`${name} must be a valid protected Base32 secret`));
      assert.doesNotMatch(result.stdout + result.stderr, /connection-canary|synthetic-password-canary-not-for-output|PrismaClientInitializationError/);
    }
  }
});
