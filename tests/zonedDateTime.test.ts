import assert from "node:assert/strict";
import test from "node:test";
import { zonedDayBounds, zonedLocalInput, zonedLocalToIso } from "../lib/zonedDateTime";

test("organization-local task time round-trips independently of browser timezone", () => {
  const local = "2026-07-19T14:30";
  const iso = zonedLocalToIso(local, "Europe/Moscow");
  assert.equal(iso, "2026-07-19T11:30:00.000Z");
  assert.equal(zonedLocalInput(iso!, "Europe/Moscow"), local);
});

test("nonexistent DST wall-clock time fails closed", () => {
  assert.equal(zonedLocalToIso("2026-03-29T02:30", "Europe/Berlin"), null);
});

test("invalid datetime-local input fails closed", () => {
  assert.equal(zonedLocalToIso("19.07.2026 14:30", "Europe/Moscow"), null);
  assert.equal(zonedLocalInput("invalid", "Europe/Moscow"), "");
});

test("organization day bounds do not depend on server timezone", () => {
  const bounds = zonedDayBounds(new Date("2026-07-22T21:30:00.000Z"), "Europe/Moscow");
  assert.equal(bounds.start.toISOString(), "2026-07-22T21:00:00.000Z");
  assert.equal(bounds.end.toISOString(), "2026-07-23T20:59:59.999Z");
});
