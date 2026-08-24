import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearCommandId, commandIdFor, type ClientCommandIdentity } from "../lib/clientCommandId";
import { handleApiError } from "../lib/apiAuth";
import { OperationalCommandError } from "../lib/operationalTransaction";

test("M3 retry keeps one client command identity until success or explicit cancellation", () => {
  const reference: { current: ClientCommandIdentity | null } = { current: null };
  const first = commandIdFor(reference, "SIGN:contract-1:payload-a");
  const retry = commandIdFor(reference, "SIGN:contract-1:payload-a");
  const changedPayload = commandIdFor(reference, "SIGN:contract-1:payload-b");

  assert.equal(retry, first);
  assert.notEqual(changedPayload, first);
  clearCommandId(reference);
  assert.notEqual(commandIdFor(reference, "SIGN:contract-1:payload-b"), changedPayload);
});

test("M3 projection contention is an explicit retryable service response", async () => {
  const response = handleApiError(new OperationalCommandError(
    503,
    "Команда сохранена, но синхронизация кейса ещё выполняется. Повторите то же действие.",
    "CASE_PROJECTION_RETRY",
  ));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "2");
  assert.deepEqual(await response.json(), {
    error: "Команда сохранена, но синхронизация кейса ещё выполняется. Повторите то же действие.",
    code: "CASE_PROJECTION_RETRY",
  });
});

test("M3 case projection producers cannot bypass the public advisory-lock wrapper", () => {
  const documentService = readFileSync(new URL("../lib/documentService.ts", import.meta.url), "utf8");
  assert.doesNotMatch(documentService, /advanceCaseFulfilmentInTransaction/);
  assert.match(documentService, /advanceCaseFulfilment\(/);
});
