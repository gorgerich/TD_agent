# Слои конфигуратора

Сюда кладутся фотореалистичные слои-картинки. Пока файлов нет —
превью падает на интерактивную 3D-сцену (Three.js).

## Спека
- Формат: **PNG с прозрачным фоном** (кроме `bg-studio.jpg`).
- Размер: **1600×1200** (4:3), все слои в одной системе координат.
- Один ракурс / камера / свет на ВСЕ слои (3/4, как референс).
- Контактная тень впечена в слой объекта.

## Имена файлов (строятся в `components/configurator/layers.ts`)
```
bg-studio.jpg                       # тёмный студийный фон (cover)
coffin_<model>_<wood>.png           # гроб: model × дерево
interior_<material>_<color>.png     # обивка (поверх гроба)
wreath_<shape>_<color>.png          # венок (справа)
cross_<kind>.png                    # крест (за венком)
```

### Значения
- model: `hex_classic | hex_modern | rect`
- wood: `dark_oak | walnut | mahogany | black | white`
- material: `satin | velvet | brocade`
- color (обивка): `white | cream | gold`
- shape (венок): `oval_110 | oval_140 | teardrop_120`
- color (венок): `white_green | red_white | burgundy_green | cream`
- kind (крест): `ortho_6 | ortho_8`

### Пример набора по умолчанию
```
bg-studio.jpg
coffin_hex_classic_dark_oak.png
interior_satin_white.png
wreath_oval_110_white_green.png
cross_ortho_6.png
```

Любой отсутствующий слой просто не показывается. Если нет слоя гроба —
включается 3D-фолбэк.
