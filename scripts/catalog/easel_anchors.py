#!/usr/bin/env python3
"""Якоря мольбертов для сцен визуализатора -> components/visualizer/sceneAnchors.ts.

Для каждой сцены public/visualizer/scenes/<sku>.jpg и каждой стороны ищем
треногу мольберта: X берём из проверенных приоров (венки уже садились по X),
вертикаль детектируем компонентным ростом от ног (низ окна, светлый пол)
вверх по тёмной маске — шторы/стены не связаны с мольбертом и отсекаются.

Санитария: top 0.22..0.50, h 0.30..0.60; вне пределов — медианы стороны.
Модель посадки венка: высота = 0.78 h мольберта, низ на 0.97 h от верха.

Запуск из корня репо: python3 scripts/catalog/easel_anchors.py
Печатает готовый TS-блок для SCENE_EASEL_ANCHORS. При перегенерации любой
сцены прогнать заново и проверить композиты глазами.
"""
from PIL import Image, ImageFilter
import numpy as np, os, sys, json

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCENES = os.path.join(ROOT, "public", "visualizer", "scenes")

PRIOR_X = {
 "fch-2": (0.158, 0.87), "fh-2": (0.159, 0.857), "fkl-6s": (0.155, 0.871),
 "fkl-6t": (0.161, 0.865), "fklv-6s": (0.158, 0.863), "fko-6": (0.157, 0.895),
 "fo-2": (0.156, 0.886), "fs-4": (0.15, 0.87), "fs-6": (0.157, 0.873),
 "fsi-6": (0.16, 0.883), "fsi-6b": (0.16, 0.856), "fsi-6s": (0.16, 0.902),
 "fsi-6t": (0.16, 0.91), "fsn-4": (0.16, 0.885), "fsn-6s": (0.16, 0.881),
 "fsr-4": (0.159, 0.852), "fsr-6": (0.16, 0.838), "fv-2": (0.156, 0.857),
 "fva-2": (0.153, 0.863), "fvk-2s": (0.151, 0.893), "fvp-2s": (0.158, 0.884),
}
WH_K, BOT_K = 0.78, 0.97

def minf(m, k):
    return np.array(Image.fromarray(m.astype(np.uint8)*255).filter(ImageFilter.MinFilter(k))) > 127

def maxf(m, k):
    return np.array(Image.fromarray(m.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(k))) > 127

def grow(seed, allowed, iters=300):
    def down(m):
        return np.array(Image.fromarray(m.astype(np.uint8)*255).resize(
            (max(1, m.shape[1]//2), max(1, m.shape[0]//2)), Image.NEAREST)) > 127
    def up(m, shape):
        return np.array(Image.fromarray(m.astype(np.uint8)*255).resize(
            (shape[1], shape[0]), Image.NEAREST)) > 127
    s, a = down(seed), down(allowed)
    cur = s & a
    for _ in range(iters):
        nxt = maxf(cur, 7) & a
        if (nxt == cur).all():
            break
        cur = nxt
    return up(cur, seed.shape) & allowed

def detect_at(px, W, H, cx):
    x0 = max(0, int((cx-0.05)*W)); x1 = min(W, int((cx+0.05)*W))
    y0 = int(0.15*H); y1 = int(0.93*H)
    zone = px[y0:y1, x0:x1]
    v = zone.mean(axis=2)
    dark = v < 66
    dark = minf(dark, 3); dark = maxf(dark, 3)
    zh = zone.shape[0]
    seed = np.zeros_like(dark); seed[int(zh*0.55):, :] = True
    comp = grow(seed & dark, dark)
    if comp.sum() < 150:
        comp = dark
    if comp.sum() < 150:
        return None
    rows = comp.sum(axis=1)
    ys = np.where(rows > 2)[0]
    if len(ys) < 10:
        return None
    return {"top": (y0+float(ys.min()))/H, "h": float(ys.max()-ys.min())/H}

def sane(a):
    return a and 0.22 <= a["top"] <= 0.50 and 0.30 <= a["h"] <= 0.60

def main():
    det = {}
    for sku, (lx, rx) in sorted(PRIOR_X.items()):
        im = Image.open(os.path.join(SCENES, sku + ".jpg")).convert("RGB")
        W, H = im.size
        px = np.array(im).astype(np.float32)
        det[sku] = {"left": detect_at(px, W, H, lx), "right": detect_at(px, W, H, rx)}
    med = {}
    for side in ("left", "right"):
        tops = [det[s][side]["top"] for s in det if sane(det[s][side])]
        hs = [det[s][side]["h"] for s in det if sane(det[s][side])]
        med[side] = (float(np.median(tops)), float(np.median(hs)))
    print("// SCENE_EASEL_ANCHORS (вставить в components/visualizer/sceneAnchors.ts)")
    for sku, (lx, rx) in sorted(PRIOR_X.items()):
        parts = []
        for side, x in (("left", lx), ("right", rx)):
            d = det[sku][side]
            top, h = (d["top"], d["h"]) if sane(d) else med[side]
            wh = WH_K*h
            cy = top + BOT_K*h - wh/2
            fb = "" if sane(d) else " /*median*/"
            parts.append(f'{side}: {{ x: {x}, cy: {round(cy,4)}, h: {round(wh,4)} }}{fb}')
        print(f'  "{sku}": {{ {parts[0]}, {parts[1]} }},')

if __name__ == "__main__":
    main()
