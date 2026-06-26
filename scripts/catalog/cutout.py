#!/usr/bin/env python3
"""Catalog product cutout -> clean white studio card.

Renders a PDF page (cached), crops a product region (fractions of page),
removes the textured catalog background with GrabCut, refines the mask,
composites on pure white, auto-trims to the object and re-pads on a
standard canvas. Output: normalized JPG ready for the marketplace.
"""
import os, subprocess, sys, json
import numpy as np
import cv2
from PIL import Image

# Путь к каталогу-PDF задаётся переменной окружения CATALOG_PDF.
# Кэш отрендеренных страниц — рядом со скриптом в .cache/.
PDF = os.environ.get("CATALOG_PDF", "Каталог 2020.pdf")
HIRES = os.environ.get("CATALOG_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache"))
os.makedirs(HIRES, exist_ok=True)

def render_page(page, dpi=150):
    out = f"{HIRES}/p-{page:03d}.png"
    if not os.path.exists(out):
        subprocess.run(["pdftoppm", "-png", "-r", str(dpi), "-f", str(page),
                        "-l", str(page), PDF, f"{HIRES}/p"],
                       check=True, timeout=40)
    return out

def _largest_cc(m):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), 8)
    if n <= 1:
        return m
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (lab == big).astype(np.uint8)

def _fill_holes(m):
    h, w = m.shape
    ff = m.copy()
    cv2.floodFill(ff, np.zeros((h+2, w+2), np.uint8), (0, 0), 1)
    return (m | (1 - ff)).astype(np.uint8)

def detect_seed(bgr, border=14, extra_thresh=0):
    """Color-distance background subtraction -> binary seed of main object."""
    h, w = bgr.shape[:2]
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    # Background = the tan page. Sample the border frame, then DROP dark pixels
    # (maroon header/footer bars, dark coffin edges) before taking the median, so
    # the tan always wins. Works whether the product is dark, warm, or fills the
    # crop (where a global dominant-colour model would wrongly pick the product).
    frame = np.concatenate([
        lab[:border].reshape(-1, 3), lab[-border:].reshape(-1, 3),
        lab[:, :border].reshape(-1, 3), lab[:, -border:].reshape(-1, 3)])
    tanish = frame[frame[:, 0] > 120]                # L* > 120 keeps the light page
    if len(tanish) > 80:
        bg = np.median(tanish, axis=0)
    else:                                            # fallback: dominant colour
        flat = lab.reshape(-1, 3)
        q = np.round(flat / 8.0).astype(np.int32)
        keys = q[:, 0]*100000 + q[:, 1]*320 + q[:, 2]
        vals, counts = np.unique(keys, return_counts=True)
        bg = flat[keys == vals[np.argmax(counts)]].mean(axis=0)
    dist = np.linalg.norm(lab - bg, axis=2)
    d8 = np.clip(dist, 0, 255).astype(np.uint8)
    otsu, _ = cv2.threshold(d8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    thr = max(22, float(otsu) * 1.0) + extra_thresh
    m = (dist > thr).astype(np.uint8)
    small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    med = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, small, iterations=1)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, med, iterations=1)   # kill thin text strokes
    # pick the most "object-like" blob: big area AND substantial bbox (not a text line / sliver)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    best, best_area = 0, 0
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if hh < 0.12*h or ww < 0.10*w:        # reject text lines & slivers
            continue
        if area > best_area:
            best_area, best = area, i
    if best == 0:                              # nothing object-like -> fall back to plain largest
        m = _largest_cc(m)
    else:
        m = (lab == best).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, med, iterations=2)  # re-solidify object
    m = _largest_cc(m)
    m = _fill_holes(m)
    # decontaminate: drop any pixels still close to the page colour (tan corner
    # pockets that got enclosed when the object touches the crop border)
    m = (m & (dist > max(10.0, thr * 0.5))).astype(np.uint8)
    m = _largest_cc(m)
    return m

def grabcut_cutout(bgr, iters=5, extra_thresh=0, feather=1.4, force_rect=False, rect_inset=0.06):
    """Return float alpha [0,1]: detect object, then GrabCut-refine edges.

    force_rect=True skips colour detection and seeds GrabCut from a rectangle
    inset by rect_inset -- use for tight crops of low-contrast objects
    (e.g. white coffin on cream) where the border ring is reliably background.
    """
    h, w = bgr.shape[:2]
    seed = None if force_rect else detect_seed(bgr, extra_thresh=extra_thresh)
    if force_rect or seed.sum() < 0.01 * h * w:   # rect path
        gc = np.zeros((h, w), np.uint8)
        mx, my = int(w*rect_inset), int(h*rect_inset)
        cv2.grabCut(bgr, gc, (mx, my, w-2*mx, h-2*my),
                    np.zeros((1, 65)), np.zeros((1, 65)), max(iters, 8), cv2.GC_INIT_WITH_RECT)
        m = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)
        m = _fill_holes(_largest_cc(m))
        alpha = cv2.GaussianBlur((m*255).astype(np.float32), (0, 0), feather)/255.0
        return np.clip(alpha, 0, 1)
    ker = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    sure_fg = cv2.erode(seed, ker, iterations=2)
    sure_bg = 1 - cv2.dilate(seed, ker, iterations=3)
    gc = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
    gc[seed == 1] = cv2.GC_PR_FGD
    gc[sure_fg == 1] = cv2.GC_FGD
    gc[sure_bg == 1] = cv2.GC_BGD
    try:
        cv2.grabCut(bgr, gc, None, np.zeros((1, 65)), np.zeros((1, 65)),
                    iters, cv2.GC_INIT_WITH_MASK)
        m = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)
    except cv2.error:
        m = seed
    m = _fill_holes(_largest_cc(m))
    m = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), 1)  # pull off bg halo
    alpha = cv2.GaussianBlur((m*255).astype(np.float32), (0, 0), feather)/255.0
    return np.clip(alpha, 0, 1)

def composite_white(bgr, alpha):
    a = alpha[..., None]
    white = np.ones_like(bgr, np.float32) * 255.0
    out = bgr.astype(np.float32) * a + white * (1 - a)
    return out.astype(np.uint8), alpha

def trim_and_canvas(bgr, alpha, canvas=(1200, 900), pad_frac=0.07, bg=255):
    ys, xs = np.where(alpha > 0.5)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop = bgr[y0:y1+1, x0:x1+1]
    ch, cw = crop.shape[:2]
    CW, CH = canvas
    pad = int(min(CW, CH) * pad_frac)
    avail_w, avail_h = CW - 2*pad, CH - 2*pad
    scale = min(avail_w/cw, avail_h/ch)
    nw, nh = max(1, int(cw*scale)), max(1, int(ch*scale))
    resized = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
    out = np.ones((CH, CW, 3), np.uint8) * bg
    ox, oy = (CW-nw)//2, (CH-nh)//2
    out[oy:oy+nh, ox:ox+nw] = resized
    return out

def process(page, box, out_path, canvas=(1200, 900), rect_inset=0.06, dpi=150,
            extra_thresh=0, force_rect=False, feather=1.4):
    """box = (l, t, r, b) as fractions of the full page."""
    p = render_page(page, dpi)
    img = cv2.imread(p)
    H, W = img.shape[:2]
    l, t, r, b = box
    crop = img[int(t*H):int(b*H), int(l*W):int(r*W)]
    alpha = grabcut_cutout(crop, extra_thresh=extra_thresh, force_rect=force_rect,
                           rect_inset=rect_inset, feather=feather)
    comp, alpha = composite_white(crop, alpha)
    final = trim_and_canvas(comp, alpha, canvas)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    Image.fromarray(cv2.cvtColor(final, cv2.COLOR_BGR2RGB)).save(out_path, quality=90)
    return out_path

# Standard zones (fractions of page) for the regular 2-product coffin layout.
# Coffins span almost the full page width; the old coffin_top (r=0.575) sliced
# every top-row coffin in half at the foot. These capture the whole object with
# margin; the product-name / spec text in the crop is dropped by largest-CC.
ZONES = {
    "coffin_top":    (0.05, 0.145, 0.95, 0.45),
    "coffin_bottom": (0.05, 0.55,  0.95, 0.87),
    "wreath":        None,   # set per-cell for 3x2 grids
    "full":          (0.04, 0.10,  0.96, 0.95),
}
# 6-up wreath/cross grid cells (3 cols x 2 rows), as page fractions.
def grid_cell(col, row, cols=3, rows=2, top=0.085, bottom=0.95, left=0.02, right=0.98):
    cw = (right-left)/cols
    ch = (bottom-top)/rows
    l = left + col*cw
    t = top + row*ch
    return (l+0.004, t+0.004, l+cw-0.004, t+ch-0.004)

def run_manifest(manifest_path, out_root, contact=True):
    items = json.load(open(manifest_path, encoding="utf-8"))
    done = []
    for it in items:
        page = it["page"]
        box = it.get("box")
        if box is None and "zone" in it:
            box = ZONES[it["zone"]]
        if box is None and "cell" in it:
            box = grid_cell(*it["cell"])
        canvas = tuple(it.get("canvas", [1200, 900]))
        et = it.get("extra_thresh", 0)
        force_rect = it.get("mode") == "rect"
        out = os.path.join(out_root, it["out"])
        try:
            process(page, tuple(box), out, canvas=canvas,
                    rect_inset=it.get("rect_inset", 0.06), dpi=it.get("dpi", 150),
                    extra_thresh=et, force_rect=force_rect,
                    feather=it.get("feather", 1.4))
            done.append(out)
            print("ok ", it["out"])
        except Exception as e:
            print("ERR", it["out"], e)
    if contact and done:
        cols = 4
        thumbs = []
        for p in done:
            im = Image.open(p).convert("RGB"); im.thumbnail((300, 240)); thumbs.append((os.path.basename(p), im))
        from PIL import ImageDraw
        cw, chh = 310, 270
        rows = (len(thumbs)+cols-1)//cols
        sheet = Image.new("RGB", (cols*cw, rows*chh), (235, 235, 235))
        d = ImageDraw.Draw(sheet)
        for i, (nm, im) in enumerate(thumbs):
            r, c = divmod(i, cols)
            x, y = c*cw+5, r*chh+5
            sheet.paste(im, (x+(300-im.width)//2, y+(240-im.height)//2))
            d.text((x+5, y+248), nm, fill=(40, 40, 40))
        sheet.save(os.path.join(out_root, "_contact_sheet.png"))
        print("contact sheet ->", os.path.join(out_root, "_contact_sheet.png"))

if __name__ == "__main__":
    if len(sys.argv) > 2:
        run_manifest(sys.argv[1], sys.argv[2])
    else:
        O = "/sessions/gifted-sharp-davinci/mnt/outputs"
        process(3, ZONES["coffin_top"], f"{O}/test_fs4.jpg")
        process(3, ZONES["coffin_bottom"], f"{O}/test_fs6.jpg")
        print("smoke test done")
