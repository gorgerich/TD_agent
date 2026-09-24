import assert from "node:assert/strict";
import test from "node:test";
import { M3_CPO_AUDIT_ORGANIZATION_ID, isM3ProductionWriteAllowed } from "../lib/m3AuditMode";
import { assertCapability, type OperationalContext } from "../lib/operationalAuth";

test("Production M3 writes are limited to the exact synthetic audit organization", () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = process.env.VERCEL_ENV;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousBranch = process.env.VERCEL_GIT_COMMIT_REF;
  const previousIsolation = process.env.PREVIEW_DB_ISOLATION;
  const previousDirect = process.env.DATABASE_URL_UNPOOLED;
  const previousPooled = process.env.DATABASE_URL;
  try {
    env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    assert.equal(isM3ProductionWriteAllowed("real-organization"), false);
    assert.equal(isM3ProductionWriteAllowed(M3_CPO_AUDIT_ORGANIZATION_ID), true);
    const context: OperationalContext = {
      userId: 1,
      agentId: 1,
      membershipId: "member",
      organizationId: "real-organization",
      role: "FINANCE",
      timezone: "Europe/Moscow",
      platformRole: "USER",
      mfaVerified: true,
    };
    assert.throws(() => assertCapability(context, "finance:record"), /синтетическом контуре/);
    assert.doesNotThrow(() => assertCapability(context, "finance:read"));
    assert.doesNotThrow(() => assertCapability({ ...context, organizationId: M3_CPO_AUDIT_ORGANIZATION_ID }, "finance:record"));
    assert.throws(() => assertCapability({ ...context, role: "AGENT", organizationId: M3_CPO_AUDIT_ORGANIZATION_ID }, "finance:record"), /Недостаточно прав/);
    delete process.env.VERCEL_ENV;
    assert.equal(isM3ProductionWriteAllowed(M3_CPO_AUDIT_ORGANIZATION_ID), false);
    process.env.VERCEL_ENV = "unexpected";
    assert.equal(isM3ProductionWriteAllowed(M3_CPO_AUDIT_ORGANIZATION_ID), false);
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "mission/m3-fulfilment-money-trust";
    process.env.PREVIEW_DB_ISOLATION = "PASS";
    process.env.DATABASE_URL_UNPOOLED = "postgresql://synthetic.invalid/not-production";
    process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
    assert.equal(isM3ProductionWriteAllowed(M3_CPO_AUDIT_ORGANIZATION_ID), false);
    process.env.DATABASE_URL_UNPOOLED = "postgresql://synthetic.invalid:5432/not-production";
    assert.equal(isM3ProductionWriteAllowed("real-organization"), false);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
    if (previousNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = previousNodeEnv;
    for (const [key, value] of Object.entries({
      VERCEL_GIT_COMMIT_REF: previousBranch,
      PREVIEW_DB_ISOLATION: previousIsolation,
      DATABASE_URL_UNPOOLED: previousDirect,
      DATABASE_URL: previousPooled,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
