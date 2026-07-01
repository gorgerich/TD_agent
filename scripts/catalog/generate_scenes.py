#!/usr/bin/env python3
"""Pre-generate photoreal funeral-hall scenes, one per coffin (run on your Mac).

Why: pasting flat catalog cutouts can't match a real photo — the coffin's fixed
product-shot angle never lies correctly on the catafalque. So we let an image
model re-render the REAL catalog coffin into the hall with correct perspective,
lighting and shadows. Wreaths stay swappable 2D overlays on the easels (a
front-facing bouquet tolerates 2D placement; a coffin does not).

Model: Google Gemini 2.5 Flash Image ("Nano Banana") — multi-image composition,
~$0.039/image, so ~21 coffins ≈ $0.8. Swap via SCENE_MODEL if needed.

Setup (Mac, from repo root):
  pip install google-genai pillow
  export GEMINI_API_KEY="...key from https://aistudio.google.com/apikey..."
  python3 scripts/catalog/generate_scenes.py --limit 2   # TEST on 2 first
  open public/visualizer/scenes/_review.jpg              # judge realism
  python3 scripts/catalog/generate_scenes.py             # then all coffins

Output: public/visualizer/scenes/<coffin-sku>.jpg  (+ _review.jpg contact sheet)
"""
import os
import sys
import glob
import io
import time
import traceback
from PIL import Image
from google import genai
from google.genai import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
COFFINS = os.path.join(ROOT, "public", "catalog", "coffins")
HALL = os.path.join(ROOT, "public", "telegram-cloud-document-2-5339499459736804779.jpg")
OUT = os.path.join(ROOT, "public", "visualizer", "scenes")
MODEL = os.environ.get("SCENE_MODEL", "gemini-2.5-flash-image")

# Locked recipe (validated in-app): new hall + golden-middle framing, one shot.
PROMPT = (
    "На первом изображении — пустой зал прощания: чёрный катафалок и золотой "
    "православный крест на стене. На втором — гроб из каталога. Сгенерируй "
    "фотореалистичное изображение (как настоящее фото, не 3D-рендер, формат 4:3): "
    "этот же гроб — точно сохрани форму, цвет дерева, глянец, резьбу и металлические "
    "ручки, не меняй дизайн — закрытый, лежащий вдоль катафалка длинной стороной к "
    "зрителю, по центру на чёрном столе, во всю длину катафалка, плотно на поверхности. "
    "Полностью сохрани зал, настенный крест и свет из первого изображения. По бокам от "
    "катафалка — два пустых чёрных металлических мольберта, оба целиком видны в кадре. "
    "Камера на среднем расстоянии: катафалок с гробом занимает большую часть кадра, но по "
    "бокам видно оба мольберта и немного зала; вид немного сбоку и чуть сверху. "
    "Реалистичная контактная тень под столом. Без людей, без текста, без логотипов."
)


def load(path, max_side=1024):
    im = Image.open(path).convert("RGB")
    im.thumbnail((max_side, max_side))
    return im


def _config():
    # image_config / ImageConfig may not exist on older google-genai -> degrade.
    try:
        return types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            image_config=types.ImageConfig(aspect_ratio="4:3"),
        )
    except Exception:
        try:
            return types.GenerateContentConfig(response_modalities=["IMAGE"])
        except Exception:
            return types.GenerateContentConfig(response_modalities=["Text", "Image"])


def generate(client, coffin_path):
    resp = client.models.generate_content(
        model=MODEL,
        contents=[PROMPT, load(HALL), load(coffin_path)],
        config=_config(),
    )
    cand = (getattr(resp, "candidates", None) or [None])[0]
    if cand is None:
        print("   нет candidates | prompt_feedback:", getattr(resp, "prompt_feedback", None))
        return None
    parts = getattr(getattr(cand, "content", None), "parts", None) or []
    img_bytes, texts = None, []
    for p in parts:
        inl = getattr(p, "inline_data", None)
        if inl and getattr(inl, "data", None):
            img_bytes = inl.data
        elif getattr(p, "text", None):
            texts.append(p.text)
    if img_bytes is None:
        # surface WHY: safety block, refusal text, or finish reason
        print("   нет картинки | finish:", getattr(cand, "finish_reason", None),
              "| text:", (" ".join(texts))[:240] or "—",
              "| prompt_feedback:", getattr(resp, "prompt_feedback", None))
        return None
    return Image.open(io.BytesIO(img_bytes)).convert("RGB")


def main():
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("Set GEMINI_API_KEY (https://aistudio.google.com/apikey)")
        sys.exit(1)
    client = genai.Client(api_key=key)
    try:
        import importlib.metadata as _m
        print("google-genai", _m.version("google-genai"), "| model", MODEL)
    except Exception:
        pass
    os.makedirs(OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(COFFINS, "*.jpg")))
    if limit:
        files = files[:limit]
    done = []
    for f in files:
        sku = os.path.splitext(os.path.basename(f))[0]
        if os.path.exists(os.path.join(OUT, sku + ".jpg")) and os.environ.get("SCENE_FORCE") != "1":
            print("skip", sku, "(scene exists)")
            continue
        try:
            img = generate(client, f)
            if img is None:
                print("no image", sku)
                continue
            img.convert("RGB").save(os.path.join(OUT, sku + ".jpg"), quality=92)
            done.append(sku)
            print("ok ", sku)
        except Exception as e:
            print("ERR", sku, type(e).__name__, str(e)[:300])
            traceback.print_exc()
            time.sleep(1)
    if done:
        cols = min(3, len(done))
        rows = (len(done) + cols - 1) // cols
        tw, th = 440, 330
        sheet = Image.new("RGB", (cols * tw, rows * th), (238, 238, 238))
        for i, sku in enumerate(done):
            im = Image.open(os.path.join(OUT, sku + ".jpg")).convert("RGB")
            im.thumbnail((tw - 8, th - 8))
            r, c = divmod(i, cols)
            sheet.paste(im, (c * tw + 4, r * th + 4))
        sheet.save(os.path.join(OUT, "_review.jpg"), quality=90)
    print(f"\n{len(done)} scenes -> {OUT}")


if __name__ == "__main__":
    main()
