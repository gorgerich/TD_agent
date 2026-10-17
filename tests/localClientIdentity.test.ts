import assert from "node:assert/strict";
import { isIP } from "node:net";
import test from "node:test";
import { createLocalClientHeaders } from "./e2e/localClientIdentity.mjs";

test("local browser clients have distinct valid documentation IPv6 proxy identities", () => {
  for (const origin of ["http://127.0.0.1:43210", "http://localhost:43210"]) {
    const next = createLocalClientHeaders(origin);
    const values = Array.from({ length: 100 }, () => next()["x-real-ip"]);
    assert.equal(new Set(values).size, 100);
    for (const value of values) {
      assert.ok(typeof value === "string");
      assert.equal(isIP(value), 6);
      assert.match(value, /^2001:db8:/);
    }
  }
});

test("Preview, Production and loopback lookalikes never receive a synthetic client header", () => {
  for (const origin of ["https://td-agent.vercel.app", "https://example-preview.vercel.app",
    "http://localhost.example.com", "http://127.0.0.1.example.com", "https://127.0.0.1",
    "http://user@localhost", "http://localhost/path", "http://localhost?x=1", "http://localhost#x"]) {
    const next = createLocalClientHeaders(origin);
    assert.deepEqual(next(), {});
    assert.deepEqual(next(), {});
  }
});
