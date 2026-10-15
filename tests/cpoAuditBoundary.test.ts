import test from "node:test";
import assert from "node:assert/strict";
import { assertConfiguredPaymentProvider } from "../lib/paymentWebhookProvider";
import { validPaymentTerms } from "../lib/contractTerms";
import { evaluateDocumentRequirement, paymentAllowsFulfilment, deriveLedgerSummary } from "../lib/m3Domain";
import { evaluateCaseTransition, CaseDomainError } from "../lib/caseDomain";
import { isAcceptedImmutableQuote, isCurrentPublishedVersion } from "../lib/quotePublicationTruth";
import { assertClientCommandKey, serverCommandKey } from "../lib/commandNamespace";
import { readBoundedRequestText } from "../lib/boundedRequestBody";

test("CPO-20: streaming body limits count UTF-8 bytes and reject malformed encoding", async () => {
  const request = (body: BodyInit) => new Request("http://localhost/synthetic", { method: "POST", body });
  assert.equal(await readBoundedRequestText(request("тест"), 8), "тест");
  await assert.rejects(readBoundedRequestText(request("тест"), 7), (error: unknown) => (
    error instanceof Error && "status" in error && error.status === 413
  ));
  await assert.rejects(readBoundedRequestText(request(new Uint8Array([0xff])), 8), (error: unknown) => (
    error instanceof Error && "status" in error && error.status === 400
  ));
});

test("CPO-16: accepted snapshot survives offer expiry and supersession, never draft or absent acceptance", () => {
  const version = { state: "PUBLISHED", totalState: "KNOWN", total: 17600000, snapshotChecksum: "a".repeat(64),
    versionNumber: 1, validUntil: new Date("2020-01-01"), decisions: [{ type: "ACCEPTED" }] };
  assert.equal(isCurrentPublishedVersion(version, new Date()), true);
  for (const state of ["PUBLISHED", "SUPERSEDED", "EXPIRED"]) assert.equal(isAcceptedImmutableQuote({ ...version, state }), true);
  assert.equal(isAcceptedImmutableQuote({ ...version, state: "DRAFT" }), false);
  assert.equal(isAcceptedImmutableQuote({ ...version, decisions: [] }), false);
  assert.equal(isAcceptedImmutableQuote({ ...version, total: 0 }), false);
  assert.equal(isAcceptedImmutableQuote({ ...version, snapshotChecksum: null }), false);
});

test("CPO-22: client commands cannot collide with derived server command namespaces", () => {
  assert.doesNotThrow(() => assertClientCommandKey("client:synthetic:save"));
  const key = serverCommandKey("contract-obligation", "synthetic-parent");
  assert.equal(key, serverCommandKey("contract-obligation", "synthetic-parent"));
  assert.notEqual(key, serverCommandKey("contract-obligation", "other-parent"));
  assert.throws(() => assertClientCommandKey(key));
  assert.throws(() => assertClientCommandKey("webhook:synthetic:event"));
});

test("CPO-04: a pending, infected, rejected or quarantined replacement cannot revoke an applicable verified version", () => {
  for (const status of ["QUARANTINED", "UPLOADED", "REJECTED"] as const) {
    assert.deepEqual(evaluateDocumentRequirement([
      { versionNumber: 1, status: "VERIFIED", scanStatus: "CLEAN", expiresAt: null },
      { versionNumber: 2, status, scanStatus: status === "REJECTED" ? "CLEAN" : "ERROR", expiresAt: null },
    ]), { status: "SATISFIED", verifiedVersionNumber: 1 });
  }
});

test("CPO-11: missing additional CLOSED requirement blocks closure even if legacy flags are true", () => {
  assert.throws(() => evaluateCaseTransition({
    stage: "EXECUTION", scenarioId: "CREMATION_V1", eventType: "case.closure_requested.v1", payload: {},
    facts: { intakeComplete: true, availableQuoteVersionIds: [], publishedQuoteVersionId: 1, contractSigned: true,
      paymentSatisfied: true, documentsReadyForExecution: true, documentsReadyForClosure: false,
      guardState: { crematorium_confirmed: true, contract_signed: true, payment_satisfied: true } },
  }), (error: unknown) => error instanceof CaseDomainError && error.code === "GUARD_FAILED");
});

test("CPO-20: payment terms are bounded by bytes, nesting, node count and JSON-safe values", () => {
  assert.equal(validPaymentTerms({ schedule: "manual-pilot", notes: "synthetic" }), true);
  assert.equal(validPaymentTerms({ a: { b: { c: { d: "too deep" } } } }), false);
  assert.equal(validPaymentTerms({ notes: "x".repeat(4097) }), false);
  assert.equal(validPaymentTerms(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [String(i), "x"]))), false);
  assert.equal(validPaymentTerms({ amount: Number.POSITIVE_INFINITY }), false);
  assert.equal(validPaymentTerms(JSON.parse('{"__proto__":"unsafe"}')), false);
});

test("CPO-14/21: provider identity is configured, aliases denied, absent secret retryable", () => {
  const before = { provider: process.env.M3_PAYMENT_WEBHOOK_PROVIDER, secret: process.env.M3_PAYMENT_WEBHOOK_SECRET };
  const status = (expected: number) => (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === expected;
  try {
    delete process.env.M3_PAYMENT_WEBHOOK_PROVIDER;
    assert.throws(() => assertConfiguredPaymentProvider("synthetic"), status(503));
    process.env.M3_PAYMENT_WEBHOOK_PROVIDER = "synthetic";
    delete process.env.M3_PAYMENT_WEBHOOK_SECRET;
    assert.throws(() => assertConfiguredPaymentProvider("synthetic"), status(503));
    process.env.M3_PAYMENT_WEBHOOK_SECRET = "x".repeat(32);
    assert.doesNotThrow(() => assertConfiguredPaymentProvider("synthetic"));
    assert.throws(() => assertConfiguredPaymentProvider("other-provider"), status(404));
  } finally {
    for (const [key, value] of [["M3_PAYMENT_WEBHOOK_PROVIDER", before.provider], ["M3_PAYMENT_WEBHOOK_SECRET", before.secret]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
  }
});

test("CPO-01: a known covered ledger permits fulfilment only without pending adjustments", () => {
  const summary = deriveLedgerSummary([
    { id: "o", type: "OBLIGATION", direction: "DEBIT", amountKopecks: 17600000, effective: true },
    { id: "p", type: "PAYMENT", direction: "CREDIT", amountKopecks: 17600000, effective: true },
  ], "RUB");
  assert.equal(paymentAllowsFulfilment(summary, 0), true);
  assert.equal(paymentAllowsFulfilment(summary, 1), false);
  assert.equal(paymentAllowsFulfilment(null), false);
  assert.equal(paymentAllowsFulfilment({ ...summary, balanceKopecks: null }), false);
});
