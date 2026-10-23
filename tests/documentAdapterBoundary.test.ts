import assert from "node:assert/strict";
import test from "node:test";
import { getDocumentScanner, setDocumentScannerForTests } from "../lib/documentScanner";
import { getDocumentStorage, setDocumentStorageForTests } from "../lib/documentStorage";

test("deployed Production refuses test adapters even with all test flags and stale injected adapters", () => {
  const env = process.env as Record<string, string | undefined>;
  const keys = ["NODE_ENV", "VERCEL", "VERCEL_ENV", "ALLOW_DB_TESTS", "PREVIEW_DB_ISOLATION", "M3_DOCUMENT_STORAGE", "M3_DOCUMENT_SCANNER"];
  const prior = Object.fromEntries(keys.map(key => [key, env[key]]));
  try {
    env.NODE_ENV = "test";
    delete env.VERCEL;
    delete env.VERCEL_ENV;
    setDocumentScannerForTests({ isOperational: () => true, scan: async () => ({ status: "CLEAN", provider: "test-only", resultCode: "TEST" }) });
    setDocumentStorageForTests({ isConfigured: () => true, putPrivate: async () => { throw new Error("test only"); }, readPrivate: async () => null, discardUncommitted: async () => {} });
    env.ALLOW_DB_TESTS = "1";
    env.PREVIEW_DB_ISOLATION = "PASS";
    env.M3_DOCUMENT_STORAGE = "isolated-filesystem";
    env.M3_DOCUMENT_SCANNER = "synthetic-preview";
    for (const nodeEnv of ["production", "development"]) {
      env.NODE_ENV = nodeEnv;
      env.VERCEL = "1";
      for (const deployment of ["production", "unexpected"]) {
        env.VERCEL_ENV = deployment;
        assert.equal(getDocumentScanner().isOperational(), false);
        assert.equal(getDocumentStorage().isConfigured(), false);
        assert.throws(() => setDocumentScannerForTests(null), /forbidden/);
        assert.throws(() => setDocumentStorageForTests(null), /forbidden/);
      }
    }
    delete env.VERCEL;
    env.VERCEL_ENV = "production";
    assert.equal(getDocumentScanner().isOperational(), false);
    assert.equal(getDocumentStorage().isConfigured(), false);
  } finally {
    env.NODE_ENV = "test";
    delete env.VERCEL;
    delete env.VERCEL_ENV;
    setDocumentScannerForTests(null);
    setDocumentStorageForTests(null);
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
  }
});

test("private Blob readiness recognizes trusted SDK request context without treating whitespace as credentials", () => {
  const keys = ["M3_DOCUMENT_STORAGE", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL_OIDC_TOKEN"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const symbol = Symbol.for("@vercel/request-context");
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previousContext = globals[symbol];
  try {
    delete process.env.M3_DOCUMENT_STORAGE;
    process.env.BLOB_STORE_ID = "store_test_only";
    process.env.BLOB_READ_WRITE_TOKEN = " \t ";
    process.env.VERCEL_OIDC_TOKEN = " \t ";
    delete globals[symbol];
    assert.equal(getDocumentStorage().isConfigured(), false);
    globals[symbol] = { get: () => ({ headers: { "x-vercel-oidc-token": "test-only-context" } }) };
    assert.equal(getDocumentStorage().isConfigured(), true);
    delete process.env.BLOB_STORE_ID;
    assert.equal(getDocumentStorage().isConfigured(), false);
    process.env.BLOB_READ_WRITE_TOKEN = "test-only-explicit-token";
    assert.equal(getDocumentStorage().isConfigured(), true);
  } finally {
    if (previousContext === undefined) delete globals[symbol]; else globals[symbol] = previousContext;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
