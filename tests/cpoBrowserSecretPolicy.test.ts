import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import test from "node:test";
import { fillProtected, sanitizedCpoFailure } from "./e2e/protectedInput.mjs";
import { authInfrastructurePreflight, sanitizedAuthInfrastructureFailure } from "./e2e/cpo-auth-infrastructure.mjs";
import { createLocalClientHeaders } from "./e2e/localClientIdentity.mjs";
import { clientIp } from "../lib/rateLimit";
import { persistentRateLimitKey } from "../lib/persistentRateLimit";

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
    if (file === "cpo-auth-infrastructure.mjs") {
      assert.match(source, /createLocalClientHeaders\(base\.origin\)/);
      assert.match(source, /extraHTTPHeaders: nextLocalClientHeaders\(\)/);
    }
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
    const stage = name === "E2E_BASE_URL" ? "PREFLIGHT_BASE_URL" : "PREFLIGHT_DATABASE_URL";
    assert.match(result.stderr, new RegExp(`^CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED stage=${stage}(?: cpo-auth-infrastructure\\.mjs:\\d{1,7}:\\d{1,7})?; no secrets printed\\n$`));
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-malformed-url-canary/);
  }
});

function authEnvironment(): Record<string, string> {
  return { E2E_BASE_URL: "http://127.0.0.1:3001", DATABASE_URL_UNPOOLED: "postgresql://synthetic:connection-canary@127.0.0.1:5432/td_agent_test",
    M3_CPO_REPAIR_FIXTURE: "1", APP_ENCRYPTION_KEY: "ci-only-test-key-not-valid-for-production",
    M3_UAT_PASSWORD: "synthetic-password-canary-not-for-output", M3_UAT_MFA_SECRET: "A".repeat(32),
    M3_CPO_REPAIR_FIXTURE_JSON: JSON.stringify({ source: "synthetic-cpo-repair-v1", local: true, origin: "http://127.0.0.1:3001", schema: "public",
      fingerprint: createHash("sha256").update("127.0.0.1:5432/td_agent_test").digest("hex").slice(0, 16) }) };
}

test("auth-infrastructure actual preflight accepts workflow-shaped local inputs without browser/DB startup", () => {
  const stages: string[] = [];
  const result = authInfrastructurePreflight(authEnvironment(), (stage: string) => stages.push(stage));
  assert.equal(result.base.origin, "http://127.0.0.1:3001");
  assert.equal(result.fixture.schema, "public");
  assert.equal(stages.at(-1), "PREFLIGHT_PROTECTED_INPUTS");
  assert.equal(stages.length, 9);
});

test("auth diagnostics allow only known stages/statuses/source locations, never raw messages/headers/seeds", () => {
  const secret = "synthetic-password-token-bypass-connection-canary";
  const error = new Error(secret, { cause: new Error(secret) });
  error.stack = `Error: ${secret}\nCall log: fill(\"${secret}\")\n    at login (/tmp/${secret}/cpo-auth-infrastructure.mjs:141:7)`;
  assert.equal(sanitizedAuthInfrastructureFailure(error, "PASSWORD_RESPONSE", 429), "CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED stage=PASSWORD_RESPONSE status=429 cpo-auth-infrastructure.mjs:141:7; no secrets printed\n");
  assert.equal(sanitizedAuthInfrastructureFailure(secret, secret, secret), "CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED stage=UNKNOWN; no secrets printed\n");
  error.stack = `Error: ${secret}\n    at login (/tmp/${secret}/unapproved.mjs:141:7)`;
  assert.equal(sanitizedAuthInfrastructureFailure(error, "MFA_RESPONSE", 401), "CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED stage=MFA_RESPONSE status=401; no secrets printed\n");
  Object.defineProperty(error, "stack", { get() { throw new Error(secret); } });
  assert.equal(sanitizedAuthInfrastructureFailure(error, "BROWSER_CLEANUP", 999999), "CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED stage=BROWSER_CLEANUP; no secrets printed\n");
});

test("actual auth CLI reports the exact rejecting preflight stage without printing fixture or credential input", () => {
  const cases = [
    { stage: "PREFLIGHT_FIXTURE_JSON", values: { M3_CPO_REPAIR_FIXTURE_JSON: "synthetic-secret-json-canary" } },
    { stage: "PREFLIGHT_FIXTURE_PROVENANCE", values: { M3_CPO_REPAIR_FIXTURE_JSON: JSON.stringify({ source: "synthetic-secret-source-canary" }) } },
    { stage: "PREFLIGHT_PROTECTED_INPUTS", values: { M3_UAT_MFA_SECRET: "synthetic-secret-mfa-canary" } },
  ];
  for (const entry of cases) {
    const result = spawnSync(process.execPath, ["tests/e2e/cpo-auth-infrastructure.mjs"], {
      encoding: "utf8", timeout: 10_000, env: { ...process.env, ...authEnvironment(), ...entry.values },
    });
    assert.equal(result.status, 1); assert.equal(result.signal, null); assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(`^CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED stage=${entry.stage}(?: cpo-auth-infrastructure\\.mjs:\\d{1,7}:\\d{1,7})?; no secrets printed\\n$`));
    assert.doesNotMatch(result.stderr, /synthetic-secret-|connection-canary|synthetic-password-canary-not-for-output/);
  }
});

test("local auth client identity separates shared-IP limiter keys, stays stable per context, and cannot spoof remote requests", () => {
  const request = (headers: Record<string, string>) => new Request("http://127.0.0.1:3001/api/agent/auth/login", { headers: { "x-forwarded-for": "127.0.0.1", ...headers } });
  const common = persistentRateLimitKey("login-ip", clientIp(request({})));
  assert.equal(persistentRateLimitKey("login-ip", clientIp(request({}))), common);
  const next = createLocalClientHeaders("http://127.0.0.1:3001");
  const context = next();
  const isolated = persistentRateLimitKey("login-ip", clientIp(request(context)));
  assert.notEqual(isolated, common);
  assert.equal(persistentRateLimitKey("login-ip", clientIp(request(context))), isolated);
  assert.notEqual(persistentRateLimitKey("login-ip", clientIp(request(next()))), isolated);
  assert.deepEqual(createLocalClientHeaders("https://isolated-preview.vercel.app")(), {});
  assert.deepEqual(createLocalClientHeaders("https://td-agent.vercel.app")(), {});
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
