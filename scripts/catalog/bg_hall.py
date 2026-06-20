#!/usr/bin/env python3
"""Premium funeral-hall backdrop for the set visualizer.

Warm desaturated wall gradient, soft center spotlight pool, drapery vignette on
the sides, a calm floor band, and a soft draped catafalque under the coffin so it
sits on something (grounding/realism). Everything heavily blurred -> calm, premium,
no hard shapes. Output: studio-neutral.webp (the bg layer RitualSetPreview loads).
"""
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

W, H = 1600, 1200
OUT = "/sessions/gifted-sharp-davinci/mnt/outputs/scene"


def hall():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    t = yy / H
    # warm taupe wall, lighter toward the floor
    wall = np.stack([208 + 30 * t, 202 + 28 * t, 190 + 26 * t], -1)
    # center spotlight pool (lifts the middle where the set stands)
    cx, cy = W * 0.5, H * 0.40
    r = np.sqrt(((xx - cx) / (W * 0.58)) ** 2 + ((yy - cy) / (H * 0.60)) ** 2)
    spot = np.clip(1 - r, 0, 1) ** 1.4
    # drapery vignette: darker toward left/right edges (soft hanging cloth feel)
    sx = np.minimum(xx, W - xx) / (W * 0.5)
    side = 0.84 + 0.16 * np.clip(sx * 1.5, 0, 1)
    # floor band slightly darker + cooler below the horizon
    horizon = H * 0.66
    floor = np.where(yy > horizon, 1 - 0.11 * np.clip((yy - horizon) / (H - horizon), 0, 1), 1.0)
    # faint floor sheen just below horizon (polished stone)
    sheen = np.exp(-((yy - (horizon + 55)) / 80) ** 2) * 7 * spot
    val = (wall + (20 * spot)[..., None] + sheen[..., None]) * (side * floor)[..., None]
    img = Image.fromarray(np.clip(val, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(24))

    base = img.convert("RGBA")
    # soft drop shadow of the catafalque on the floor
    pcx, pty = int(W * 0.5), int(H * 0.82)
    pw = int(W * 0.46)
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([pcx - int(pw * 0.62), pty + 60, pcx + int(pw * 0.62), pty + 190], fill=(22, 18, 13, 120))
    base = Image.alpha_composite(base, sh.filter(ImageFilter.GaussianBlur(48)))
    # draped catafalque: soft dark-warm mass + lighter cloth top (kept blurry so it
    # doesn't fight the coffin's 3/4 perspective)
    pod = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dp = ImageDraw.Draw(pod)
    dp.ellipse([pcx - pw // 2, pty - 10, pcx + pw // 2, pty + 150], fill=(60, 48, 39, 255))
    dp.ellipse([pcx - pw // 2, pty - 34, pcx + pw // 2, pty + 44], fill=(92, 76, 62, 255))
    base = Image.alpha_composite(base, pod.filter(ImageFilter.GaussianBlur(16)))
    # corner vignette
    vig = Image.new("L", (W, H), 0)
    ImageDraw.Draw(vig).ellipse([int(-W * 0.18), int(-H * 0.18), int(W * 1.18), int(H * 1.18)], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(190))
    arr = np.asarray(base.convert("RGB")).astype(np.float32)
    vm = (np.asarray(vig).astype(np.float32) / 255 * 0.20 + 0.80)[..., None]
    return Image.fromarray(np.clip(arr * vm, 0, 255).astype(np.uint8))


def flatten(coffin, cross, wreath, out_path):
    base = hall().convert("RGBA")
    for cat, idn in [("crosses", cross), ("coffins", coffin), ("wreaths", wreath)]:
        base.alpha_composite(Image.open(f"{OUT}/{cat}/{idn}.webp").convert("RGBA"))
    base.convert("RGB").save(out_path, quality=92)


if __name__ == "__main__":
    hall().save(f"{OUT}/backgrounds/studio-neutral.webp", "WEBP", quality=84, method=0)
    flatten("classic-walnut", "orthodox-six-point", "orthodox-oval-red-white",
            "/sessions/gifted-sharp-davinci/mnt/outputs/hall_set1.jpg")
    flatten("classic-mahogany", "orthodox-eight-point", "orthodox-oval-white-green",
            "/sessions/gifted-sharp-davinci/mnt/outputs/hall_set2.jpg")
    print("done")
