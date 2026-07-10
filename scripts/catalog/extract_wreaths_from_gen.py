#!/usr/bin/env python3
"""Вырезка венков из AI-генераций v5: мягкие края + placement-метрики.

Отличия от v4:
- без эрозии/sever (не жрёт лепестки), маска дилатируется на 2px и растушёвывается;
- белые цветы: шире кольцо (41px), мягче пороги;
- НОВОЕ: детект треноги в самой генерации -> метрики посадки венка
  относительно мольберта (hr = h_венка/h_мольберта, bottomK = (низ венка -
  верх мольберта)/h_мольберта, dxK = (cx венка - cx мольберта)/h_мольберта).
  Рендер воспроизводит эти отношения в каждой сцене — венок стоит там же,
  где его поставил AI: на перекладине.

Выход: /tmp/viz/wcut3/<sku>-<side>.webp + placements.json
"""
from PIL import Image, ImageFilter
import numpy as np, os, sys, json

GEN = "/tmp/viz/gen"
OUT = "/tmp/viz/wcut3"
SKUS = ["avtorskie","cvetopad","krest","standart-blue","standart-mix","standart-red","tricolor"]
SOFT = {"cvetopad","standart-mix"}

def minf(m,k): return np.array(Image.fromarray(m.astype(np.uint8)*255).filter(ImageFilter.MinFilter(k)))>127
def maxf(m,k): return np.array(Image.fromarray(m.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(k)))>127

def grow(seed, allowed, iters=300):
    def down(m): return np.array(Image.fromarray(m.astype(np.uint8)*255).resize((max(1,m.shape[1]//2), max(1,m.shape[0]//2)), Image.NEAREST))>127
    def up(m,shape): return np.array(Image.fromarray(m.astype(np.uint8)*255).resize((shape[1],shape[0]), Image.NEAREST))>127
    s,a = down(seed), down(allowed)
    cur = s & a
    for _ in range(iters):
        nxt = maxf(cur,7) & a
        if (nxt==cur).all(): break
        cur = nxt
    return up(cur, seed.shape) & allowed

def detect_easel(px, W, H, side):
    """Тренога в генерации: рост от ног по тёмной тонкой маске."""
    if side == "left":
        x0,x1 = int(0.03*W), int(0.30*W)
    else:
        x0,x1 = int(0.68*W), int(0.97*W)
    y0,y1 = int(0.15*H), int(0.95*H)
    zone = px[y0:y1, x0:x1]
    v = zone.mean(axis=2)
    dark = v < 66
    dark = minf(dark,3); dark = maxf(dark,3)
    zh = zone.shape[0]
    seed = np.zeros_like(dark); seed[int(zh*0.6):, :] = True
    comp = grow(seed & dark, dark)
    if comp.sum() < 150: comp = dark
    rows = comp.sum(axis=1)
    ys = np.where(rows > 2)[0]
    ytop, ybot = int(ys.min()), int(ys.max())
    yy,xx = np.where(comp)
    upper = yy < ytop + 0.5*(ybot-ytop)
    cx = float(np.median(xx[upper])) if upper.sum() > 30 else float(np.median(xx))
    return {"top": y0+ytop, "bot": y0+ybot, "cx": x0+cx}

def extract(sku, side):
    im = Image.open(f"{GEN}/gen-{sku}.png").convert("RGB")
    W,H = im.size
    px_full = np.array(im).astype(np.float32)
    easel = detect_easel(px_full, W, H, side)
    if side == "left":
        x0,x1 = int(0.02*W), int(0.33*W)
    else:
        x0,x1 = int(0.66*W), int(0.98*W)
    y0,y1 = int(0.15*H), int(0.92*H)
    zone = px_full[y0:y1, x0:x1]
    h,w,_ = zone.shape
    v = zone.mean(axis=2)
    sat = zone.max(axis=2) - zone.min(axis=2)
    r,g,b = zone[:,:,0], zone[:,:,1], zone[:,:,2]
    warm = (r > g) & (g > b) & ((g - b) > 0.25*np.maximum(sat,1))
    strong = (sat > (52 if sku in SOFT else 62)) & ~warm
    white = (v > (168 if sku in SOFT else 178)) & (sat < 62) & maxf(strong, 27)
    strong = strong | white
    dark_fringe = v < 55
    dens = np.array(Image.fromarray((strong*255).astype(np.uint8)).filter(ImageFilter.BoxBlur(25))).astype(np.float32)
    cy_seed, cx_seed = np.unravel_index(np.argmax(dens), dens.shape)
    core = np.zeros_like(strong)
    core[max(0,cy_seed-int(h*0.10)):cy_seed+int(h*0.10), max(0,cx_seed-int(w*0.10)):cx_seed+int(w*0.10)] = True
    allowed = maxf(strong, 5) | (dark_fringe & maxf(strong, 9))
    comp = grow(core & allowed, allowed)
    if comp.sum() < 2000: comp = allowed
    # гроб примыкает к зоне изнутри кадра: отрезаем крайние колонки зоны
    # (венок не доходит до катафалка) и перерастим от ядра
    edge = np.zeros_like(comp)
    if side == "left":
        edge[:, int(w*0.78):] = True
    else:
        edge[:, :int(w*0.22)] = True
    comp = comp & ~edge
    comp = grow(core & comp, comp)
    # БЕЗ эрозии: только лёгкое закрытие и dilate 2px, чтобы не съедать лепестки
    comp = maxf(comp, 3)
    inv = ~comp
    border = np.zeros_like(comp); border[:6,:]=border[-6:,:]=True; border[:,:6]=border[:,-6:]=True
    outside = grow(border & inv, inv, iters=400)
    holes = inv & ~outside
    if holes.mean() > 0.3: holes[:] = False
    final = comp | holes
    alpha = np.array(Image.fromarray((final*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6)))
    ys,xs = np.where(alpha > 10)
    bx0,bx1,by0,by1 = int(xs.min()),int(xs.max()),int(ys.min()),int(ys.max())
    pad=4
    bx0=max(0,bx0-pad); by0=max(0,by0-pad); bx1=min(w-1,bx1+pad); by1=min(h-1,by1+pad)
    rgba = np.dstack([zone.astype(np.uint8), alpha])[by0:by1+1, bx0:bx1+1]
    out = Image.fromarray(rgba,"RGBA")
    os.makedirs(OUT, exist_ok=True)
    out.save(f"{OUT}/{sku}-{side}.webp", quality=92)
    # placement: венок относительно треноги (всё в px генерации)
    wr_top = y0+by0; wr_bot = y0+by1
    wr_cx = x0 + (bx0+bx1)/2
    eh = easel["bot"] - easel["top"]
    meta = {
        "hr": round((wr_bot-wr_top)/eh, 4),
        "bottomK": round((wr_bot-easel["top"])/eh, 4),
        "dxK": round((wr_cx-easel["cx"])/eh, 4),
        "aspect": round(out.width/out.height, 4),
    }
    print(sku, side, out.size, meta)
    return meta

def main(skus):
    pf = f"{OUT}/placements.json"
    data = json.load(open(pf)) if os.path.exists(pf) else {}
    for sku in skus:
        data.setdefault(sku, {})
        for side in ("left","right"):
            data[sku][side] = extract(sku, side)
    json.dump(data, open(pf,"w"), indent=1)

if __name__ == "__main__":
    main(sys.argv[1:] or SKUS)
