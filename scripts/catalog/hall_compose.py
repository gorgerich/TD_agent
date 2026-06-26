#!/usr/bin/env python3
"""Composite real catalog cutouts into the photoreal hall backdrop.

Places the coffin on the black catafalque and the wreath on the gold easel, with
soft contact shadows, then crops to the visualizer aspect. Coordinates are in the
backdrop's native 1536x2048 space; tune SLOTS, then regenerate app layers.
"""
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
import recut  # alpha_clean()

HALL = "/sessions/gifted-sharp-davinci/mnt/TD_agent/public/telegram-cloud-photo-size-2-5314611185573370387-w.jpg"
CUT = "/sessions/gifted-sharp-davinci/mnt/outputs/cut"

# native-space placement: center-x, baseline-y (object bottom), target width or height
SLOTS = {
    "coffin": dict(cx=650, by=1268, w=600),
    "wreath": dict(cx=1265, by=1365, h=520),
}
CROP = (0, 640, 1536, 1792)  # 4:3 stage crop (x0,y0,x1,y1)


def shadow_under(canvas, cx, by, w, alpha=120, blur=34, squash=0.10):
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse(
        [cx - int(w * 0.5), by - int(w * squash * 0.5), cx + int(w * 0.5), by + int(w * squash)],
        fill=(8, 8, 10, alpha))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)))


def soften(rgba, erode_px=2, blur=2.2):
    import cv2
    a = np.asarray(rgba.getchannel("A"))
    a = cv2.erode(a, np.ones((erode_px * 2 + 1, erode_px * 2 + 1), np.uint8), 1)  # kill colour fringe
    a = cv2.GaussianBlur(a.astype(np.float32), (0, 0), blur)
    rgba.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    return rgba


def place_obj(canvas, cut_path, slot, shadow=True, soft=False):
    rgba = recut.alpha_clean(cut_path)
    if soft:
        rgba = soften(rgba)
    s = SLOTS[slot]
    if "w" in s:
        scale = s["w"] / rgba.width
    else:
        scale = s["h"] / rgba.height
    nw, nh = max(1, int(rgba.width * scale)), max(1, int(rgba.height * scale))
    r = rgba.resize((nw, nh), Image.LANCZOS)
    x, y = s["cx"] - nw // 2, s["by"] - nh
    if shadow:
        shadow_under(canvas, s["cx"], s["by"], nw)
    canvas.alpha_composite(r, (x, y))


def compose(coffin="coffins/fkl-6s.jpg", wreath="wreaths/wr-std-5.jpg", out="hall_test.jpg"):
    base = Image.open(HALL).convert("RGBA")
    place_obj(base, f"{CUT}/{coffin}", "coffin")
    place_obj(base, f"{CUT}/{wreath}", "wreath", soft=True)
    crop = base.crop(CROP).convert("RGB")
    crop.save(f"/sessions/gifted-sharp-davinci/mnt/outputs/{out}", quality=92)


if __name__ == "__main__":
    compose()
    print("done")
