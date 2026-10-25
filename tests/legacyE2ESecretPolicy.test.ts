import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import * as protectedInput from "./e2e/protectedInput.mjs";
import * as realOrganization from "./e2e/real-organization.mjs";
const { sanitizedLegacyFailure } = protectedInput;

const require = createRequire(import.meta.url);
const files = ["m1-operations.mjs", "m2-admin.mjs", "m2-commercial.mjs", "m3-fulfilment.mjs"];
const canaries = ["synthetic-dynamic-client-link-canary", "synthetic-invite-url-canary", "synthetic-bypass-header-canary"];
const diagnostic = canaries.join(" ");

test("callback failures stay static and failed abort/cleanup cannot escape ownership", async () => {
  let closed = 0;
  let aborted = 0;
  const scope = protectedInput.createLegacyAsyncScope(async () => { closed++; throw new Error(diagnostic); });
  const callback = scope.guard(async () => { throw new assert.AssertionError({ message: diagnostic }); });
  await callback({ abort: async () => { aborted++; throw new Error(diagnostic); } });
  assert.equal(closed, 1);
  assert.equal(aborted, 1);
  assert.throws(() => scope.check(), { message: "E2E_LEGACY_ASYNC_FAILED" });
  await assert.rejects(scope.settle(), { message: "E2E_LEGACY_ASYNC_FAILED" });
});

test("callback ownership preserves concurrent execution and waiter rejection identity", async () => {
  const scope = protectedInput.createLegacyAsyncScope(async () => { assert.fail("successful callbacks must not close resources"); });
  const started: number[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const callback = scope.guard(async (id: number) => { started.push(id); await barrier; return id; });
  const first = callback(1), second = callback(2);
  assert.deepEqual(started, [1, 2]);
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  await scope.settle();
  const failure = new Error(diagnostic);
  const pending = Promise.reject(failure);
  assert.equal(protectedInput.observeLegacyPromise(pending), pending);
  await assert.rejects(pending, (error: unknown) => error === failure);
});

test("every legacy route/dialog callback and browser waiter has explicit async ownership", () => {
  for (const file of files) {
    const source = readFileSync(new URL(`./e2e/${file}`, import.meta.url), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let routes = 0;
    let waiters = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (method === "route" || (method === "once" && node.arguments[0]?.getText(ast) === '"dialog"')) {
          assert.match(node.arguments[1]!.getText(ast), /^asyncScope\.guard\(/, `${file}:${method}`);
          routes++;
        }
        if (/^waitFor(Response|Request|URL|Event|Navigation)$/.test(method)) {
          assert.ok(ts.isCallExpression(node.parent));
          assert.equal(node.parent.expression.getText(ast), "observeLegacyPromise", `${file}:${method}`);
          waiters++;
        }
        if (file === "m2-admin.mjs" && method === "screenshot") {
          assert.match(node.arguments[0]!.getText(ast), /\.\.\.legacySecretScreenshotOptions\(target\)/);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.ok(waiters > 0, file);
    assert.ok(routes > 0, file);
    assert.match(source, /await asyncScope\.settle\(\)/, file);
  }
});

test("legacy failure formatter emits only static code and allowlisted file/line/column", () => {
  for (const file of [...files, "real-organization.mjs", "protectedInput.mjs"]) {
    const error = new Error(diagnostic);
    error.stack = `${diagnostic}\n    at action (/private/${canaries[1]}/${file}:71:9)`;
    assert.equal(sanitizedLegacyFailure(error), `E2E_LEGACY_FAILED ${file}:71:9\n`);
    error.stack = `${diagnostic}\n    at action (/private/${canaries[1]}/unknown.mjs:71:9)`;
    assert.equal(sanitizedLegacyFailure(error), "E2E_LEGACY_FAILED\n");
    error.stack = `${diagnostic}\n    at action (/private/${file}:123456789:9)`;
    assert.equal(sanitizedLegacyFailure(error), "E2E_LEGACY_FAILED\n");
  }
  assert.equal(sanitizedLegacyFailure(diagnostic), "E2E_LEGACY_FAILED\n");
  const hostile = Object.defineProperty(new Error(), "stack", { get() { throw new Error(diagnostic); } });
  assert.equal(sanitizedLegacyFailure(hostile), "E2E_LEGACY_FAILED\n");
});

test("sanitized failure still exits nonzero after cleanup without leaking canaries", () => {
  const script = `import { sanitizedLegacyFailure } from './tests/e2e/protectedInput.mjs';
    try { throw new Error(${JSON.stringify(diagnostic)}); }
    catch (error) { process.stderr.write(sanitizedLegacyFailure(error)); process.exitCode = 1; }
    finally { process.stdout.write('CLEANUP_RAN\\n'); }`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "CLEANUP_RAN\n");
  assert.equal(result.stderr, "E2E_LEGACY_FAILED\n");
  for (const canary of canaries) assert.equal((result.stdout + result.stderr).includes(canary), false);
});

test("all four actual legacy scripts sanitize startup, journey and cleanup failures and close owned resources", async () => {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const file of files) {
    const url = new URL(`./e2e/${file}`, import.meta.url);
    const source = readFileSync(url, "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      transformers: { before: [(context) => {
        const visit: ts.Visitor = (node) => {
          if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === "url") {
            return ts.factory.createStringLiteral(url.href);
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (node) => ts.visitNode(node, visit) as ts.SourceFile;
      }] },
    }).outputText;
    for (const stage of ["launch", "context", "page", "journey", "context-close", "browser-close"]) {
      const output: string[] = [];
      const state = { contextClosed: 0, browserClosed: 0 };
      const failure = () => {
        throw new assert.AssertionError({ message: diagnostic, actual: canaries[0], expected: canaries[2], operator: "strictEqual" });
      };
      const page = { on() {}, setViewportSize: async () => {}, goto: async () => failure() };
      const context = {
        newPage: async () => stage === "page" ? failure() : page,
        close: async () => { state.contextClosed++; if (stage === "context-close") failure(); },
      };
      const browser = {
        newContext: async () => stage === "context" ? failure() : context,
        close: async () => { state.browserClosed++; if (stage === "browser-close") failure(); },
      };
      const fakeProcess = {
        env: {
          M1_UAT_PASSWORD: "synthetic-password-".repeat(3), M2_UAT_PASSWORD: "synthetic-password-".repeat(3),
          M3_UAT_PASSWORD: "synthetic-password-".repeat(3), M2_UAT_RUN_ID: "synthetic",
          M2_UAT_ACTIVATION_TOKEN: canaries[1], M2_UAT_RECOVERY_TOKEN: canaries[1],
          M2_UAT_MFA_SECRET: "A".repeat(32), M3_UAT_MFA_SECRET: "A".repeat(32),
          M3_PAYMENT_WEBHOOK_SECRET: "synthetic-webhook-secret-".repeat(3), E2E_PROTECTION_BYPASS: canaries[2],
        },
        stdout: { write: (value: string) => { output.push(value); } },
        stderr: { write: (value: string) => { output.push(value); } },
        exitCode: undefined as number | undefined,
      };
      const dependencies: Record<string, unknown> = {
        playwright: { chromium: { launch: async () => stage === "launch" ? failure() : browser } },
        "./protectedInput.mjs": protectedInput,
        "./real-organization.mjs": realOrganization,
        "node:module": { createRequire: () => ({ resolve: () => "synthetic-axe-path" }) },
        "../cpoAuditDocuments.fixture.mjs": { syntheticDocumentPdf: () => new Uint8Array() },
      };
      const testModule = { exports: {} };
      await new AsyncFunction("require", "module", "exports", "process", code)(
        (key: string) => Object.hasOwn(dependencies, key) ? dependencies[key] : require(key),
        testModule, testModule.exports, fakeProcess,
      );
      assert.equal(fakeProcess.exitCode, 1, `${file}:${stage} must fail`);
      assert.equal(state.browserClosed, stage === "launch" ? 0 : 1, `${file}:${stage} browser cleanup`);
      assert.equal(state.contextClosed, ["launch", "context"].includes(stage) ? 0 : 1, `${file}:${stage} context cleanup`);
      assert.ok(output.length >= 1, `${file}:${stage} must report failure`);
      for (const line of output) assert.match(line, /^E2E_LEGACY_FAILED(?: (?:m1-operations|m2-admin|m2-commercial|m3-fulfilment|protectedInput)\.mjs:\d{1,7}:\d{1,7})?\n$/);
      for (const canary of canaries) assert.equal(output.join("").includes(canary), false, `${file}:${stage}`);
    }
  }
});

test("new authenticated onboarding refuses Production and foreign origins before any request", async () => {
  const previous = process.env.M2_UAT_FIXTURE;
  process.env.M2_UAT_FIXTURE = "1";
  try {
    let requests = 0;
    for (const baseUrl of ["https://td-agent.vercel.app", "https://example.com", "https://td-agent.invalid", "https://td-agent-x-foreign.vercel.app"]) {
      await assert.rejects(realOrganization.verifyRealOrganizationOnboarding({ browser: null, totp: () => "", screenshot: null, baseUrl, runId: "synthetic", password: canaries[0],
        platformPage: { context: () => { requests++; throw new Error(diagnostic); } } }));
    }
    assert.equal(requests, 0);
  } finally {
    if (previous === undefined) delete process.env.M2_UAT_FIXTURE;
    else process.env.M2_UAT_FIXTURE = previous;
  }
});
