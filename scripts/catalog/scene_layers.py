#!/usr/bin/env python3
"""Scene-placed transparent layers for the live set visualizer.

Takes white-studio product cutouts and re-places each onto a full 4:3 scene
canvas at its category slot (coffin lower-center, cross standing at the head,
wreath on a stand), with a soft contact shadow. Output: per-product transparent
WEBP/PNG layers that the existing RitualSetPreview stacks into one coherent set
that updates live as the client picks items.
"""
import os
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

CUT = os.environ.get("CUTOUT_DIR", "cut")    # папка с белыми вырезами (вывод cutout.py)
OUT = os.environ.get("SCENE_OUT", "scene")   # куда класть слои сцены
CANVAS = (1600, 1200)  # 4:3 stage, all layers share this canvas so they align

# Per-slot placement: center-x, baseline-y (bottom of object), height — all as
# fractions of the canvas. Tuned so a 3/4 coffin reads as being on a catafalque,
# the (frontal) cross stands at the head, the (frontal) wreath sits on a stand.
SLOTS = {
    "coffin": dict(cx=0.54, by=0.86, h=0.40, shadow=True),
    "cross":  dict(cx=0.19, by=0.83, h=0.70, shadow=False),
    "wreath": dict(cx=0.83, by=0.86, h=0.50, shadow=True),
}


def alpha_from_white(jpg_path, thr=236):
    """Recover a transparent cutout from a white-background JPG."""
    im = Image.open(jpg_path).convert("RGB")
    arr = np.asarray(im).astype(np.int16)
    white = (arr[..., 0] > thr) & (arr[..., 1] > thr) & (arr[..., 2] > thr)
    a = (~white).astype(np.uint8) * 255
    ys, xs = np.where(a > 12)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    im = im.crop((x0, y0, x1 + 1, y1 + 1))
    am = Image.fromarray(a).crop((x0, y0, x1 + 1, y1 + 1)).filter(ImageFilter.GaussianBlur(0.8))
    rgba = im.convert("RGBA")
    rgba.putalpha(am)
    return rgba


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
            [cx - int(w * 0.52), by - int(h * 0.06), cx + int(w * 0.52), by + int(h * 0.10)],
            fill=(20, 25, 25, 90))
        canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26)))
    canvas.alpha_composite(r, (x, y))
    return canvas


def make_background():
    """Soft neutral studio gradient with a faint floor — calm, premium."""
    bg = Image.new("RGB", CANVAS, (238, 240, 238))
    top = np.linspace(232, 246, CANVAS[1] // 2).astype(np.uint8)
    arr = np.asarray(bg).copy()
    for i, v in enumerate(top):
        arr[i, :, :] = (v, v + 1, v)
    floor0 = CANVAS[1] // 2
    floorv = np.linspace(246, 228, CANVAS[1] - floor0).astype(np.uint8)
    for i, v in enumerate(floorv):
        arr[floor0 + i, :, :] = (v, v, v - 2)
    out = Image.fromarray(arr).filter(ImageFilter.GaussianBlur(40))
    return out


def gen_layer(category, src_name, out_name):
    slot = {"coffins": "coffin", "crosses": "cross", "wreaths": "wreath"}[category]
    rgba = alpha_from_white(f"{CUT}/{category}/{src_name}")
    if rgba is None:
        print("skip", src_name); return None
    placed = place(rgba, slot)
    os.makedirs(f"{OUT}/{category}", exist_ok=True)
    p = f"{OUT}/{category}/{out_name}"
    placed.save(p)
    return p


def compose_demo(coffin, cross, wreath, out_path):
    """Flatten bg + cross + coffin + wreath into one preview (offline QA)."""
    base = make_background().convert("RGBA")
    for cat, name in [("crosses", cross), ("coffins", coffin), ("wreaths", wreath)]:
        if not name:
            continue
        slot = {"coffins": "coffin", "crosses": "cross", "wreaths": "wreath"}[cat]
        rgba = alpha_from_white(f"{CUT}/{cat}/{name}")
        if rgba is None:
            continue
        base.alpha_composite(place(rgba, slot))
    base.convert("RGB").save(out_path, quality=92)
    return out_path


if __name__ == "__main__":
    compose_demo("fkl-6s.jpg", "kds-17.jpg", "wr-std-5.jpg",
                 "/sessions/gifted-sharp-davinci/mnt/outputs/scene_demo.jpg")
    print("wrote scene_demo.jpg")
