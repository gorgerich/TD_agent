import test from "node:test";
import assert from "node:assert/strict";
import { assertClientCommandKey, serverCommandKey } from "../lib/commandNamespace";
import { commandMetaFromHeaders } from "../lib/m3Api";

const reserved = [
  "server:", "projection:", "quote:", "quote-decision:", "catalog:", "invite:accepted:",
  "finance-mfa-enabled:", "webhook:", "webhook-audit:", "document-access:",
  "document-rejection:", "document-review-escalation:",
];

test("shared client header boundary rejects every reserved namespace after trimming", () => {
  for (const prefix of reserved) {
    const request = new Request("http://localhost/synthetic", { headers: {
      "idempotency-key": `  ${prefix}synthetic  `, "x-correlation-id": "synthetic-correlation",
    } });
    assert.throws(() => commandMetaFromHeaders(request), (error: unknown) => (
      error instanceof Error && "status" in error && error.status === 400
    ));
    assert.throws(() => assertClientCommandKey(`${prefix}synthetic`));
  }
});

test("normal client keys retain metadata; missing command headers still fail", () => {
  for (const key of ["client:synthetic", "invite:resend:synthetic", "catalogue:synthetic", "synthetic:server:child"]) {
    assert.deepEqual(commandMetaFromHeaders(new Request("http://localhost/synthetic", { headers: {
      "idempotency-key": ` ${key} `, "x-correlation-id": " synthetic-correlation ",
    } }), "synthetic-reason"), {
      idempotencyKey: key, correlationId: "synthetic-correlation", reason: "synthetic-reason",
    });
  }
  const incompleteHeaders: Record<string, string>[] = [{}, { "idempotency-key": "client:synthetic" }, { "x-correlation-id": "synthetic" }];
  for (const headers of incompleteHeaders) {
    assert.throws(() => commandMetaFromHeaders(new Request("http://localhost/synthetic", { headers })),
      (error: unknown) => error instanceof Error && "status" in error && error.status === 400);
  }
  assert.match(serverCommandKey("synthetic", "parent"), /^server:synthetic:[a-f0-9]{64}$/);
});
