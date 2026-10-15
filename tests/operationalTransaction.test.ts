import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isRetryableOperationalRace } from "../lib/operationalTransaction";

test("only rolled-back serialization and idempotency-unique races use bounded command retries", () => {
  const error = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError("Synthetic conflict", { code, meta, clientVersion: Prisma.prismaVersion.client });
  assert.equal(isRetryableOperationalRace(error("P2034")), true);
  for (const code of ["40001", "40P01"]) assert.equal(isRetryableOperationalRace(error("P2010", { code })), true);
  assert.equal(isRetryableOperationalRace(error("P2002", { target: ["organizationId", "idempotencyKey"] })), true);
  assert.equal(isRetryableOperationalRace(error("P2002", { target: ["idempotencyKey"] })), true);
  assert.equal(isRetryableOperationalRace(error("P2002", { target: ["email"] })), false);
  assert.equal(isRetryableOperationalRace(error("P2002", { target: ["provider", "externalTransactionId"] })), false);
  assert.equal(isRetryableOperationalRace(error("P2010", { code: "23505" })), false);
  assert.equal(isRetryableOperationalRace(error("P2028")), false);
  assert.equal(isRetryableOperationalRace(new Error("Synthetic failure")), false);
});
