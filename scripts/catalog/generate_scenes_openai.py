#!/usr/bin/env python3
"""OpenAI GPT Image variant of scene generation (run on your Mac).

Same recipe as generate_scenes.py, but via OpenAI images.edit instead of Gemini:
feeds the empty hall + the real catalog coffin and composes a photoreal
funeral-hall scene with that coffin lying full-length on the catafalque, two
empty easels at the sides. Skips scenes that already exist.

IMPORTANT: a ChatGPT Plus subscription does NOT grant API access. You need an
OpenAI *API* key from https://platform.openai.com with billing enabled.

Setup (Mac, from repo root):
  source .venv/bin/activate
  pip install openai pillow
  export OPENAI_API_KEY="sk-..."             # OpenAI Platform key with billing
  # optional: export SCENE_MODEL_OPENAI=gpt-image-1   (default)
  python3 scripts/catalog/generate_scenes_openai.py           # all missing coffins
  # python3 scripts/catalog/generate_scenes_openai.py --limit 2   # test on 2 first
  open public/visualizer/scenes/_review.jpg

Notes:
  - Skips coffins that already have a scene; SCENE_FORCE=1 regenerates all.
  - To redo one: rm public/visualizer/scenes/<sku>.jpg  then re-run.
  - Output 1536x1024 (~landscape); the app crops to 4:3 on display.
"""
import os
import sys
import glob
import io
import base64
import traceback
from PIL import Image, ImageDraw
from openai import OpenAI

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
COFFINS = os.path.join(ROOT, "public", "catalog", "coffins")
HALL = os.path.join(ROOT, "public", "telegram-cloud-document-2-5339499459736804779.jpg")
OUT = os.path.join(ROOT, "public", "visualizer", "scenes")
MODEL = os.environ.get("SCENE_MODEL_OPENAI", "gpt-image-1")

PROMPT = (
    "На первом изображении — пустой зал прощания: чёрный катафалок и золотой "
    "православный крест на стене. На втором — гроб из каталога. Собери "
    "фотореалистичное изображение (как настоящее фото, не 3D-рендер): этот же гроб "
    "— точно сохрани форму, цвет дерева, глянец, резьбу и металлические ручки, не "
    "меняй дизайн — закрытый, лежащий вдоль катафалка длинной стороной к зрителю, "
    "по центру, почти во всю длину чёрного стола (занимает почти весь стол с "
    "небольшими полями). Полностью сохрани зал, настенный крест и свет из первого "
    "изображения. По бокам от катафалка — два пустых чёрных металлических мольберта "
    "нормального размера, оба целиком в кадре. Камера на среднем расстоянии, вид "
    "немного сбоку и чуть сверху. Реалистичная контактная тень под столом. Без "
    "людей, без текста, без логотипов."
)


def main():
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        print("Set OPENAI_API_KEY (https://platform.openai.com, billing enabled)")
        sys.exit(1)
    client = OpenAI(api_key=key)
    os.makedirs(OUT, exist_ok=True)
    files = sorted(glob.glob(os.path.join(COFFINS, "*.jpg")))
    if "--limit" in sys.argv:
        files = files[: int(sys.argv[sys.argv.index("--limit") + 1])]
    done = []
    for f in files:
        sku = os.path.splitext(os.path.basename(f))[0]
        if os.path.exists(os.path.join(OUT, sku + ".jpg")) and os.environ.get("SCENE_FORCE") != "1":
            print("skip", sku, "(scene exists)")
            continue
        try:
            with open(HALL, "rb") as h, open(f, "rb") as c:
                r = client.images.edit(model=MODEL, image=[h, c], prompt=PROMPT, size="1536x1024")
            img = Image.open(io.BytesIO(base64.b64decode(r.data[0].b64_json))).convert("RGB")
            img.thumbnail((1280, 1280))
            img.save(os.path.join(OUT, sku + ".jpg"), quality=90)
            done.append(sku)
            print("ok ", sku)
        except Exception as e:
            print("ERR", sku, type(e).__name__, str(e)[:300])
            traceback.print_exc()
    # QA contact sheet of everything currently in scenes/
    scenes = sorted(glob.glob(os.path.join(OUT, "*.jpg")))
    if scenes:
        cols, tw, th = 4, 360, 270
        rows = (len(scenes) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * tw, rows * th), (238, 238, 238))
        d = ImageDraw.Draw(sheet)
        for i, p in enumerate(scenes):
            im = Image.open(p).convert("RGB")
            im.thumbnail((tw - 8, th - 20))
            rr, cc = divmod(i, cols)
            sheet.paste(im, (cc * tw + 4, rr * th + 4))
            d.text((cc * tw + 6, rr * th + th - 16), os.path.splitext(os.path.basename(p))[0], fill=(20, 20, 20))
        sheet.save(os.path.join(OUT, "_review.jpg"))
    print(f"\n{len(done)} new scenes -> {OUT}")


if __name__ == "__main__":
    main()
