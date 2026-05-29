// Конфигурация 3D-сцены ритуального конфигуратора.
// Здесь — типы, палитры материалов и преобразование из доменного
// AttributePreviewConfig (каталог) в параметры сцены. Сцена и объекты
// зависят только от этого файла, поэтому замена процедурных мешей на GLB
// не требует правок доменной логики.

import type { CatalogCategory } from "@/lib/calculationUtils";

// ── Доменный промежуточный конфиг (раньше жил в AttributeRender) ──────────
export type CasketType = "fabric" | "lacquered" | "premium";
export type WreathType = "standard" | "premium" | "flowerBasket";
export type CrossType = "wooden" | "metal" | "none";

export type AttributePreviewConfig = {
  casketType?: CasketType;
  casketColor?: string;
  hasWreath?: boolean;
  wreathType?: WreathType;
  hasCross?: boolean;
  crossType?: CrossType;
  hasNamePlate?: boolean;
  // «сырые» поля для маппинга в 3D-сцену
  textileName?: string;
  wreathAccent?: string;
  crossStyle?: "wood" | "carved" | "metal" | "none";
  summary: {
    casket?: string;
    color?: string;
    wreath?: string;
    cross?: string;
  };
};

export type PreviewItem = {
  catalogItemId?: string;
  name: string;
  category: CatalogCategory | "Поминки / кафе";
  selectedColor?: string;
};

// ── Параметры 3D-сцены ────────────────────────────────────────────────────
export type CoffinWood = "dark_oak" | "walnut" | "mahogany" | "black" | "white";
export type CoffinFinish = "matte" | "satin" | "gloss";
export type Upholstery = "white_satin" | "cream_satin" | "gold_brocade" | "burgundy_velvet" | "simple_white";
export type WreathColor = "white_green" | "red_white" | "burgundy_green" | "cream";

export type FuneralVisualizationConfig = {
  coffinWood: CoffinWood;
  coffinFinish: CoffinFinish;
  upholstery: Upholstery;
  wreathEnabled: boolean;
  wreathColor: WreathColor;
  crossEnabled: boolean;
  crossPoints: 6 | 8; // православный шести- или восьмиконечный
  crossMaterial: "wood" | "metal";
  sceneMode?: "compact" | "full";
};

// ── Палитры материалов (PBR-параметры) ───────────────────────────────────
export const WOOD_PALETTE: Record<
  CoffinWood,
  { color: string; grain: string; roughness: number; clearcoat: number }
> = {
  dark_oak: { color: "#4a2e1c", grain: "#2f1c10", roughness: 0.5, clearcoat: 0.25 },
  walnut: { color: "#6b4326", grain: "#472a16", roughness: 0.44, clearcoat: 0.32 },
  mahogany: { color: "#5a241a", grain: "#380f0a", roughness: 0.33, clearcoat: 0.55 },
  black: { color: "#1b1714", grain: "#0b0908", roughness: 0.3, clearcoat: 0.5 },
  white: { color: "#e8e1d3", grain: "#cdc4b2", roughness: 0.36, clearcoat: 0.6 },
};

export const UPHOLSTERY_PALETTE: Record<
  Upholstery,
  { color: string; roughness: number; sheen: number; sheenColor: string }
> = {
  white_satin: { color: "#f2efe7", roughness: 0.5, sheen: 1, sheenColor: "#ffffff" },
  cream_satin: { color: "#ece2cd", roughness: 0.52, sheen: 1, sheenColor: "#fff5e0" },
  gold_brocade: { color: "#c7a35a", roughness: 0.56, sheen: 1, sheenColor: "#ffe7a8" },
  burgundy_velvet: { color: "#6e2230", roughness: 0.72, sheen: 1, sheenColor: "#b3636f" },
  simple_white: { color: "#e7e4dd", roughness: 0.66, sheen: 0.45, sheenColor: "#ffffff" },
};

export const WREATH_PALETTE: Record<
  WreathColor,
  { foliage: string; foliageDark: string; flowerA: string; flowerB: string }
> = {
  white_green: { foliage: "#3f5d3a", foliageDark: "#243a23", flowerA: "#f3efe6", flowerB: "#e6ddca" },
  red_white: { foliage: "#33402f", foliageDark: "#1f2c1c", flowerA: "#a32f2a", flowerB: "#f0ece2" },
  burgundy_green: { foliage: "#2f4a31", foliageDark: "#1c321d", flowerA: "#6e1f2e", flowerB: "#e9dfce" },
  cream: { foliage: "#46603f", foliageDark: "#2c4530", flowerA: "#f4efe5", flowerB: "#e2d3b4" },
};

// Приглушённый матовый латунный тон фурнитуры/латуни.
export const BRASS = { color: "#9c7c3d", roughness: 0.42, metalness: 0.85 };

// ── Маппинг доменного конфига → параметры сцены ───────────────────────────
function normalize(value?: string) {
  return (value ?? "").trim().toLowerCase().replace("черный", "чёрный");
}

function woodFromColor(color?: string): CoffinWood {
  const c = normalize(color);
  if (c.includes("бел")) return "white";
  if (c.includes("чёрн")) return "black";
  if (c.includes("махагон") || c.includes("вишн")) return "mahogany";
  if (c.includes("светл") || c.includes("сосн")) return "walnut";
  return "dark_oak"; // тёмный орех / дуб по умолчанию
}

function upholsteryFromName(name?: string): Upholstery {
  const n = normalize(name);
  if (!n) return "cream_satin";
  if (n.includes("атлас")) return "white_satin";
  if (n.includes("бархат")) return "burgundy_velvet";
  if (n.includes("парча")) return "gold_brocade";
  return "cream_satin";
}

function wreathColorFromAccent(accent?: string, type?: WreathType): WreathColor {
  const a = normalize(accent);
  if (type === "flowerBasket") return "cream";
  if (a.startsWith("#9") || a.includes("9e3b32") || a.includes("a32") || a.includes("красн")) return "red_white";
  if (a.includes("6e22") || a.includes("бордов")) return "burgundy_green";
  return "white_green";
}

export function mapToSceneConfig(
  c: AttributePreviewConfig,
  sceneMode?: "compact" | "full",
): FuneralVisualizationConfig {
  return {
    coffinWood: woodFromColor(c.casketColor),
    coffinFinish: c.casketType === "premium" ? "gloss" : c.casketType === "fabric" ? "matte" : "satin",
    upholstery: upholsteryFromName(c.textileName),
    wreathEnabled: Boolean(c.hasWreath),
    wreathColor: wreathColorFromAccent(c.wreathAccent, c.wreathType),
    crossEnabled: Boolean(c.hasCross),
    crossPoints: c.crossStyle === "carved" ? 8 : 6,
    crossMaterial: c.crossStyle === "metal" || c.crossType === "metal" ? "metal" : "wood",
    sceneMode,
  };
}
