"use client";

// Публичный компонент визуализации ритуального комплекта.
// API сохранён: { selection, selectedItems, className, compact }.
// Основной режим - интерактивная 3D-сцена (Three.js). Если WebGL недоступен
// или комплект ещё пуст - показываем лёгкий SVG-предпросмотр (graceful fallback).

import { type CSSProperties } from "react";
import { getItem, type AttrSelection } from "@/lib/attributes";
import {
  type AttributePreviewConfig,
  type CasketType,
  type CrossType,
  type PreviewItem,
  type WreathType,
} from "./funeral3d/config";
import RitualSetPreview from "./visualizer/RitualSetPreview";

// ── SVG-палитра (используется только в fallback-предпросмотре) ─────────────
type CasketPalette = { base: string; side: string; top: string; highlight: string };

const CASKET_COLORS: Record<string, CasketPalette> = {
  "синий": { base: "#243a73", side: "#17264f", top: "#334f94", highlight: "#6f85c7" },
  "бордовый": { base: "#6d1f2f", side: "#45111d", top: "#8a2b40", highlight: "#c45a70" },
  "белый": { base: "#e8e1d3", side: "#c9beaa", top: "#f4eee4", highlight: "#ffffff" },
  "чёрный": { base: "#1f1f1f", side: "#111111", top: "#353535", highlight: "#777777" },
  "темный орех": { base: "#5a321f", side: "#321b10", top: "#744229", highlight: "#b47a4d" },
  "тёмный орех": { base: "#5a321f", side: "#321b10", top: "#744229", highlight: "#b47a4d" },
  "светлый орех": { base: "#9a6741", side: "#684125", top: "#b98255", highlight: "#e1b07d" },
  "вишня": { base: "#743024", side: "#431811", top: "#934334", highlight: "#c86d58" },
  "махагон": { base: "#4d1f18", side: "#2b0d09", top: "#6b2a20", highlight: "#b85c48" },
  "груша": { base: "#a9713f", side: "#7c4e26", top: "#c28a55", highlight: "#e6b67e" },
  "светлый": { base: "#9a6741", side: "#684125", top: "#b98255", highlight: "#e1b07d" },
  "тёмный": { base: "#5a321f", side: "#321b10", top: "#744229", highlight: "#b47a4d" },
};

const FALLBACK_COLOR = "бордовый";
const DEFAULT_WOOD_COLOR = "тёмный орех";

function normalizeColor(value?: string) {
  return value?.trim().toLowerCase().replace("черный", "чёрный");
}

function getPalette(color?: string, casketType: CasketType = "fabric") {
  const fallback = casketType === "fabric" ? FALLBACK_COLOR : DEFAULT_WOOD_COLOR;
  return CASKET_COLORS[normalizeColor(color) ?? ""] ?? CASKET_COLORS[fallback];
}

function itemText(item: PreviewItem) {
  return `${item.catalogItemId ?? ""} ${item.name} ${item.category}`.toLowerCase();
}

// ── Деривация доменного конфига из позиций сметы ───────────────────────────
function derivePreviewConfigFromEstimateItems(items: PreviewItem[] = []): AttributePreviewConfig {
  const reversed = [...items].reverse();
  const casket = reversed.find((item) => {
    const text = itemText(item);
    return text.includes("гроб") || text.includes("coffin");
  });
  const wreath = reversed.find((item) => {
    const text = itemText(item);
    return text.includes("венок") || text.includes("корзина цветов") || text.includes("wreath") || text.includes("flower");
  });
  const cross = reversed.find((item) => {
    const text = itemText(item);
    return text.includes("крест") || text.includes("cross");
  });
  const textile = reversed.find((item) => {
    const text = itemText(item);
    return text.includes("покрывал") || text.includes("атлас") || text.includes("бархат") || text.includes("парча");
  });
  const plate = reversed.find((item) => {
    const text = itemText(item);
    return text.includes("таблич") || text.includes("plate");
  });

  let casketType: CasketType | undefined;
  if (casket) {
    const text = itemText(casket);
    casketType = text.includes("ткан") || text.includes("fabric")
      ? "fabric"
      : text.includes("преми") || text.includes("premium")
        ? "premium"
        : "lacquered";
  }

  const wreathText = wreath ? itemText(wreath) : "";
  const wreathType: WreathType | undefined = wreath
    ? wreathText.includes("корзина")
      ? "flowerBasket"
      : wreathText.includes("улучш") || wreathText.includes("premium")
        ? "premium"
        : "standard"
    : undefined;
  const wreathAccent = wreath
    ? wreathText.includes("траур") || wreathText.includes("красн") || wreathText.includes("гвоздик")
      ? "#9e3b32"
      : wreathText.includes("бордов")
        ? "#6e2230"
        : "#efece4"
    : undefined;

  const crossText = cross ? itemText(cross) : "";
  const crossStyle: AttributePreviewConfig["crossStyle"] = cross
    ? crossText.includes("православ")
      ? "carved"
      : crossText.includes("металл")
        ? "metal"
        : "wood"
    : "none";

  return {
    casketType,
    casketColor: casket?.selectedColor,
    hasWreath: Boolean(wreath),
    wreathType,
    wreathAccent,
    hasCross: Boolean(cross),
    crossType: cross ? (crossText.includes("металл") ? "metal" : "wooden") : "none",
    crossStyle,
    textileName: textile?.name,
    hasNamePlate: Boolean(plate),
    summary: {
      casket: casket?.name,
      color: casket?.selectedColor,
      wreath: wreath?.name,
      cross: cross?.name ?? plate?.name,
    },
  };
}

function derivePreviewConfigFromSelection(selection: AttrSelection): AttributePreviewConfig {
  const coffin = getItem(selection.coffin);
  const cross = getItem(selection.cross);
  const textile = getItem(selection.textile);
  const wreaths = (selection.wreaths ?? []).map(getItem).filter(Boolean);
  const casketColor = coffin?.name === "Белый лак" ? "белый" : coffin?.name === "Махагон" ? "махагон" : "тёмный орех";

  return {
    casketType: coffin ? (coffin.name === "Сосна" ? "fabric" : coffin.name === "Махагон" || coffin.name === "Белый лак" ? "premium" : "lacquered") : undefined,
    casketColor,
    hasWreath: wreaths.length > 0,
    wreathType: wreaths.some((wreath) => wreath?.name.includes("Корзина")) ? "flowerBasket" : wreaths.length > 1 ? "premium" : "standard",
    wreathAccent: wreaths[0]?.render.accent,
    hasCross: Boolean(cross),
    crossType: cross?.render.style === "metal" ? "metal" : cross ? "wooden" : "none",
    crossStyle: cross ? (cross.render.style ?? "wood") : "none",
    textileName: textile?.name,
    hasNamePlate: false,
    summary: {
      casket: coffin?.name,
      color: casketColor,
      wreath: wreaths[0]?.name,
      cross: cross?.name,
    },
  };
}

// ── SVG-объекты (fallback) ─────────────────────────────────────────────────
function Cross({ type = "wooden" }: { type?: CrossType }) {
  if (type === "none") return null;
  const metal = type === "metal";
  return (
    <g transform="translate(116 120) rotate(-6)" filter="url(#objectShadow)">
      <ellipse cx="18" cy="210" rx="38" ry="10" fill="#2a211733" filter="url(#softBlur)" />
      <linearGradient id="crossWood" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={metal ? "#d9dde4" : "#8f6036"} />
        <stop offset="0.55" stopColor={metal ? "#8e96a3" : "#684020"} />
        <stop offset="1" stopColor={metal ? "#f5f2e8" : "#3b210f"} />
      </linearGradient>
      <rect x="8" y="0" width="20" height="206" rx="4" fill="url(#crossWood)" />
      <rect x="-24" y="58" width="84" height="20" rx="4" fill="url(#crossWood)" />
      <rect x="12" y="8" width="4" height="190" rx="2" fill="#ffffff3d" />
      <path d="M -20 61 H 56" stroke="#ffffff42" strokeWidth="2" />
    </g>
  );
}

function Wreath({ type = "standard", x = 502, y = 284, scale = 1 }: { type?: WreathType; x?: number; y?: number; scale?: number }) {
  const leaves = Array.from({ length: type === "premium" ? 26 : 18 });
  const flowers = Array.from({ length: type === "flowerBasket" ? 8 : type === "premium" ? 12 : 7 });
  const radius = type === "flowerBasket" ? 32 : 48;

  if (type === "flowerBasket") {
    return (
      <g transform={`translate(${x - 4} ${y + 20}) scale(${scale})`} filter="url(#objectShadow)">
        <ellipse cx="0" cy="54" rx="66" ry="13" fill="#2a211724" filter="url(#softBlur)" />
        <path d="M -58 12 Q 0 76 58 12 L 46 68 Q 0 96 -46 68 Z" fill="url(#basketGrad)" stroke="#6d4420" strokeWidth="1.2" />
        {flowers.map((_, i) => {
          const px = -38 + i * 11;
          const py = 12 - Math.sin(i) * 9;
          return <circle key={i} cx={px} cy={py} r={8} fill={i % 2 ? "#f1eee4" : "#b84f5d"} stroke="#00000014" />;
        })}
        <path d="M -44 16 Q 0 -34 44 16" fill="none" stroke="#7a5230" strokeWidth="5" strokeLinecap="round" />
      </g>
    );
  }

  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} filter="url(#objectShadow)">
      <ellipse cx="0" cy={radius + 22} rx={radius * 1.04} ry="12" fill="#2a211724" filter="url(#softBlur)" />
      <circle cx="0" cy="0" r={radius} fill="none" stroke="#243d2a" strokeWidth="18" opacity="0.94" />
      <circle cx="0" cy="0" r={radius - 2} fill="none" stroke="#4f7449" strokeWidth="9" opacity="0.88" />
      {leaves.map((_, i) => {
        const a = (i / leaves.length) * Math.PI * 2;
        const px = Math.cos(a) * radius;
        const py = Math.sin(a) * radius;
        return (
          <ellipse
            key={i}
            cx={px}
            cy={py}
            rx="5.2"
            ry="11"
            fill={i % 2 ? "#5e8356" : "#314f35"}
            transform={`rotate(${(a * 180) / Math.PI + 22} ${px} ${py})`}
            opacity="0.92"
          />
        );
      })}
      {flowers.map((_, i) => {
        const a = (i / flowers.length) * Math.PI * 2 + 0.15;
        return <circle key={i} cx={Math.cos(a) * radius} cy={Math.sin(a) * radius} r={type === "premium" ? 5.6 : 4.5} fill={i % 2 ? "#f2eee6" : "#9e3b32"} stroke="#00000012" />;
      })}
      <path d={`M -8 ${radius - 2} L -18 ${radius + 38} L -3 ${radius + 28} L 11 ${radius + 38} L 6 ${radius - 2} Z`} fill="#efe8d8" opacity="0.95" stroke="#00000014" />
    </g>
  );
}

function NamePlate() {
  return (
    <g transform="translate(360 184) skewY(5)" filter="url(#smallShadow)">
      <rect x="-35" y="-10" width="70" height="20" rx="4" fill="url(#goldGrad)" stroke="#7e642c" strokeWidth="0.8" />
      <path d="M -24 -2 H 24" stroke="#5b4722" strokeWidth="1.2" opacity="0.5" />
      <path d="M -18 4 H 18" stroke="#5b4722" strokeWidth="1.1" opacity="0.35" />
    </g>
  );
}

function Casket({ config, muted = false }: { config: AttributePreviewConfig; muted?: boolean }) {
  const type = config.casketType ?? "fabric";
  const palette = muted ? { base: "#b9afa0", side: "#8d8273", top: "#d4c9ba", highlight: "#f4eee4" } : getPalette(config.casketColor, type);
  const glossy = type !== "fabric";
  const premium = type === "premium";

  return (
    <g className="preview-casket" filter="url(#objectShadow)">
      <ellipse cx="333" cy="328" rx="194" ry="31" fill="#1d17102b" filter="url(#softBlur)" />
      <path d="M 150 225 L 234 174 L 500 208 L 500 260 L 236 316 L 150 272 Z" fill={palette.side} stroke="#241a122e" strokeWidth="1.4" />
      <path d="M 150 225 L 234 174 L 500 208 L 414 256 L 151 272 Z" fill="url(#topMaterial)" stroke="#ffffff24" strokeWidth="1.1" />
      <path d="M 151 272 L 414 256 L 500 208 L 500 260 L 236 316 Z" fill="url(#sideMaterial)" opacity="0.96" />
      <path d="M 181 229 L 242 190 L 466 216 L 410 246 L 184 260 Z" fill="none" stroke={glossy ? "#ffffff75" : "#ffffff30"} strokeWidth={glossy ? 2.2 : 1.2} />
      <path d="M 199 235 C 286 211 374 217 455 224" fill="none" stroke={palette.highlight} strokeWidth={glossy ? 5 : 2.2} opacity={glossy ? 0.42 : 0.18} strokeLinecap="round" />
      <path d="M 208 252 C 286 237 366 239 430 246" fill="none" stroke="#0000002b" strokeWidth="1.4" opacity="0.35" />
      {type === "fabric" && (
        <g opacity="0.26" clipPath="url(#casketClip)">
          {Array.from({ length: 12 }).map((_, i) => (
            <path key={i} d={`M ${156 + i * 27} 209 L ${204 + i * 27} 285`} stroke="#ffffff" strokeWidth="0.9" />
          ))}
          {Array.from({ length: 7 }).map((_, i) => (
            <path key={i} d={`M 166 ${228 + i * 7} C 250 ${205 + i * 7} 380 ${214 + i * 7} 486 ${230 + i * 7}`} stroke="#000000" strokeWidth="0.7" opacity="0.45" />
          ))}
        </g>
      )}
      {premium && (
        <>
          <path d="M 178 270 L 411 255 L 488 212" fill="none" stroke="url(#goldGrad)" strokeWidth="3" opacity="0.88" />
          <path d="M 202 226 C 290 198 392 206 460 218" fill="none" stroke="#ffffff" strokeWidth="2.4" opacity="0.38" strokeLinecap="round" />
        </>
      )}
      <g fill="url(#metalGrad)" stroke="#5f4c29" strokeWidth="0.7">
        {[224, 316, 407].map((x, i) => (
          <g key={x} transform={`translate(${x} ${i === 0 ? 278 : i === 1 ? 272 : 264}) rotate(-4)`}>
            <rect x="-18" y="-5" width="36" height="10" rx="5" />
            <rect x="-13" y="-2" width="26" height="4" rx="2" fill="#fff4bd70" stroke="none" />
          </g>
        ))}
        {premium && [190, 476].map((x) => <circle key={x} cx={x} cy={x === 190 ? 252 : 232} r="6" fill="url(#goldGrad)" />)}
      </g>
      {config.hasNamePlate && <NamePlate />}
    </g>
  );
}

function SvgPreview({
  config,
  hasSelectedVisual,
  mutedCasket,
  selectedItems,
  compact,
}: {
  config: AttributePreviewConfig;
  hasSelectedVisual: boolean;
  mutedCasket: boolean;
  selectedItems?: PreviewItem[];
  compact: boolean;
}) {
  const palette = getPalette(config.casketColor, config.casketType);
  return (
    <svg
      viewBox="0 0 640 420"
      style={{ display: "block", width: "100%", height: "100%" }}
      role="img"
      aria-label="Предпросмотр комплекта ритуальной атрибутики"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="previewBg" cx="38%" cy="22%" r="74%">
          <stop offset="0" stopColor="#fff9ed" />
          <stop offset="0.58" stopColor="#efe5d4" />
          <stop offset="1" stopColor="#d8ccb8" />
        </radialGradient>
        <linearGradient id="topMaterial" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette.top} />
          <stop offset="0.5" stopColor={palette.base} />
          <stop offset="1" stopColor={palette.side} />
        </linearGradient>
        <linearGradient id="sideMaterial" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor={palette.base} />
          <stop offset="1" stopColor={palette.side} />
        </linearGradient>
        <linearGradient id="metalGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0ae" />
          <stop offset="0.5" stopColor="#b79143" />
          <stop offset="1" stopColor="#6d5528" />
        </linearGradient>
        <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f5df98" />
          <stop offset="0.55" stopColor="#b99445" />
          <stop offset="1" stopColor="#6f5624" />
        </linearGradient>
        <linearGradient id="basketGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b98255" />
          <stop offset="1" stopColor="#684125" />
        </linearGradient>
        <filter id="softBlur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <filter id="objectShadow" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="14" stdDeviation="10" floodColor="#2f2519" floodOpacity="0.25" />
        </filter>
        <filter id="smallShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#2f2519" floodOpacity="0.22" />
        </filter>
        <clipPath id="casketClip">
          <path d="M 150 225 L 234 174 L 500 208 L 414 256 L 151 272 Z" />
        </clipPath>
      </defs>

      <style>{`.preview-casket, .preview-accessory { transition: opacity 180ms ease, transform 220ms ease; transform-origin: center; }`}</style>

      <rect x="0" y="0" width="640" height="420" rx="28" fill="url(#previewBg)" />
      <path d="M 88 329 C 174 292 444 290 561 331 C 482 389 185 390 88 329 Z" fill="#fff8eb70" />
      <ellipse cx="338" cy="342" rx="242" ry="36" fill="#2a21171c" filter="url(#softBlur)" />

      {!hasSelectedVisual && selectedItems && (
        <g>
          <Casket config={{ summary: {} }} muted />
          <rect x="170" y="62" width="300" height="68" rx="18" fill="#fff9efcc" stroke="#d9ccb8" />
          <text x="320" y="90" textAnchor="middle" fill="#675d50" fontSize="15" fontWeight="700">Предпросмотр комплекта</text>
          <text x="320" y="113" textAnchor="middle" fill="#756a59" fontSize="12">Добавьте гроб или атрибутику из каталога</text>
        </g>
      )}

      {(hasSelectedVisual || !selectedItems) && <Casket config={config} muted={mutedCasket} />}
      {config.hasCross && <g className="preview-accessory"><Cross type={config.crossType} /></g>}
      {config.hasWreath && <g className="preview-accessory"><Wreath type={config.wreathType} x={502} y={284} scale={compact ? 0.86 : 1} /></g>}

      <g opacity="0.72">
        <circle cx="115" cy="74" r="56" fill="#ffffff5c" filter="url(#softBlur)" />
        <path d="M 520 85 C 565 119 586 165 588 220" fill="none" stroke="#ffffff55" strokeWidth="22" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// ── Маппинг доменного конфига → id слоёв 2.5D-визуализатора ─────────────────
function lc(s?: string) {
  return (s ?? "").toLowerCase();
}

function previewIdsFromConfig(c: AttributePreviewConfig) {
  const col = lc(c.casketColor);
  const wood = col.includes("бел")
    ? "white"
    : col.includes("чёрн") || col.includes("черн")
      ? "black"
      : col.includes("махагон") || col.includes("вишн")
        ? "mahogany"
        : col.includes("светл") || col.includes("сосн")
          ? "walnut"
          : "dark-oak";
  const tx = lc(c.textileName);
  const upholsteryId = tx.includes("бархат")
    ? "burgundy-velvet"
    : tx.includes("парча")
      ? "white-gold-trim"
      : tx.includes("крем")
        ? "cream-satin"
        : "white-satin";
  const acc = lc(c.wreathAccent);
  const wcol =
    acc.includes("9e3b32") || acc.includes("красн") || acc.startsWith("#a")
      ? "red-white"
      : acc.includes("6e22") || acc.includes("бордов")
        ? "burgundy-green"
        : "white-green";
  return {
    coffinId: `classic-${wood}`,
    upholsteryId,
    wreathId: `orthodox-oval-${wcol}`,
    crossId: c.crossStyle === "carved" ? "orthodox-eight-point" : "orthodox-six-point",
  };
}

// ── Публичный компонент ────────────────────────────────────────────────────
export default function AttributeRender({
  selection,
  selectedItems,
  className,
  compact = false,
}: {
  selection: AttrSelection;
  selectedItems?: PreviewItem[];
  className?: string;
  compact?: boolean;
}) {
  const config = selectedItems ? derivePreviewConfigFromEstimateItems(selectedItems) : derivePreviewConfigFromSelection(selection);
  const hasSelectedVisual = Boolean(config.casketType || config.hasWreath || config.hasCross || config.hasNamePlate);
  const mutedCasket = !config.casketType && hasSelectedVisual;
  const emptyState = !hasSelectedVisual && Boolean(selectedItems);

  const wrapperStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: compact ? "3 / 2" : "64 / 42",
    overflow: "hidden",
    borderRadius: 12,
  };

  const svgFallback = (
    <SvgPreview
      config={config}
      hasSelectedVisual={hasSelectedVisual}
      mutedCasket={mutedCasket}
      selectedItems={selectedItems}
      compact={compact}
    />
  );

  const ids = previewIdsFromConfig(config);

  return (
    <div className={className} style={wrapperStyle}>
      {emptyState ? (
        svgFallback
      ) : (
        // 2.5D-слои из реальных фото каталога; нет ассета → fallback = SVG.
        <RitualSetPreview
          variant="bare"
          coffinId={ids.coffinId}
          upholsteryId={ids.upholsteryId}
          wreathId={ids.wreathId}
          crossId={ids.crossId}
          showWreath={Boolean(config.hasWreath)}
          showCross={Boolean(config.hasCross)}
          fallback={svgFallback}
        />
      )}
    </div>
  );
}
