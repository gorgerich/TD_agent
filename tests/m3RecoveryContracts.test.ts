import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { type ClientCommandIdentity } from "../lib/clientCommandId";
import {
  ClientCommandRecoveryPendingError,
  commandEnvelopeFor,
  recoveryForResponse,
  recoveryForTransport,
  shouldRetainCommandForRetry,
} from "../lib/clientCommandRecovery";
import { handleApiError } from "../lib/apiAuth";
import { OperationalCommandError } from "../lib/operationalTransaction";

test("M3 post-commit recovery locks the exact command key and payload", () => {
  const reference: { current: ClientCommandIdentity | null } = { current: null };
  const first = commandEnvelopeFor(reference, {
    path: "/api/agent/cases/1/contract",
    serializedBody: JSON.stringify({ action: "SIGN", evidence: "registry-1" }),
  }, null);
  const retry = commandEnvelopeFor(reference, {
    path: first.path,
    serializedBody: first.serializedBody,
  }, first);

  assert.deepEqual(retry, first);
  assert.throws(
    () => commandEnvelopeFor(reference, {
      path: first.path,
      serializedBody: JSON.stringify({ action: "SIGN", evidence: "registry-2" }),
    }, first),
    ClientCommandRecoveryPendingError,
  );
  assert.throws(
    () => commandEnvelopeFor(reference, {
      path: "/api/agent/cases/2/contract",
      serializedBody: first.serializedBody,
    }, first),
    ClientCommandRecoveryPendingError,
  );
  assert.equal(shouldRetainCommandForRetry(503, "CASE_PROJECTION_RETRY"), true);
  assert.equal(shouldRetainCommandForRetry(502, undefined), true);
  assert.equal(shouldRetainCommandForRetry(409, "IDEMPOTENCY_CONFLICT"), false);
  assert.equal(recoveryForResponse(first, 503, "CASE_PROJECTION_RETRY")?.durability, "CONFIRMED_COMMIT");
  assert.equal(recoveryForResponse(first, 502, undefined)?.durability, "UNCONFIRMED");
  assert.equal(recoveryForTransport(first).durability, "UNCONFIRMED");
  assert.equal(recoveryForResponse(first, 409, "IDEMPOTENCY_CONFLICT"), null);
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

test("M3 projection clients expose fixed-payload retry and lock destructive controls", () => {
  const payments = readFileSync(new URL("../app/agent/(app)/cases/[caseId]/PaymentsSection.tsx", import.meta.url), "utf8");
  const documents = readFileSync(new URL("../app/agent/(app)/document-review/DocumentReviewClient.tsx", import.meta.url), "utf8");
  const execution = readFileSync(new URL("../app/agent/(app)/cases/[caseId]/ExecutionActions.tsx", import.meta.url), "utf8");

  for (const source of [payments, documents, execution]) {
    assert.match(source, /setRecovery\(/);
    assert.match(source, /recovery !== null/);
    assert.match(source, /Повторить синхронизацию/);
  }
  assert.match(payments, /await sendCommand\(pending\)/);
  assert.match(documents, /sendCommand\(pending\)/);
  assert.match(execution, /runCommand\(pending\)/);
  assert.match(documents, /mutationInFlight\.current/);
  assert.match(documents, /const mutationLocked = busyId !== null \|\| recovery !== null/);
  for (const source of [payments, documents, execution]) {
    assert.match(source, /recoveryRef\.current/);
    assert.match(source, /recovery\.durability === "CONFIRMED_COMMIT"/);
    assert.match(source, /if \(!retained\) clearCommandId\(commandIdentity\)/);
  }
});
