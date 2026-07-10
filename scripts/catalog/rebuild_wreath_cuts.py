#!/usr/bin/env python3
"""Пересборка вырезов венков из кэшированных страниц PDF-каталога.

Источник: scripts/catalog/.cache/p-XXX.png (рендеры страниц каталога).
Выход:   public/visualizer/wreaths-cut/<sku>.webp  (прозрачный вырез для сцены)
         public/catalog/wreaths/<sku>.jpg          (белая карточка 1100x1000)

Почему не старые боксы из wreaths.json «как есть»: они резали верхушки
(жёсткий кроп). Здесь бокс расширяется (верх сильнее), объект детектируется
относительно фона страницы и вырезается целиком.

Классификатор: хрома (беж-полосы фона = тот же оттенок при другой яркости ->
не объект) + бонус за насыщенность + затемнение. Для avtorskie (стр. 88,
красное на беже, слабые полосы) — абсолютная разница (mode: abs).
Чистка: бан текстовых полос у кромок кропа, компонентный рост из ядра бокса,
расцепление тонких мостиков (номера позиций), заливка внутренних дыр.

Запуск из корня репо:  python3 scripts/catalog/rebuild_wreath_cuts.py [sku ...]
Без аргументов — все 7. Зависимости: pillow, numpy.
"""
from PIL import Image, ImageFilter
import numpy as np, os, sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
CACHE = os.path.join(os.path.dirname(__file__), ".cache")
OUT_CUT = os.path.join(ROOT, "public", "visualizer", "wreaths-cut")
OUT_CARD = os.path.join(ROOT, "public", "catalog", "wreaths")

MANIFEST = {
 "standart-mix":  {"page":"077","box":[0.34,0.14,0.66,0.41]},
 "standart-blue": {"page":"077","box":[0.62,0.13,0.98,0.41]},
 "standart-red":  {"page":"078","box":[0.33,0.64,0.67,0.92]},
 "cvetopad":      {"page":"082","box":[0.12,0.58,0.47,0.90]},
 "avtorskie":     {"page":"088","box":[0.50,0.14,0.94,0.52],"mode":"abs"},
 "tricolor":      {"page":"097","box":[0.08,0.14,0.44,0.38]},
 # ВНИМАНИЕ: «krest» — это звезда с гербом (стр. 97, поз. 8, серия «Триколор»).
 # Венка-креста в каталоге 2020 нет; имя товара в calculationUtils приведено к фото.
 "krest":         {"page":"097","box":[0.28,0.38,0.72,0.68]},
}
MT, MB, MS = 0.05, 0.02, 0.03  # расширение бокса: верх / низ / бока

def minf(m, k):
    return np.array(Image.fromarray(m.astype(np.uint8)*255).filter(ImageFilter.MinFilter(k))) > 127

def maxf(m, k):
    return np.array(Image.fromarray(m.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(k))) > 127

def grow(seed, allowed, iters=600):
    """Рост компоненты из затравки внутри маски (на 1/4 разрешения)."""
    def down(m):
        return np.array(Image.fromarray(m.astype(np.uint8)*255).resize(
            (max(1, m.shape[1]//4), max(1, m.shape[0]//4)), Image.NEAREST)) > 127
    def up(m, shape):
        return np.array(Image.fromarray(m.astype(np.uint8)*255).resize(
            (shape[1], shape[0]), Image.NEAREST)) > 127
    s, a = down(seed), down(allowed)
    cur = s & a
    for _ in range(iters):
        nxt = maxf(cur, 5) & a
        if (nxt == cur).all():
            break
        cur = nxt
    return up(cur, seed.shape) & allowed

def build(sku):
    cfg = MANIFEST[sku]
    l, t, r, b = cfg["box"]
    im = Image.open(os.path.join(CACHE, f"p-{cfg['page']}.png")).convert("RGB")
    W, H = im.size
    pp = np.array(im.resize((W//4, H//4))).astype(np.float32)
    bgc = np.median(pp.reshape(-1, 3), axis=0)  # доминирующий фон страницы
    L = max(0, int((l-MS)*W)); T = max(0, int((t-MT)*H))
    R = min(W, int((r+MS)*W)); B = min(H, int((b+MB)*H))
    crop = np.array(im.crop((L, T, R, B))).astype(np.float32)
    h, w, _ = crop.shape

    g = crop.mean(axis=2, keepdims=True)
    ch = crop - g
    bg_g = bgc.mean(); bg_ch = bgc - bg_g
    cd = np.abs(ch - bg_ch).sum(axis=2)
    vd = np.maximum(0.0, bg_g - crop.mean(axis=2))
    sat = crop.max(axis=2) - crop.min(axis=2)
    sat_bg = float(bgc.max() - bgc.min())
    if cfg.get("mode") == "abs":
        obj = np.abs(crop - bgc).sum(axis=2) > 85
    else:
        score = cd + 0.5*vd + np.maximum(0.0, sat - sat_bg - 15.0)*0.8
        obj = score > 55

    # бан текстовых полос — только у верхней/нижней кромок кропа
    rowfill = obj.mean(axis=1)
    band = np.zeros(h, dtype=bool)
    band[:int(h*0.16)] = True; band[int(h*0.86):] = True
    obj[(rowfill > 0.80) & band, :] = False

    obj = minf(obj, 3); obj = maxf(obj, 3); obj = maxf(obj, 5); obj = minf(obj, 5)

    ox0 = max(0, int(l*W)-L); oy0 = max(0, int(t*H)-T)
    ox1 = min(w, int(r*W)-L); oy1 = min(h, int(b*H)-T)
    core = np.zeros_like(obj)
    core[oy0+(oy1-oy0)//4:oy1-(oy1-oy0)//4, ox0+(ox1-ox0)//4:ox1-(ox1-ox0)//4] = True
    comp1 = grow(core & obj, obj)
    if comp1.sum() < 500:
        comp1 = obj
    # расцепить тонкие мостики (номера позиций, тени), пере-вырастить, вернуть кромку
    sever = minf(comp1, 3)
    comp = maxf(grow(core & sever, sever), 3) & comp1
    if comp.sum() < 500:
        comp = comp1

    inv = ~comp
    border = np.zeros_like(comp)
    border[:6, :] = border[-6:, :] = True; border[:, :6] = border[:, -6:] = True
    outside = grow(border & inv, inv)
    holes = inv & ~outside
    if holes.mean() > 0.30:  # гвард: заливка не удалась
        holes[:] = False
    final = comp | holes

    alpha = np.array(Image.fromarray((final*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)))
    ys, xs = np.where(alpha > 10)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = 6
    x0 = max(0, int(x0)-pad); y0 = max(0, int(y0)-pad)
    x1 = min(w-1, int(x1)+pad); y1 = min(h-1, int(y1)+pad)
    rgba = np.dstack([crop.astype(np.uint8), alpha])[y0:y1+1, x0:x1+1]
    out = Image.fromarray(rgba, "RGBA")
    os.makedirs(OUT_CUT, exist_ok=True)
    out.save(os.path.join(OUT_CUT, f"{sku}.webp"), quality=92)

    cw, chh = 1100, 1000; padf = 0.07
    card = Image.new("RGB", (cw, chh), (255, 255, 255))
    s = min((cw*(1-2*padf))/out.width, (chh*(1-2*padf))/out.height)
    rs = out.resize((max(1, int(out.width*s)), max(1, int(out.height*s))), Image.LANCZOS)
    card.paste(rs, ((cw-rs.width)//2, (chh-rs.height)//2), rs)
    os.makedirs(OUT_CARD, exist_ok=True)
    card.save(os.path.join(OUT_CARD, f"{sku}.jpg"), quality=90)
    print(sku, "->", out.size, "holes%", round(holes.mean()*100, 1))

if __name__ == "__main__":
    for sku in (sys.argv[1:] or MANIFEST):
        build(sku)
