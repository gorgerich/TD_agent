import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/agent/auth/demo/route";

test("demo availability matches the server-side demo guard", async () => {
  const previous = process.env.DEMO_MODE;
  try {
    delete process.env.DEMO_MODE;
    let response = await GET();
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { available: false });

    process.env.DEMO_MODE = "1";
    response = await GET();
    assert.deepEqual(await response.json(), { available: true });
  } finally {
    if (previous === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previous;
  }
});
