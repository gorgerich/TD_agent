// Конфиг ассетов 2.5D-визуализатора. Все пути — здесь, чтобы заменить
// картинки без правок компонента. Файлы кладутся в /public/visualizer/.
// Пока файлов нет — RitualSetPreview показывает graceful placeholder.

export const VISUALIZER_BASE = "/visualizer";

type AssetMap = Record<string, string>;

// Явные записи (для документации/override). Если id нет в карте —
// путь строится автоматически: /visualizer/<category>/<id>.webp
export const visualizerAssets = {
  background: `${VISUALIZER_BASE}/backgrounds/studio-neutral.webp`,
  coffins: {
    "classic-dark-oak": `${VISUALIZER_BASE}/coffins/classic-dark-oak.webp`,
    "classic-walnut": `${VISUALIZER_BASE}/coffins/classic-walnut.webp`,
    "classic-mahogany": `${VISUALIZER_BASE}/coffins/classic-mahogany.webp`,
    "classic-black": `${VISUALIZER_BASE}/coffins/classic-black.webp`,
    "classic-white": `${VISUALIZER_BASE}/coffins/classic-white.webp`,
    "simple-dark": `${VISUALIZER_BASE}/coffins/simple-dark.webp`,
  } as AssetMap,
  upholstery: {
    "white-satin": `${VISUALIZER_BASE}/upholstery/white-satin.webp`,
    "cream-satin": `${VISUALIZER_BASE}/upholstery/cream-satin.webp`,
    "white-gold-trim": `${VISUALIZER_BASE}/upholstery/white-gold-trim.webp`,
    "burgundy-velvet": `${VISUALIZER_BASE}/upholstery/burgundy-velvet.webp`,
  } as AssetMap,
  wreaths: {
    "orthodox-oval-white-green": `${VISUALIZER_BASE}/wreaths/orthodox-oval-white-green.webp`,
    "orthodox-oval-red-white": `${VISUALIZER_BASE}/wreaths/orthodox-oval-red-white.webp`,
    "orthodox-oval-burgundy-green": `${VISUALIZER_BASE}/wreaths/orthodox-oval-burgundy-green.webp`,
    "orthodox-teardrop-burgundy": `${VISUALIZER_BASE}/wreaths/orthodox-teardrop-burgundy.webp`,
  } as AssetMap,
  crosses: {
    "orthodox-six-point": `${VISUALIZER_BASE}/crosses/orthodox-six-point.webp`,
    "orthodox-eight-point": `${VISUALIZER_BASE}/crosses/orthodox-eight-point.webp`,
  } as AssetMap,
  shadows: {
    coffin: `${VISUALIZER_BASE}/shadows/coffin-shadow.webp`,
    wreath: `${VISUALIZER_BASE}/shadows/wreath-shadow.webp`,
    cross: `${VISUALIZER_BASE}/shadows/cross-shadow.webp`,
  } as AssetMap,
} as const;

export type AssetCategory = "coffins" | "upholstery" | "wreaths" | "crosses";

/** Путь к слою по id. Явная запись приоритетна, иначе строим по соглашению. */
export function assetPath(category: AssetCategory, id?: string): string | undefined {
  if (!id) return undefined;
  const map = visualizerAssets[category];
  return map[id] ?? `${VISUALIZER_BASE}/${category}/${id}.webp`;
}

export function shadowPath(kind: "coffin" | "wreath" | "cross"): string {
  return visualizerAssets.shadows[kind];
}
