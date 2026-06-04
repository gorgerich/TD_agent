import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, parseId } from "../lib/apiAuth";

test("parseId: accepts positive integers", () => {
  assert.equal(parseId("42"), 42);
});

test("parseId: rejects zero/negative/non-numeric", () => {
  assert.throws(() => parseId("0"), ApiError);
  assert.throws(() => parseId("-1"), ApiError);
  assert.throws(() => parseId("abc"), ApiError);
});

test("parseId: error carries 400 status + label", () => {
  try {
    parseId("x", "номер встречи");
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 400);
    assert.match(e.message, /номер встречи/);
  }
});
