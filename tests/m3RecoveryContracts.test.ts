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
import { Prisma } from "@prisma/client";
import { isExpiredProjectionTransaction } from "../lib/caseFulfilment";
import ts from "typescript";

const financeSource = readFileSync(new URL("../app/agent/(app)/finance/FinanceClient.tsx", import.meta.url), "utf8");

test("Finance retains the serialized envelope across response and transport recovery boundaries", async () => {
  const source = financeSource.slice(financeSource.indexOf("  async function sendCommand("), financeSource.indexOf("  async function post("));
  const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  const envelope = {
    path: "/api/agent/cases/finance-test/payments", serializedBody: JSON.stringify({ amountKopecks: 12345, occurredAt: "2026-10-03T10:00:00.000Z", evidenceReference: "test" }),
    signature: "fixed", commandId: "fixed-id", correlationId: "fixed-id", idempotencyKey: "finance:fixed-id", occurredAt: "2026-10-03T10:00:00.000Z", durability: "UNCONFIRMED" as const,
  };
  for (const boundary of ["transport", 500, 502, 503, 409, 200] as const) {
    let retained: typeof envelope | null = null;
    const requests: { path: string; init: RequestInit }[] = [];
    const send = new Function("fetch", "applyRecovery", "recoveryForTransport", "recoveryForResponse", `${compiled}; return sendCommand;`)(
      async (path: string, init: RequestInit) => {
        requests.push({ path, init });
        if (boundary === "transport") throw new Error("connection lost");
        return new Response(JSON.stringify(boundary === 200 ? { ledgerEntryId: "ledger-test", replayed: true } : { code: boundary === 503 ? "CASE_PROJECTION_RETRY" : undefined }), { status: boundary });
      },
      (next: typeof envelope | null) => { retained = next; }, recoveryForTransport, recoveryForResponse,
    );
    if (boundary === 200) await send(envelope);
    else await assert.rejects(send(envelope));
    if (boundary === 409 || boundary === 200) {
      assert.equal(retained, null);
    } else {
      assert.deepEqual(retained, { ...envelope, durability: boundary === 503 ? "CONFIRMED_COMMIT" : "UNCONFIRMED" });
      await assert.rejects(send(retained));
      assert.deepEqual(requests[1], requests[0]);
    }
    assert.equal(requests[0].init.body, envelope.serializedBody);
    assert.deepEqual(requests[0].init.headers, { "Content-Type": "application/json", "Idempotency-Key": envelope.idempotencyKey, "X-Correlation-Id": envelope.correlationId });
  }
});

test("Finance requires a readable acknowledgement before releasing recovery on 200/201", async () => {
  const source = financeSource.slice(financeSource.indexOf("  async function sendCommand("), financeSource.indexOf("  async function post("));
  const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  const envelope = {
    path: "/api/agent/finance/adjustments/ledger-test", serializedBody: JSON.stringify({ decision: "APPROVED", reason: "test" }),
    signature: "fixed", commandId: "fixed-id", correlationId: "fixed-id", idempotencyKey: "finance-approval:fixed-id", occurredAt: "2026-10-03T10:00:00.000Z", durability: "UNCONFIRMED" as const,
  };
  for (const status of [200, 201]) {
    for (const body of ["", '{"ledgerEntryId":', "null", "{}", "[]", '{"ledgerEntryId":"ledger-test"}', '{"ledgerEntryId":"","replayed":false}']) {
      let retained: typeof envelope | null = null;
      const requests: { path: string; init: RequestInit }[] = [];
      const send = new Function("fetch", "applyRecovery", "recoveryForTransport", "recoveryForResponse", `${compiled}; return sendCommand;`)(
        async (path: string, init: RequestInit) => {
          requests.push({ path, init });
          return new Response(requests.length === 1 ? body : JSON.stringify({ ledgerEntryId: "ledger-test", replayed: true }), { status });
        },
        (next: typeof envelope | null) => { retained = next; }, recoveryForTransport, recoveryForResponse,
      );
      await assert.rejects(send(envelope), /Результат команды не подтверждён/);
      assert.deepEqual(retained, envelope, `${status}: ${body} must retain uncertain recovery`);
      await send(retained);
      assert.deepEqual(requests[1], requests[0], "replay must use identical path, headers and serialized payload");
      assert.equal(retained, null, "valid replay acknowledgement releases recovery");
    }
  }
});

test("Finance synchronously rejects duplicate retries and releases its lock after settlement", async () => {
  const source = financeSource.slice(financeSource.indexOf("  async function retryRecovery("), financeSource.indexOf("  async function submitAction("));
  const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  const pending = { commandId: "fixed" };
  const lock = { current: false };
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => { release = resolve; });
  let sends = 0;
  let clears = 0;
  const retry = new Function("recoveryRef", "mutationInFlight", "setBusyId", "setError", "sendCommand", "setActionState", "setApprovalState", "setLedger", "router", `${compiled}; return retryRecovery;`)(
    { current: pending }, lock, () => {}, () => {}, async (command: unknown) => { assert.equal(command, pending); sends++; await deferred; },
    () => { clears++; }, () => { clears++; }, () => {}, { refresh() {} },
  );
  const first = retry();
  assert.equal(lock.current, true);
  await retry();
  assert.equal(sends, 1);
  assert.equal(clears, 0);
  release();
  await first;
  assert.equal(lock.current, false);
  assert.equal(clears, 2);

  const retryFailure = new Function("recoveryRef", "mutationInFlight", "setBusyId", "setError", "sendCommand", "setActionState", "setApprovalState", "setLedger", "router", `${compiled}; return retryRecovery;`)(
    { current: pending }, lock, () => {}, () => {}, async () => { throw new Error("still uncertain"); },
    () => { clears++; }, () => { clears++; }, () => {}, { refresh() { assert.fail("failed recovery must not refresh"); } },
  );
  await retryFailure();
  assert.equal(lock.current, false);
  assert.equal(clears, 2, "failed recovery must leave both dialogs intact");
});

test("Finance preserves confirmed commit through transport, generic 5xx and invalid acknowledgement retries", async () => {
  const source = financeSource.slice(financeSource.indexOf("  function applyRecovery("), financeSource.indexOf("  async function post("));
  const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022 });
  const envelope = {
    path: "/api/agent/finance/refunds", serializedBody: JSON.stringify({ paymentEntryId: "test", amountKopecks: 100, occurredAt: "2026-10-03T10:00:00.000Z" }),
    signature: "fixed", commandId: "fixed-id", correlationId: "fixed-id", idempotencyKey: "finance:fixed-id", occurredAt: "2026-10-03T10:00:00.000Z", durability: "UNCONFIRMED" as const,
  };
  const reference: { current: (Omit<typeof envelope, "durability"> & { durability: string }) | null } = { current: null };
  const requests: RequestInit[] = [];
  let attempt = 0;
  const send = new Function("fetch", "recoveryRef", "setRecovery", "recoveryForTransport", "recoveryForResponse", `${compiled}; return sendCommand;`)(
    async (_path: string, init: RequestInit) => {
      requests.push(init);
      attempt++;
      if (attempt === 1) return new Response(JSON.stringify({ code: "CASE_PROJECTION_RETRY" }), { status: 503 });
      if (attempt === 2) throw new Error("connection lost");
      if (attempt === 3) return new Response("{}", { status: 502 });
      if (attempt === 4) return new Response('{"ledgerEntryId":', { status: 201 });
      return new Response(JSON.stringify({ ledgerEntryId: "test", replayed: true }), { status: 200 });
    }, reference, () => {}, recoveryForTransport, recoveryForResponse,
  );
  await assert.rejects(send(envelope));
  for (let retry = 0; retry < 3; retry++) {
    assert.equal(reference.current?.durability, "CONFIRMED_COMMIT");
    await assert.rejects(send(reference.current));
    assert.deepEqual(reference.current, { ...envelope, durability: "CONFIRMED_COMMIT" });
  }
  await send(reference.current);
  assert.equal(reference.current, null);
  for (const request of requests) assert.deepEqual(request, requests[0]);
});

test("Finance locks every dialog dismissal and command replacement during recovery", () => {
  for (const name of ["openAction", "openApproval", "openLedger"]) {
    assert.match(financeSource, new RegExp(`function ${name}\\([^]*?if \\(mutationInFlight\\.current \\|\\| recoveryRef\\.current\\) return;`));
  }
  assert.match(financeSource, /if \(!actionState \|\| mutationInFlight\.current \|\| recoveryRef\.current\) return/);
  assert.match(financeSource, /if \(!approvalState \|\| mutationInFlight\.current \|\| recoveryRef\.current\) return/);
  assert.equal((financeSource.match(/if \(!mutationInFlight\.current && !recoveryRef\.current\)/g) ?? []).length, 3);
  assert.equal((financeSource.match(/closeDisabled=\{locked\}/g) ?? []).length, 2);
  assert.equal((financeSource.match(/<fieldset disabled=\{locked\}>/g) ?? []).length, 2);
  assert.match(financeSource, /if \(!closeDisabled\) onClose\(\)/);
  assert.match(financeSource, /if \(!closeDisabled && event\.target === event\.currentTarget\) onClose\(\)/);
  assert.match(financeSource, /disabled=\{closeDisabled\} onClick=\{onClose\}/);
  assert.match(financeSource, /recovery\.durability === "CONFIRMED_COMMIT"/);
  assert.match(financeSource, /операция могла сохраниться/);
  assert.doesNotMatch(financeSource, /localStorage|sessionStorage/);
});

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
  const confirmed = recoveryForResponse(first, 503, "CASE_PROJECTION_RETRY")!;
  assert.equal(recoveryForTransport(confirmed).durability, "CONFIRMED_COMMIT");
  assert.equal(recoveryForResponse(confirmed, 502, undefined)?.durability, "CONFIRMED_COMMIT");
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

test("M3 retries only a rolled-back projection transaction timeout", () => {
  const timeout = new Prisma.PrismaClientKnownRequestError("Transaction already closed", {
    code: "P2028",
    clientVersion: "test",
  });
  const unrelated = new Prisma.PrismaClientKnownRequestError("Other database error", {
    code: "P2002",
    clientVersion: "test",
  });
  assert.equal(isExpiredProjectionTransaction(timeout), true);
  assert.equal(isExpiredProjectionTransaction(unrelated), false);
  assert.equal(isExpiredProjectionTransaction(new Error("P2028")), false);
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
