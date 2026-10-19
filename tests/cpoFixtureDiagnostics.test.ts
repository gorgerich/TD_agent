import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

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
