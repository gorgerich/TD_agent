# Конвейер вырезки товаров каталога → «белая студийная» карточка

Готовит фото товаров для маркетплейса (`/agent/catalog`) и шага «Атрибутика».
Берёт страницу PDF-каталога, вырезает товар из текстурного фона (GrabCut +
доминантная модель фона + деконтаминация), кладёт на чистый белый фон,
обрезает по объекту и нормализует на единый холст.

## Зависимости

```bash
pip install --break-system-packages opencv-python-headless numpy pillow
# системно: poppler-utils (pdftoppm)  —  macOS: brew install poppler
```

## Запуск по манифесту

```bash
export CATALOG_PDF="/полный/путь/Каталог 2020.pdf"
python3 cutout.py coffins.json ../../public/catalog/coffins
python3 cutout.py extras.json  ../../public/catalog        # out-пути с подпапками
```

Скрипт также печатает контактный лист `_contact_sheet.png` в папку вывода —
быстрый QA всех вырезов.

## Формат манифеста (JSON-массив)

```jsonc
{
  "out": "fs-4.jpg",          // имя файла (можно с подпапкой: "wreaths/x.jpg")
  "page": 3,                   // страница PDF (1-based)
  "zone": "coffin_top",        // готовая зона ИЛИ "box":[l,t,r,b] в долях страницы
  "canvas": [1280, 960],       // размер холста (px)
  "mode": "rect",              // опц.: rect-инициализация для светлых объектов
  "rect_inset": 0.05,          // опц.: отступ рамки для mode:rect
  "extra_thresh": -10          // опц.: сдвиг порога детекции (− чувствительнее)
}
```

Готовые зоны для регулярной верстки «2 гроба на странице»: `coffin_top`,
`coffin_bottom`, `full`. Для сеток венков/крестов задавайте `box` вручную
(венки на стр. идут в шахматном порядке — тесните рамку под один предмет).

## AI-вырезка (рекомендуется для бигтех-качества) — `ai_matte.py`

`cutout.py` (GrabCut) оставляет фрагменты фона, «полугробы» и кривые края на
сложных кадрах. `ai_matte.py` заменяет матирование на обучаемую модель (rembg:
ISNet / BiRefNet) — чистый альфа-канал, тонкие листья венков и филигрань крестов
сохраняются, фон не «протекает».

Запускать **на Mac** (в песочнице агента не работает: лимит ~45с на команду,
нет персистентности, заблокирована загрузка весов модели). Из корня репозитория:

```bash
brew install poppler
python3 -m venv .venv && source .venv/bin/activate
pip install "rembg[cpu]" onnxruntime pillow opencv-python-headless numpy
export CATALOG_PDF="/полный/путь/Каталог 2020.pdf"
export MATTE_MODEL=birefnet-general-lite     # лучшее качество/размер; или isnet-general-use
python3 scripts/catalog/ai_matte.py          # все категории
# python3 scripts/catalog/ai_matte.py coffins   # одна категория
open scripts/catalog/_ai_contact.png         # QA-лист: оценить качество одним взглядом
```

Перезаписывает `public/catalog/<cat>/<sku>.jpg` (карточка на белом) и
`public/visualizer/<cat>/<sku>.webp` (слой в зале). Идемпотентно. Источники:
гробы/кресты — рендер+кроп из PDF (карты `coffins.json` / `extras.json`); венки —
их готовые белые карточки. Модели качаются один раз в `~/.u2net/`:
`isnet-general-use` ~170 МБ (надёжный дефолт), `birefnet-general-lite` ~220 МБ
(рекомендация), `birefnet-general` ~900 МБ (максимум).

## Подсказки по качеству

- Тёмные/тёплые гробы — берутся «из коробки».
- Белые/светлые гробы на кремовом фоне — используйте `"mode": "rect"` с тесной
  рамкой только вокруг товара (без колонтитулов).
- Венки — рамка не должна задевать соседний венок и номер-подпись.
- Источник в каталоге ~120 ppi, поэтому итоговая детализация ~450–550 px:
  достаточно для карточек, не для печати.

## Где это используется в коде

- Данные: `lib/calculationUtils.ts` → `AGENT_ATTRIBUTION_CATALOG`
  (поле `imageUrl: "/catalog/<категория>/<sku>.jpg"`).
- Витрина: `app/agent/(app)/catalog/page.tsx`.
- Шаг сметы: `app/agent/(app)/meetings/[meetingId]/quote/QuoteBuilder.tsx`
  (компонент `components/OptionCard.tsx`).

Чтобы добавить товар: положите вырез в `public/catalog/...`, добавьте объект в
`AGENT_ATTRIBUTION_CATALOG` с тем же `imageUrl`. Серия для фильтра витрины
берётся из `tags[0]`.
