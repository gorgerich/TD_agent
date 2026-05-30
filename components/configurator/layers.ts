// Опции конфигуратора, лейблы, цены, резолвер путей слоёв-картинок
// и маппинг в FuneralVisualizationConfig (для 3D-фолбэка).
//
// Слои-картинки кладутся в /public/configurator/ по именам из layerPaths().
// Пока файлов нет — ConfiguratorScene падает на 3D-сцену.

import {
  type CoffinWood,
  type FuneralVisualizationConfig,
  type Upholstery,
  type WreathColor,
} from "../funeral3d/config";

export type CoffinModel = "hex_classic" | "hex_modern" | "rect";
export type UpholsteryMaterial = "satin" | "velvet" | "brocade";
export type UpholsteryColor = "white" | "cream" | "gold";
export type WreathShape = "oval_110" | "oval_140" | "teardrop_120";
export type CrossKind = "ortho_6" | "ortho_8";

export type ConfigState = {
  coffinModel: CoffinModel;
  wood: CoffinWood;
  upholsteryMaterial: UpholsteryMaterial;
  upholsteryColor: UpholsteryColor;
  wreathEnabled: boolean;
  wreathShape: WreathShape;
  wreathColor: WreathColor;
  crossEnabled: boolean;
  crossKind: CrossKind;
};

export const DEFAULT_CONFIG: ConfigState = {
  coffinModel: "hex_classic",
  wood: "dark_oak",
  upholsteryMaterial: "satin",
  upholsteryColor: "white",
  wreathEnabled: true,
  wreathShape: "oval_110",
  wreathColor: "white_green",
  crossEnabled: true,
  crossKind: "ortho_6",
};

// ── Опции с лейблами и свотчами ────────────────────────────────────────────
export type Option<T extends string> = { value: T; label: string; swatch?: string };

export const COFFIN_MODELS: Option<CoffinModel>[] = [
  { value: "hex_classic", label: "Классический шестигранный", swatch: "#5a3a24" },
  { value: "hex_modern", label: "Современный шестигранный", swatch: "#7a4a2a" },
  { value: "rect", label: "Прямой (саркофаг)", swatch: "#3f2a1a" },
];

export const WOODS: Option<CoffinWood>[] = [
  { value: "dark_oak", label: "Тёмный орех", swatch: "#4a2e1c" },
  { value: "walnut", label: "Светлый орех", swatch: "#6b4326" },
  { value: "mahogany", label: "Махагон", swatch: "#5a241a" },
  { value: "black", label: "Чёрный", swatch: "#1b1714" },
  { value: "white", label: "Белый лак", swatch: "#e8e1d3" },
];

export const UPHOLSTERY_MATERIALS: Option<UpholsteryMaterial>[] = [
  { value: "satin", label: "Белый атлас" },
  { value: "velvet", label: "Бархат" },
  { value: "brocade", label: "Парча" },
];

export const UPHOLSTERY_COLORS: Option<UpholsteryColor>[] = [
  { value: "white", label: "Белый", swatch: "#f2efe7" },
  { value: "cream", label: "Кремовый", swatch: "#ece2cd" },
  { value: "gold", label: "Золотистый", swatch: "#cfae66" },
];

export const WREATH_SHAPES: Option<WreathShape>[] = [
  { value: "oval_110", label: "Православный овальный 110 см" },
  { value: "oval_140", label: "Православный овальный 140 см" },
  { value: "teardrop_120", label: "Каплевидный 120 см" },
];

export const WREATH_COLORS: Option<WreathColor>[] = [
  { value: "white_green", label: "Белый и зелёный", swatch: "#dfe9d8" },
  { value: "red_white", label: "Красный и белый", swatch: "#a32f2a" },
  { value: "burgundy_green", label: "Бордовый и зелёный", swatch: "#6e1f2e" },
  { value: "cream", label: "Кремовый", swatch: "#e3d4b6" },
];

export const CROSS_KINDS: Option<CrossKind>[] = [
  { value: "ortho_6", label: "Православный шестиконечный" },
  { value: "ortho_8", label: "Православный восьмиконечный" },
];

// ── Цены (рубли) ───────────────────────────────────────────────────────────
const WOOD_PRICE: Record<CoffinWood, number> = {
  dark_oak: 42000, walnut: 38000, mahogany: 58000, black: 49000, white: 52000,
};
const MODEL_PRICE: Record<CoffinModel, number> = { hex_classic: 0, hex_modern: 6000, rect: -4000 };
const MATERIAL_PRICE: Record<UpholsteryMaterial, number> = { satin: 4500, velvet: 7800, brocade: 9600 };
const WREATH_PRICE: Record<WreathShape, number> = { oval_110: 8400, oval_140: 11800, teardrop_120: 9900 };
const CROSS_PRICE: Record<CrossKind, number> = { ortho_6: 5200, ortho_8: 6800 };

export function totalPrice(c: ConfigState): number {
  let t = WOOD_PRICE[c.wood] + MODEL_PRICE[c.coffinModel] + MATERIAL_PRICE[c.upholsteryMaterial];
  if (c.wreathEnabled) t += WREATH_PRICE[c.wreathShape];
  if (c.crossEnabled) t += CROSS_PRICE[c.crossKind];
  return t;
}

export function formatRub(n: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(n);
}

// ── Резолвер путей слоёв-картинок ──────────────────────────────────────────
const BASE = "/configurator";

export type Layer = { id: string; src: string; z: number };

export function layerPaths(c: ConfigState): { bg: string; layers: Layer[] } {
  const layers: Layer[] = [
    { id: "coffin", src: `${BASE}/coffin_${c.coffinModel}_${c.wood}.png`, z: 10 },
    { id: "interior", src: `${BASE}/interior_${c.upholsteryMaterial}_${c.upholsteryColor}.png`, z: 20 },
  ];
  if (c.crossEnabled) layers.push({ id: "cross", src: `${BASE}/cross_${c.crossKind}.png`, z: 5 });
  if (c.wreathEnabled) layers.push({ id: "wreath", src: `${BASE}/wreath_${c.wreathShape}_${c.wreathColor}.png`, z: 30 });
  return { bg: `${BASE}/bg-studio.jpg`, layers };
}

// ── Маппинг в 3D-конфиг (фолбэк) ───────────────────────────────────────────
export function toSceneConfig(c: ConfigState): FuneralVisualizationConfig {
  const upholstery: Upholstery =
    c.upholsteryMaterial === "velvet"
      ? "burgundy_velvet"
      : c.upholsteryMaterial === "brocade"
        ? "gold_brocade"
        : c.upholsteryColor === "cream"
          ? "cream_satin"
          : "white_satin";

  return {
    coffinWood: c.wood,
    coffinFinish: c.wood === "mahogany" || c.wood === "black" ? "gloss" : "satin",
    upholstery,
    wreathEnabled: c.wreathEnabled,
    wreathColor: c.wreathColor,
    crossEnabled: c.crossEnabled,
    crossPoints: c.crossKind === "ortho_8" ? 8 : 6,
    crossMaterial: "wood",
    sceneMode: "full",
  };
}
