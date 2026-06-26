#!/usr/bin/env python3
"""Generate a hall-placed layer for EVERY catalog item (by SKU image basename).

Each catalog coffin -> on the catafalque, wreath -> on the easel, cross -> at the
cross spot. Files are named by the catalog imageUrl basename so the app maps the
selected SKU -> its own layer (full variant coverage + reactivity). Background =
the cropped hall. Re-runnable (skips existing).
"""
import os, glob
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
import recut
import hall_compose as HC

HALL = HC.HALL
CAT = "/sessions/gifted-sharp-davinci/mnt/TD_agent/public/catalog"
OUT = "/sessions/gifted-sharp-davinci/mnt/outputs/scene_hall"
CROP = (0, 640, 1536, 1792)                 # 4:3 stage crop
CW, CH = CROP[2] - CROP[0], CROP[3] - CROP[1]
DY = CROP[1]
# slots in CROP space (native y minus DY)
SLOTS = {
    "coffins": dict(cx=650, by=1268 - DY, w=600, soft=False, sh=True),
    "wreaths": dict(cx=1265, by=1365 - DY, h=520, soft=True, sh=False),
    "crosses": dict(cx=210, by=1300 - DY, h=600, soft=False, sh=False),
}
# real double-lid SKUs use these double-lid source files; orphan screenshots skipped
SKIP = {"fa-2", "fp-2", "fe-2t", "fe-2v"}


def shadow(canvas, cx, by, w):
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([cx - int(w * 0.5), by - int(w * 0.05), cx + int(w * 0.5), by + int(w * 0.09)], fill=(8, 8, 10, 120))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(30)))


def place(cat, src):
    s = SLOTS[cat]
    rgba = recut.alpha_clean(src)
    if rgba is None:
        return None
    if s["soft"]:
        rgba = HC.soften(rgba)
    scale = (s["w"] / rgba.width) if "w" in s else (s["h"] / rgba.height)
    nw, nh = max(1, int(rgba.width * scale)), max(1, int(rgba.height * scale))
    r = rgba.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    if s["sh"]:
        shadow(canvas, s["cx"], s["by"], nw)
    canvas.alpha_composite(r, (s["cx"] - nw // 2, s["by"] - nh))
    return canvas


def run():
    os.makedirs(f"{OUT}/backgrounds", exist_ok=True)
    Image.open(HALL).convert("RGB").crop(CROP).save(f"{OUT}/backgrounds/studio-neutral.webp", "WEBP", quality=86, method=2)
    n = 0
    for cat in ("coffins", "wreaths", "crosses"):
        os.makedirs(f"{OUT}/{cat}", exist_ok=True)
        for src in sorted(glob.glob(f"{CAT}/{cat}/*.jpg")):
            base = os.path.splitext(os.path.basename(src))[0]
            if base in SKIP:
                continue
            dst = f"{OUT}/{cat}/{base}.webp"
            if os.path.exists(dst):
                n += 1; continue
            layer = place(cat, src)
            if layer is None:
                print("skip", base); continue
            layer.save(dst, "WEBP", quality=84, method=0)
            n += 1
            print("ok", cat, base)
    print("total layers:", n)


def flatten(coffin, wreath, cross, out):
    base = Image.open(f"{OUT}/backgrounds/studio-neutral.webp").convert("RGBA")
    for cat, b in [("crosses", cross), ("coffins", coffin), ("wreaths", wreath)]:
        p = f"{OUT}/{cat}/{b}.webp"
        if os.path.exists(p):
            base.alpha_composite(Image.open(p).convert("RGBA"))
    base.convert("RGB").save(out, quality=92)


if __name__ == "__main__":
    run()
    flatten("fsi-6b", "standart-blue", "kds-18", "/sessions/gifted-sharp-davinci/mnt/outputs/hall_l1.jpg")
    flatten("fvk-2s", "avtorskie", "kds-19", "/sessions/gifted-sharp-davinci/mnt/outputs/hall_l2.jpg")
    print("done")
