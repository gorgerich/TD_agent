import assert from "node:assert/strict";
import test from "node:test";
import { parseRublesToKopecks } from "../lib/financeAmount";

test("finance amount accepts only exact rubles and kopecks", () => {
  assert.equal(parseRublesToKopecks("88000"), 8_800_000);
  assert.equal(parseRublesToKopecks("88000,50"), 8_800_050);
  assert.equal(parseRublesToKopecks("88000.50"), 8_800_050);
  assert.equal(parseRublesToKopecks("0,01"), 1);
  assert.equal(parseRublesToKopecks("21474836,47"), 2_147_483_647);
  for (const raw of ["", "0", "-88000", "+1", "1e3", "88 000", "88,000", "1.2.3", "0,001", "21474836,48", "Infinity", "01"]) {
    assert.equal(parseRublesToKopecks(raw), null, raw);
  }
});
