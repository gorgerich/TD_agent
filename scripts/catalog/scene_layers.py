#!/usr/bin/env python3
"""Scene-placed transparent layers for the live set visualizer (premium pass).

White-studio cutouts -> cleaned alpha (despeckle + de-halo + feather) -> placed
on a 4:3 stage at category slots with soft contact shadow + floor reflection.
Background is a calm hall: soft center spotlight, faint floor, gentle vignette.
"""
import os
import numpy as np
import cv2
from PIL import Image, ImageFilter, ImageDraw

CUT = os.environ.get("CUTOUT_DIR", "cut")    # папка с белыми вырезами (вывод cutout.py)
OUT = os.environ.get("SCENE_OUT", "scene")   # куда класть слои сцены
CANVAS = (1600, 1200)

SLOTS = {
    "coffin": dict(cx=0.50, by=0.84, h=0.40, shadow=True, reflect=True),
    "cross":  dict(cx=0.18, by=0.82, h=0.68, shadow=False, reflect=False),
    "wreath": dict(cx=0.81, by=0.85, h=0.44, shadow=True, reflect=True),
}


def alpha_from_white(jpg_path, thr=232):
    """Clean transparent cutout from a white-bg JPG: despeckle, de-halo, feather."""
    im = Image.open(jpg_path).convert("RGB")
    rgb = np.asarray(im).astype(np.int16)
    white = (rgb[..., 0] > thr) & (rgb[..., 1] > thr) & (rgb[..., 2] > thr)
    a = (~white).astype(np.uint8)
    # keep the largest blob (drop stray specks => cleaner edges)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(a, 8)
    if n > 1:
        a = (lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    # fill interior holes
    ff = a.copy()
    cv2.floodFill(ff, np.zeros((a.shape[0] + 2, a.shape[1] + 2), np.uint8), (0, 0), 1)
    a = a | (1 - ff)
    a = cv2.erode(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), 1)  # kill white halo
    alpha = cv2.GaussianBlur((a * 255).astype(np.float32), (0, 0), 1.1)
    ys, xs = np.where(alpha > 14)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    rgba = im.convert("RGBA")
    rgba.putalpha(Image.fromarray(np.clip(alpha, 0, 255).astype(np.uint8)))
    return rgba.crop((x0, y0, x1 + 1, y1 + 1))


def place(layer_rgba, slot):
    s = SLOTS[slot]
    canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    target_h = int(CANVAS[1] * s["h"])
    scale = target_h / layer_rgba.height
    w, h = max(1, int(layer_rgba.width * scale)), target_h
    r = layer_rgba.resize((w, h), Image.LANCZOS)
    cx, by = int(CANVAS[0] * s["cx"]), int(CANVAS[1] * s["by"])
    x, y = cx - w // 2, by - h
    if s["shadow"]:
        sh = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse(
            [cx - int(w * 0.46), by - int(h * 0.05), cx + int(w * 0.46), by + int(h * 0.07)],
            fill=(12, 16, 16, 105))
        canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(32)))
    if s["reflect"]:
        ref = r.transpose(Image.FLIP_TOP_BOTTOM)
        ra = np.asarray(ref.split()[-1]).astype(np.float32)
        grad = np.linspace(0.22, 0.0, h)[:, None]  # fade reflection downward
        ref.putalpha(Image.fromarray((ra * grad).astype(np.uint8)))
        rc = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        rc.alpha_composite(ref, (x, by))
        canvas.alpha_composite(rc.filter(ImageFilter.GaussianBlur(2.0)))
    canvas.alpha_composite(r, (x, y))
    return canvas


def make_background():
    """Calm hall: soft center spotlight, faint floor band, gentle vignette."""
    W, H = CANVAS
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cx, cy = W * 0.5, H * 0.42
    r = np.sqrt(((xx - cx) / (W * 0.66)) ** 2 + ((yy - cy) / (H * 0.66)) ** 2)
    spot = np.clip(1.0 - r, 0, 1) ** 1.5
    wall = 0.90 + 0.04 * (yy / H)
    horizon = H * 0.64
    floor = np.where(yy > horizon, 1.0 - 0.12 * np.clip((yy - horizon) / (H - horizon), 0, 1), 1.0)
    vig = 1.0 - 0.20 * np.clip(r - 0.45, 0, 1)
    val = np.clip(wall * floor * (0.84 + 0.22 * spot) * vig, 0, 1)
    out = np.stack([val * 232, val * 234, val * 229], axis=-1)  # warm-neutral
    return Image.fromarray(out.astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))


SRC = {
    "coffins": {"classic-black": "fs-4.jpg", "classic-mahogany": "fsr-4.jpg",
                "classic-walnut": "fkl-6s.jpg", "classic-dark-oak": "fsi-6.jpg"},
    "crosses": {"orthodox-six-point": "kds-18.jpg", "orthodox-eight-point": "kds-17.jpg"},
    "wreaths": {"orthodox-oval-red-white": "wr-std-5.jpg", "orthodox-oval-white-green": "wr-std-1.jpg",
                "orthodox-oval-burgundy-green": "wr-std-4.jpg"},
}
SLOT_OF = {"coffins": "coffin", "crosses": "cross", "wreaths": "wreath"}


def gen_all():
    for cat, m in SRC.items():
        os.makedirs(f"{OUT}/{cat}", exist_ok=True)
        for idn, src in m.items():
            rgba = alpha_from_white(f"{CUT}/{cat}/{src}")
            if rgba is None:
                continue
            place(rgba, SLOT_OF[cat]).save(f"{OUT}/{cat}/{idn}.webp", "WEBP", quality=84, method=0)
    os.makedirs(f"{OUT}/backgrounds", exist_ok=True)
    make_background().save(f"{OUT}/backgrounds/studio-neutral.webp", "WEBP", quality=82, method=0)


def flatten(coffin, cross, wreath, out_path):
    base = Image.open(f"{OUT}/backgrounds/studio-neutral.webp").convert("RGBA")
    for cat, idn in [("crosses", cross), ("coffins", coffin), ("wreaths", wreath)]:
        base.alpha_composite(Image.open(f"{OUT}/{cat}/{idn}.webp").convert("RGBA"))
    base.convert("RGB").save(out_path, quality=92)


if __name__ == "__main__":
    gen_all()
    flatten("classic-walnut", "orthodox-six-point", "orthodox-oval-red-white",
            "/sessions/gifted-sharp-davinci/mnt/outputs/qa_set1.jpg")
    flatten("classic-mahogany", "orthodox-eight-point", "orthodox-oval-white-green",
            "/sessions/gifted-sharp-davinci/mnt/outputs/qa_set2.jpg")
    print("done")
