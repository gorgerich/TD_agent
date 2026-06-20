#!/usr/bin/env python3
"""Re-cut the scene layers with clean mattes.

Background removal by flood-filling the white ONLY from the image borders, so
interior light parts (white flowers, light wood, handle highlights) survive
instead of being punched into holes. Then despeckle, de-halo (1px erode), and a
soft feather for premium anti-aliased edges. Keeps the hall background intact.
"""
import numpy as np
import cv2
from PIL import Image, ImageFilter
import scene_layers as S  # reuse place(), SLOTS, SRC, SLOT_OF, CUT, OUT

OUT = S.OUT


def alpha_clean(jpg_path, thr=234):
    im = Image.open(jpg_path).convert("RGB")
    arr = np.asarray(im)
    h, w = arr.shape[:2]
    white = (arr.min(axis=2) >= thr).astype(np.uint8)
    ff = (white * 255).astype(np.uint8)
    fm = np.zeros((h + 2, w + 2), np.uint8)
    for sx, sy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1)]:
        if white[sy, sx]:
            cv2.floodFill(ff, fm, (sx, sy), 128)
    bg = (ff == 128)
    fg = (~bg).astype(np.uint8)  # object + interior whites (flowers etc.)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    if n > 1:
        fg = (lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    fg = cv2.erode(fg, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), 1)  # de-halo
    a = np.clip(cv2.GaussianBlur((fg * 255).astype(np.float32), (0, 0), 1.3), 0, 255).astype(np.uint8)
    ys, xs = np.where(a > 16)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    rgba = im.convert("RGBA")
    rgba.putalpha(Image.fromarray(a))
    return rgba.crop((x0, y0, x1 + 1, y1 + 1))


def regen_objects():
    for cat, m in S.SRC.items():
        for idn, src in m.items():
            rgba = alpha_clean(f"{S.CUT}/{cat}/{src}")
            if rgba is None:
                print("skip", src); continue
            S.place(rgba, S.SLOT_OF[cat]).save(f"{OUT}/{cat}/{idn}.webp", "WEBP", quality=86, method=0)


def flatten(coffin, cross, wreath, out_path):
    base = Image.open(f"{OUT}/backgrounds/studio-neutral.webp").convert("RGBA")
    for cat, idn in [("crosses", cross), ("coffins", coffin), ("wreaths", wreath)]:
        base.alpha_composite(Image.open(f"{OUT}/{cat}/{idn}.webp").convert("RGBA"))
    base.convert("RGB").save(out_path, quality=92)


if __name__ == "__main__":
    regen_objects()
    flatten("classic-walnut", "orthodox-six-point", "orthodox-oval-red-white",
            "/sessions/gifted-sharp-davinci/mnt/outputs/recut_set1.jpg")
    flatten("classic-mahogany", "orthodox-eight-point", "orthodox-oval-white-green",
            "/sessions/gifted-sharp-davinci/mnt/outputs/recut_set2.jpg")
    print("done")
