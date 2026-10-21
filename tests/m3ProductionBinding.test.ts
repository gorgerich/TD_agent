import assert from "node:assert/strict";
import test from "node:test";
import { getM3ProductionPolicyBinding, isM3ProductionWriteAllowed } from "../lib/m3AuditMode";
import { assertM3ProductionActivation } from "../lib/m3ProductionActivation";
import type { Prisma } from "@prisma/client";

test("real M3 bindings are exact, fingerprint-bound, bounded and fail closed, never wildcard or test-flag enablement", async () => {
  const env = process.env as Record<string, string | undefined>;
  const keys = ["NODE_ENV", "VERCEL", "VERCEL_ENV", "M3_PRODUCTION_POLICY_BINDINGS", "ALLOW_DB_TESTS"];
  const prior = Object.fromEntries(keys.map(key => [key, env[key]]));
  const fingerprint = "a".repeat(64);
  try {
    env.NODE_ENV = "development";
    env.VERCEL_ENV = "production";
    env.VERCEL = "1";
    env.ALLOW_DB_TESTS = "1";
    for (const raw of [undefined, "", "null", "[]", "{}", "true", "{bad", JSON.stringify({ "*": fingerprint }), JSON.stringify({ real: "approved" }), JSON.stringify({ real: fingerprint, bad: 1 }), JSON.stringify(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`org-${i}`, fingerprint]))), " ".repeat(65_537)]) {
      if (raw === undefined) delete env.M3_PRODUCTION_POLICY_BINDINGS; else env.M3_PRODUCTION_POLICY_BINDINGS = raw;
      assert.equal(getM3ProductionPolicyBinding("real"), null);
      assert.equal(isM3ProductionWriteAllowed("real"), false);
    }
    env.M3_PRODUCTION_POLICY_BINDINGS = JSON.stringify({ real: fingerprint });
    assert.equal(isM3ProductionWriteAllowed("real"), true, "Configured binding only admits the subsequent mandatory database proof check");
    assert.equal(getM3ProductionPolicyBinding("real"), fingerprint);
    assert.equal(getM3ProductionPolicyBinding("foreign"), null);
    assert.equal(isM3ProductionWriteAllowed("foreign"), false);
    let reads = 0;
    const tx = { $queryRaw: async (_sql: unknown, ...values: unknown[]) => {
      reads++;
      assert.deepEqual(values, [fingerprint, "real"]);
      return [{ id: null, activatedByUserId: null, bundle: null, humanSignoffs: null }];
    } } as unknown as Prisma.TransactionClient;
    await assert.rejects(assertM3ProductionActivation(tx, "real"), { status: 503, code: "M3_PRODUCTION_POLICY_UNAVAILABLE" });
    assert.equal(reads, 1);
    await assert.rejects(assertM3ProductionActivation(tx, "foreign"), { status: 403 });
    assert.equal(reads, 1, "Unbound tenant cannot even read another tenant's approval proof");
    delete env.M3_PRODUCTION_POLICY_BINDINGS;
    await assert.rejects(assertM3ProductionActivation(tx, "real"), { status: 403 });
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
  }
});
