import sharp from "sharp";

export async function compareScreenshotPixels(before, after) {
  const left = await sharp(before).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const right = await sharp(after).toColourspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const beforeSize = [left.info.width, left.info.height];
  const afterSize = [right.info.width, right.info.height];
  if (beforeSize.some((value, index) => value !== afterSize[index])) {
    return { equal: false, beforeSize, afterSize, changedPixels: null, bounds: null };
  }
  let changedPixels = 0;
  let minX = left.info.width, minY = left.info.height, maxX = -1, maxY = -1;
  for (let offset = 0; offset < left.data.length; offset += 4) {
    if (left.data[offset] === right.data[offset] && left.data[offset + 1] === right.data[offset + 1]
      && left.data[offset + 2] === right.data[offset + 2] && left.data[offset + 3] === right.data[offset + 3]) continue;
    changedPixels++;
    const pixel = offset / 4, x = pixel % left.info.width, y = Math.floor(pixel / left.info.width);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return { equal: changedPixels === 0, beforeSize, afterSize, changedPixels,
    bounds: changedPixels ? [minX, minY, maxX, maxY] : null };
}
