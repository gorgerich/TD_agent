import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("local CPO gate separates machine-readable stdout from diagnostic stderr", () => {
  const source = readFileSync("scripts/test-cpo-repair-local.mjs", "utf8");
  const start = source.indexOf("function command(");
  const end = source.indexOf("\nlet server;", start);
  assert.ok(start >= 0 && end > start);
  const command = source.slice(start, end);
  const manifest = { source: "synthetic-cpo-repair-v1", publicationPending: false };
  const stdout = `${JSON.stringify(manifest)}\n`;
  const stderr = '{"stage":"CPO_SCENARIO_TRANSACTION","commitAcknowledged":true}\n';
  const secret = "explicit-unit-only-secret";
  for (const sample of [
    { stdout, stderr, status: 0, expected: "success" },
    { stdout: secret, stderr, status: 0, expected: "SECRET_OUTPUT_DETECTED" },
    { stdout, stderr: secret, status: 0, expected: "SECRET_OUTPUT_DETECTED" },
    { stdout, stderr, status: 1, expected: "GATE_cpo-fixture_FAILED" },
  ]) {
    const logs: string[] = [];
    const context = {
      assert, root: "unit-only", output: "unit-only", env: { M3_UAT_PASSWORD: secret },
      report: { gates: [] }, save: () => {}, console: { log: () => {} },
      path: { join: (...parts: string[]) => parts.join("/") },
      spawnSync: () => sample,
      writeFileSync: (_file: string, text: string) => { logs.push(text); },
    };
    const execute = () => runInNewContext(`${command}\ncommand("cpo-fixture", "node", []);`, context);
    if (sample.expected === "success") {
      assert.deepEqual(JSON.parse(execute()), manifest);
      assert.deepEqual(logs, [stdout + stderr]);
    } else {
      assert.throws(execute, new RegExp(sample.expected));
      if (sample.expected === "SECRET_OUTPUT_DETECTED") assert.equal(logs.length, 0);
      else assert.deepEqual(logs, [stdout + stderr]);
    }
  }
});

test("CPO fixture diagnostics expose only a fixed stage and a bounded Prisma code", () => {
  const source = readFileSync("tests/e2e/cpo-repair-fixture.ts", "utf8");
  assert.ok(source.includes('stage = "verify-target-identity"'));
  assert.ok(source.includes('stage = "verify-synthetic-census"'));
  const emitted = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const handler = emitted.slice(emitted.lastIndexOf("main().catch("));
  assert.ok(handler.startsWith("main().catch("));
  for (const [error, code] of [
    [new Error("private connection details"), "FIXTURE_FAILED"],
    [{ code: "P1001", message: "private connection details" }, "P1001"],
    [{ code: "P1001-private-connection", message: "secret" }, "FIXTURE_FAILED"],
    [null, "FIXTURE_FAILED"],
    ["secret", "FIXTURE_FAILED"],
  ] as const) {
    let output = "";
    const process = { stderr: { write: (text: string) => { output += text; } }, exitCode: 0 };
    runInNewContext(handler, {
      stage: "verify-synthetic-census", process,
      main: () => ({ catch: (reject: (error: unknown) => void) => reject(error) }),
    });
    assert.equal(process.exitCode, 1);
    assert.equal(output, `CPO fixture refused or failed at verify-synthetic-census; code=${code}; no connection details emitted\n`);
  }
});

test("first ADMIN forwarding diagnostics never expose request keys, payload or transport errors", async () => {
  const source = readFileSync("tests/e2e/cpo-repair.mjs", "utf8");
  const start = source.indexOf("    firstDelivery.intercepted = true;");
  const end = source.indexOf("\n  }), { times: 1 });", start);
  assert.ok(start >= 0 && end > start);
  const secret = "explicit-unit-only-private-value";
  for (const status of [201, 401, 500, null]) {
    let output = "";
    let aborts = 0;
    const firstDelivery = { intercepted: false, upstreamStatus: null, aborted: false };
    const execution = runInNewContext(`(async () => {${source.slice(start, end)}\n})()`, {
      assert, firstDelivery, firstKey: null, firstPayload: null,
      process: { stderr: { write: (text: string) => { output += text; } } },
      route: {
        request: () => ({ headers: () => ({ "idempotency-key": secret }), postData: () => secret }),
        fetch: async () => { if (status === null) throw new Error(secret); return { status: () => status }; },
        abort: async () => { aborts++; },
      },
    });
    if (status === 201) {
      await execution;
      assert.equal(output, "");
      assert.equal(aborts, 1);
      assert.equal(firstDelivery.aborted, true);
    } else {
      await assert.rejects(execution);
      assert.equal(aborts, 0);
      const diagnostic = JSON.parse(output);
      assert.deepEqual(Object.keys(diagnostic).sort(), ["aborted", "code", "intercepted", "upstreamStatus"]);
      assert.equal(diagnostic.upstreamStatus, status);
      assert.equal(diagnostic.intercepted, true);
      assert.equal(diagnostic.aborted, false);
    }
    assert.equal(output.includes(secret), false);
  }
});

test("Finance navigation counter is initialized before the real first payment invocation", async () => {
  const source = readFileSync("tests/e2e/m3-fulfilment.mjs", "utf8");
  const declaration = "let paymentNavigationAttempt = 0;";
  const initialization = source.indexOf(declaration);
  const call = source.indexOf("  await recordPayment(page, cases.cremation.publicRef,");
  const start = source.indexOf("async function recordPayment(");
  const end = source.indexOf("\n  const row = obligationRow", start);
  assert.ok(initialization >= 0 && call >= 0 && start > call && end > start);
  const invocation = source.slice(call, source.indexOf("\n", call));
  const navigation = `${source.slice(start, end)}\n}`;
  const error = new Error("explicit-unit-only-navigation-failure");
  for (const originalOrder of [true, false]) {
    let calls = 0;
    let output = "";
    const statements = originalOrder
      ? [{ at: initialization, text: declaration }, { at: call, text: invocation }].sort((a, b) => a.at - b.at).map(item => item.text).join("\n")
      : `${invocation}\n${declaration}`;
    const execution = runInNewContext(`(async () => {\n${statements}\n${navigation}\n})()`, {
      URL, baseUrl: "https://unit.invalid", cases: { cremation: { publicRef: "synthetic" } },
      page: { goto: async () => { calls++; throw error; }, isClosed: () => false,
        url: () => "https://unit.invalid/agent/finance" },
      process: { stderr: { write: (text: string) => { output += text; } } },
    });
    if (originalOrder) {
      await assert.rejects(execution, (failure: unknown) => failure === error);
      assert.equal(calls, 1);
      assert.equal(JSON.parse(output).attempt, 1);
    } else {
      await assert.rejects(execution, (failure: unknown) => (failure as Error).name === "ReferenceError");
      assert.equal(calls, 0);
      assert.equal(output, "");
    }
  }
});

test("Finance navigation failure diagnostics preserve rejection without exposing error messages or URLs", async () => {
  const source = readFileSync("tests/e2e/m3-fulfilment.mjs", "utf8");
  const start = source.indexOf("  const attempt = ++paymentNavigationAttempt;");
  const end = source.indexOf("\n  const row = obligationRow", start);
  assert.ok(start >= 0 && end > start);
  const secret = "explicit-unit-only-private-navigation";
  for (const sample of [
    { error: Object.assign(new Error(secret), { name: "TimeoutError" }), timeout: true, aborted: false, closed: false },
    { error: new Error(`net::ERR_ABORTED ${secret}`), timeout: false, aborted: true, closed: false },
    { error: new Error(secret), timeout: false, aborted: false, closed: true },
    { error: null, timeout: false, aborted: false, closed: false },
  ]) {
    let output = "";
    const execution = runInNewContext(`(async () => {${source.slice(start, end)}\n})()`, {
      URL, baseUrl: "https://unit.invalid", paymentNavigationAttempt: 0,
      process: { stderr: { write: (text: string) => { output += text; } } },
      target: { goto: async () => { throw sample.error; }, isClosed: () => sample.closed,
        url: () => `https://unit.invalid/agent/finance?token=${secret}` },
    });
    await assert.rejects(execution, (error: unknown) => error === sample.error);
    assert.deepEqual(JSON.parse(output), { code: "E2E_M3_FINANCE_NAVIGATION_FAILED", attempt: 1,
      timeout: sample.timeout, aborted: sample.aborted, closed: sample.closed, atFinance: !sample.closed });
    assert.equal(output.includes(secret), false);
  }
});

test("CPO target identity guard refuses every mismatch and emits only comparison flags", async () => {
  const source = readFileSync("tests/e2e/cpo-repair-fixture.ts", "utf8");
  const start = source.indexOf("  if (rows.length !== 1 || rows[0].database");
  const end = source.indexOf("\n  const namespaces", start);
  assert.ok(start >= 0 && end > start);
  const secret = "explicit-unit-only-unknown-target";
  for (const sample of [
    { rows: [], databaseMatches: false, schemaMatches: false, writable: false },
    { rows: [{ database: secret, schema: "unit", readOnly: "off" }], databaseMatches: false, schemaMatches: true, writable: true },
    { rows: [{ database: "unit", schema: secret, readOnly: "off" }], databaseMatches: true, schemaMatches: false, writable: true },
    { rows: [{ database: "unit", schema: "unit", readOnly: "on" }], databaseMatches: true, schemaMatches: true, writable: false },
  ]) {
    let output = "";
    assert.throws(() => runInNewContext(source.slice(start, end), { rows: sample.rows,
      target: { database: "unit" }, schema: "unit", process: { stderr: { write: (text: string) => { output += text; } } },
    }), /Target identity mismatch/);
    assert.deepEqual(JSON.parse(output), { code: "CPO_TARGET_IDENTITY_MISMATCH", rowCount: sample.rows.length,
      databaseMatches: sample.databaseMatches, schemaMatches: sample.schemaMatches, writable: sample.writable });
    assert.equal(output.includes(secret), false);
  }
  runInNewContext(source.slice(start, end), { rows: [{ database: "unit", schema: "unit", readOnly: "off" }],
    target: { database: "unit" }, schema: "unit", process: { stderr: { write: () => assert.fail("Valid target must not report mismatch") } },
  });
});
