import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { compareScreenshotPixels } from "./e2e/screenshotPixels.mjs";

const width = 31, height = 17;
const pixels = Buffer.from(Array.from({ length: width * height * 4 }, (_, index) => (index * 37) % 256));
const encode = (bytes: Buffer, compressionLevel = 6) => sharp(bytes, { raw: { width, height, channels: 4 } }).png({ compressionLevel }).toBuffer();

test("screenshot comparison accepts identical pixels with different PNG encodings", async () => {
  const before = await encode(pixels, 0), after = await encode(pixels, 9);
  assert.equal(before.equals(after), false, "Old serialized-byte comparison must reject this fixture");
  const result = await compareScreenshotPixels(before, after);
  assert.equal(result.equal, true);
  assert.equal(result.changedPixels, 0);
  assert.equal(result.bounds, null);
});

test("screenshot comparison rejects one changed colour pixel without a tolerance", async () => {
  const changed = Buffer.from(pixels);
  changed[4 * (width + 1)] ^= 1;
  const result = await compareScreenshotPixels(await encode(pixels), await encode(changed));
  assert.equal(result.equal, false);
  assert.equal(result.changedPixels, 1);
  assert.deepEqual(result.bounds, [1, 1, 1, 1]);
});

test("screenshot comparison also rejects one changed alpha pixel", async () => {
  const changed = Buffer.from(pixels);
  changed[4 * (width + 1) + 3] ^= 1;
  assert.equal((await compareScreenshotPixels(await encode(pixels), await encode(changed))).changedPixels, 1);
});

test("screenshot comparison rejects different dimensions and invalid images", async () => {
  const original = await encode(pixels);
  const smaller = await sharp(original).extract({ left: 0, top: 0, width: 1, height: 1 }).png().toBuffer();
  assert.equal((await compareScreenshotPixels(original, smaller)).equal, false);
  await assert.rejects(compareScreenshotPixels(original, Buffer.from("invalid synthetic PNG")));
});
