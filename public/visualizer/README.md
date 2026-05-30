# Слои 2.5D-визуализатора (RitualSetPreview)

Сюда кладутся PNG/WebP-слои с прозрачным фоном. Пока файлов нет —
компонент показывает graceful placeholder (без сломанных img, без краша).

## Формат / размеры
- **WebP** (или PNG) с **прозрачным фоном** (кроме фона студии).
- Размер: **1600×1200** (4:3), один ракурс/камера/свет на ВСЕ слои.
- Контактная тень — отдельными слоями (shadows/) либо впечена в объект.
- Объект уже спозиционирован внутри кадра 4:3 (слои накладываются inset-0).

## Куда класть (пути из `components/visualizer/visualizerAssets.ts`)
```
/public/visualizer/
  backgrounds/studio-neutral.webp
  coffins/<model>-<wood>.webp        # classic-dark-oak, classic-walnut, simple-dark …
  upholstery/<id>.webp               # white-satin, cream-satin, white-gold-trim, burgundy-velvet
  wreaths/<id>.webp                  # orthodox-oval-white-green, orthodox-oval-red-white …
  crosses/<id>.webp                  # orthodox-six-point, orthodox-eight-point
  shadows/coffin-shadow.webp
  shadows/wreath-shadow.webp
  shadows/cross-shadow.webp
```

### id (как строятся в коде)
- coffin: `<model>-<wood>` — model: `classic|modern|simple`, wood: `dark-oak|walnut|mahogany|black|white`
- upholstery: `white-satin | cream-satin | white-gold-trim | burgundy-velvet`
- wreath: `orthodox-<oval|teardrop>-<white-green|red-white|burgundy-green>`
- cross: `orthodox-six-point | orthodox-eight-point`

### Порядок слоёв (z)
фон → тень гроба → тень креста → тень венка → крест → гроб → обивка → венок.

Любой отсутствующий слой не показывается. Нет слоя гроба → graceful fallback
(в конструкторе — placeholder, в смете — SVG-предпросмотр).

## Венок (требование)
Вертикальный овальный/каплевидный православный, ~110–140 см по масштабу,
на стойке, справа/справа-сзади. НЕ круглый западный, НЕ декоративный.
