#!/usr/bin/env python3
"""AI-quality background removal for the catalog — run this on your Mac.

Why a separate script / why not in the agent sandbox:
  The agent sandbox caps every command at ~45s, does not persist state between
  commands, and blocks fetching arbitrary files over the network — so the rembg
  model weights never land and a batch over ~100 images can't finish. None of
  those limits exist on your Mac, where this runs in one shot.

What it does:
  Replaces the fragile GrabCut / white-flood-fill matte with a *learned* matte
  (rembg: ISNet or BiRefNet). That fixes the three problems you flagged —
  catalog-background fragments, half-cut coffins, and crooked edges — and keeps
  thin structures (wreath leaves, cross filigree) intact.

Inputs:
  coffins, crosses -> rendered + cropped from the catalog PDF (page/box maps in
                      coffins.json / extras.json), then matted on the original
                      tan page (best — recovers the full object in one step).
  wreaths          -> matted from their existing clean white cards (colourful
                      objects on white separate perfectly; no PDF box needed).

Outputs (overwrites in place, safe to re-run):
  public/catalog/<cat>/<sku>.jpg      marketplace card on white
  public/visualizer/<cat>/<sku>.webp  transparent layer placed in the hall
  scripts/catalog/_ai_contact.png     QA contact sheet (judge quality in one look)

Usage (Mac, from repo root):
  brew install poppler                         # provides pdftoppm
  python3 -m venv .venv && source .venv/bin/activate
  pip install "rembg[cpu]" onnxruntime pillow opencv-python-headless numpy
  export CATALOG_PDF="/full/path/to/Каталог 2020.pdf"
  export MATTE_MODEL=birefnet-general-lite      # best quality/size; or isnet-general-use
  python3 scripts/catalog/ai_matte.py           # all categories
  # python3 scripts/catalog/ai_matte.py coffins # one category only
  open scripts/catalog/_ai_contact.png

Models (rembg downloads once to ~/.u2net/):
  isnet-general-use      ~170 MB  reliable, strong edges          (safe default)
  birefnet-general-lite  ~220 MB  best quality/speed balance      (recommended)
  birefnet-general       ~900 MB  maximum edge fidelity
"""
import os
import sys
import json
import glob
import numpy as np
import cv2
from PIL import Image, ImageFilter, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # repo root
sys.path.insert(0, HERE)
import cutout as C                                       # render_page, ZONES, grid_cell

CATALOG = os.path.join(ROOT, "public", "catalog")
VIS = os.path.join(ROOT, "public", "visualizer")
MODEL = os.environ.get("MATTE_MODEL", "isnet-general-use")
CONTACT = os.path.join(HERE, "_ai_contact.png")

# ---- hall stage geometry (mirrors hall_layers.py / hall_compose.py) ----
CROP = (0, 640, 1536, 1792)            # 4:3 stage crop of the hall backdrop
CW, CH = CROP[2] - CROP[0], CROP[3] - CROP[1]   # 1536 x 1152
DY = CROP[1]
SLOTS = {
    # coffin rests ON the catafalque top (front edge ~y648 in crop space), sized to the table
    "coffins": dict(cx=720,  by=648, w=700, soft=False, sh=True),
    # wreath stands on the gold easel at right
    "wreaths": dict(cx=1300, by=720, h=470, soft=True,  sh=False),
    # cross layer is still generated (catalog card); the hall backdrop already
    # has its own cross, so the scene does not composite a product cross here.
    "crosses": dict(cx=210,  by=660, h=600, soft=False, sh=False),
}
CARD = {"coffins": (1280, 960), "wreaths": (1100, 1000), "crosses": (760, 1100)}

_SESSION = None


def session():
    global _SESSION
    if _SESSION is None:
        from rembg import new_session
        _SESSION = new_session(MODEL)
    return _SESSION


def ai_alpha(pil_rgb):
    """Learned matte -> cleaned, trimmed RGBA (keeps soft edges & thin parts)."""
    from rembg import remove
    cut = remove(pil_rgb, session=session(), post_process_mask=True).convert("RGBA")
    a = np.asarray(cut.getchannel("A"))
    m = (a > 10).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:                                   # drop stray specks -> single object
        m = (lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
    ff = m.copy()                               # fill interior holes
    cv2.floodFill(ff, np.zeros((m.shape[0] + 2, m.shape[1] + 2), np.uint8), (0, 0), 1)
    m = (m | (1 - ff)).astype(np.uint8)
    a = (a * m).astype(np.uint8)
    a = cv2.erode(a, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), 1)  # de-fringe
    a = np.clip(cv2.GaussianBlur(a.astype(np.float32), (0, 0), 0.8), 0, 255).astype(np.uint8)
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cut.putalpha(Image.fromarray(a))
    return cut.crop((int(x0), int(y0), int(x1) + 1, int(y1) + 1))


def source_from_pdf(it):
    box = it.get("box")
    if box is None and "zone" in it:
        box = C.ZONES[it["zone"]]
    if box is None and "cell" in it:
        box = C.grid_cell(*it["cell"])
    p = C.render_page(it["page"], it.get("dpi", 150))
    img = cv2.imread(p)
    H, W = img.shape[:2]
    l, t, r, b = box
    crop = img[int(t * H):int(b * H), int(l * W):int(r * W)]
    return Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))


def soften(rgba, erode_px=2, blur=2.2):
    a = np.asarray(rgba.getchannel("A"))
    a = cv2.erode(a, np.ones((erode_px * 2 + 1, erode_px * 2 + 1), np.uint8), 1)
    a = cv2.GaussianBlur(a.astype(np.float32), (0, 0), blur)
    rgba.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    return rgba


def shadow(canvas, cx, by, w):
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse(
        [cx - int(w * 0.5), by - int(w * 0.05), cx + int(w * 0.5), by + int(w * 0.09)],
        fill=(8, 8, 10, 120))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(30)))


def white_card(rgba, cat):
    CWc, CHc = CARD[cat]
    pad = int(min(CWc, CHc) * 0.07)
    scale = min((CWc - 2 * pad) / rgba.width, (CHc - 2 * pad) / rgba.height)
    nw, nh = max(1, int(rgba.width * scale)), max(1, int(rgba.height * scale))
    r = rgba.resize((nw, nh), Image.LANCZOS)
    card = Image.new("RGBA", (CWc, CHc), (255, 255, 255, 255))
    card.alpha_composite(r, ((CWc - nw) // 2, (CHc - nh) // 2))
    return card.convert("RGB")


def hall_layer(rgba, cat):
    s = SLOTS[cat]
    if s["soft"]:
        rgba = soften(rgba)
    scale = (s["w"] / rgba.width) if "w" in s else (s["h"] / rgba.height)
    nw, nh = max(1, int(rgba.width * scale)), max(1, int(rgba.height * scale))
    r = rgba.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    if s["sh"]:
        shadow(canvas, s["cx"], s["by"], nw)
    canvas.alpha_composite(r, (s["cx"] - nw // 2, s["by"] - nh))
    return canvas


def jobs():
    out = []
    for it in json.load(open(os.path.join(HERE, "coffins.json"), encoding="utf-8")):
        sku = os.path.splitext(os.path.basename(it["out"]))[0]
        out.append(("coffins", sku, ("pdf", it)))
    for it in json.load(open(os.path.join(HERE, "extras.json"), encoding="utf-8")):
        if it["out"].startswith("crosses/"):
            sku = os.path.splitext(os.path.basename(it["out"]))[0]
            out.append(("crosses", sku, ("pdf", it)))
    for it in json.load(open(os.path.join(HERE, "wreaths.json"), encoding="utf-8")):
        sku = os.path.splitext(os.path.basename(it["out"]))[0]
        out.append(("wreaths", sku, ("pdf", it)))
    return out


def run(only=None):
    done = []
    for cat, sku, (mode, ref) in jobs():
        if only and cat not in only:
            continue
        try:
            src = source_from_pdf(ref) if mode == "pdf" else Image.open(ref).convert("RGB")
            rgba = ai_alpha(src)
            if rgba is None:
                print("skip(empty)", cat, sku)
                continue
            os.makedirs(os.path.join(CATALOG, cat), exist_ok=True)
            os.makedirs(os.path.join(VIS, cat), exist_ok=True)
            white_card(rgba, cat).save(os.path.join(CATALOG, cat, sku + ".jpg"), quality=92)
            hall_layer(rgba, cat).save(os.path.join(VIS, cat, sku + ".webp"), "WEBP", quality=86, method=4)
            done.append((cat, sku))
            print("ok ", cat, sku)
        except Exception as e:
            print("ERR", cat, sku, repr(e))
    contact(done)
    print(f"\n{len(done)} items -> {CONTACT}")


def contact(done):
    if not done:
        return
    bg = os.path.join(VIS, "backgrounds", "studio-neutral.webp")
    base = Image.open(bg).convert("RGBA") if os.path.exists(bg) else Image.new("RGBA", (CW, CH), (235, 235, 235, 255))
    cols, tw, th = 5, 300, 225
    rows = (len(done) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * th), (240, 240, 240))
    d = ImageDraw.Draw(sheet)
    for i, (cat, sku) in enumerate(done):
        cell = base.copy()
        lp = os.path.join(VIS, cat, sku + ".webp")
        if os.path.exists(lp):
            cell.alpha_composite(Image.open(lp).convert("RGBA"))
        cell = cell.convert("RGB")
        cell.thumbnail((tw - 8, th - 22))
        r, c = divmod(i, cols)
        x, y = c * tw + 4, r * th + 2
        sheet.paste(cell, (x, y))
        d.text((x + 4, y + th - 16), f"{cat}/{sku}", fill=(30, 30, 30))
    sheet.save(CONTACT)


if __name__ == "__main__":
    run(set(sys.argv[1:]) or None)
