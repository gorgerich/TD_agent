"use client";

// 2.5D layered-визуализатор ритуального комплекта. Без WebGL/Three.js.
// Слои-картинки накладываются в premium-карточке. Нет ассета - graceful
// placeholder, без сломанных img.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ImageSquare, ArrowsOut, X } from "@phosphor-icons/react";
import { assetPath, shadowPath, visualizerAssets } from "./visualizerAssets";
import {
  SCENE_EASEL_ANCHORS,
  DEFAULT_EASEL_ANCHORS,
  WREATH_CENTER_Y,
  WREATH_HEIGHT,
  WREATH_TILT_X,
  WREATH_TILT_Y,
  WREATH_PERSPECTIVE,
  WREATH_GRADE_FILTER,
} from "./sceneAnchors";

export type RitualSetSummary = {
  coffin?: string;
  upholstery?: string;
  wreath?: string;
  cross?: string;
};

export type RitualSetPreviewProps = {
  coffinId: string;
  woodColorId?: string; // зарезервировано (часть coffinId), для будущего раздельного слоя
  upholsteryId: string;
  wreathId?: string;
  wreathIds?: string[]; // до двух венков: [0] — левый мольберт, [1] — правый
  crossId?: string;
  showWreath: boolean;
  showCross: boolean;
  summary?: RitualSetSummary;
  title?: string;
  fallback?: ReactNode;
  enableZoom?: boolean;
  // "card" - premium-карточка с подписью (по умолчанию).
  // "bare" - заполнить родителя без рамки/фона (для тёмной сцены конфигуратора).
  variant?: "card" | "bare";
  className?: string;
};

// ── Один слой: fade + лёгкий scale/blur при загрузке, скрытие при ошибке ───
function LayerImg({ src, z, alt }: { src?: string; z: number; alt: string }) {
  const [state, setState] = useState<"load" | "ok" | "err">("load");
  if (!src || state === "err") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      onLoad={() => setState("ok")}
      onError={() => setState("err")}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
        zIndex: z,
        opacity: state === "ok" ? 1 : 0,
        transform: state === "ok" ? "scale(1)" : "scale(1.03)",
        filter: state === "ok" ? "blur(0)" : "blur(8px)",
        transition: "opacity 0.35s ease, transform 0.35s ease, filter 0.35s ease",
        pointerEvents: "none",
      }}
    />
  );
}

function LayerStack({
  coffinSrc,
  upholsterySrc,
  wreathSrc,
  crossSrc,
  onCoffinError,
}: {
  coffinSrc?: string;
  upholsterySrc?: string;
  wreathSrc?: string;
  crossSrc?: string;
  onCoffinError: () => void;
}) {
  return (
    <>
      {/* фон */}
      <LayerImg src={visualizerAssets.background} z={0} alt="" />
      {/* тени */}
      <LayerImg src={shadowPath("coffin")} z={1} alt="" />
      {crossSrc && <LayerImg src={shadowPath("cross")} z={2} alt="" />}
      {wreathSrc && <LayerImg src={shadowPath("wreath")} z={3} alt="" />}
      {/* объекты */}
      {crossSrc && <LayerImg src={crossSrc} z={4} alt="Православный крест" />}
      {/* coffin отдельно - его ошибка переключает на placeholder */}
      <CoffinLayer src={coffinSrc} onError={onCoffinError} />
      <LayerImg src={upholsterySrc} z={6} alt="Обивка" />
      {wreathSrc && <LayerImg src={wreathSrc} z={7} alt="Православный венок" />}
    </>
  );
}

function CoffinLayer({ src, onError }: { src?: string; onError: () => void }) {
  const [state, setState] = useState<"load" | "ok" | "err">("load");
  if (!src) return null;
  if (state === "err") return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="Гроб"
      loading="lazy"
      draggable={false}
      onLoad={() => setState("ok")}
      onError={() => {
        setState("err");
        onError();
      }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
        zIndex: 5,
        opacity: state === "ok" ? 1 : 0,
        transform: state === "ok" ? "scale(1)" : "scale(1.03)",
        filter: state === "ok" ? "blur(0)" : "blur(8px)",
        transition: "opacity 0.35s ease, transform 0.35s ease, filter 0.35s ease",
        pointerEvents: "none",
      }}
    />
  );
}

function Placeholder({ node, onDark = false }: { node?: ReactNode; onDark?: boolean }) {
  if (node) return <>{node}</>;
  return (
    <div className="absolute inset-0 grid place-items-center px-6 text-center">
      <div>
        <ImageSquare size={34} weight="duotone" className={`mx-auto mb-3 ${onDark ? "text-white/40" : "text-ink-3"}`} />
        <p className={`text-[13px] font-semibold ${onDark ? "text-white/80" : "text-ink-2"}`}>Визуализация комплекта</p>
        <p className={`mt-1 text-[12px] ${onDark ? "text-white/45" : "text-ink-3"}`}>Изображения подбираются по вашему выбору</p>
      </div>
    </div>
  );
}

function SummaryRows({ summary }: { summary?: RitualSetSummary }) {
  if (!summary) return null;
  const rows: [string, string | undefined][] = [
    ["Гроб", summary.coffin],
    ["Обивка", summary.upholstery],
    ["Венок", summary.wreath],
    ["Крест", summary.cross],
  ];
  const visible = rows.filter(([, v]) => v);
  if (visible.length === 0) return null;
  return (
    <dl className="mt-3 grid gap-1.5">
      {visible.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[12px]">
          <dt className="min-w-[64px] flex-shrink-0 font-medium text-ink-3">{k}:</dt>
          <dd className="text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Фон сцены: двойной буфер + кроссфейд ────────────────────────────────────
// При смене гроба старый кадр остаётся на месте, новый проявляется поверх после
// загрузки — без «моргания» пустым фоном. До первого кадра — тёмный шиммер.
function SceneBackdrop({ src, onError }: { src: string; onError: () => void }) {
  // shown — последний полностью показанный кадр (подложка).
  const [shown, setShown] = useState<string | null>(null);
  const [incomingOk, setIncomingOk] = useState(false);
  // Сброс готовности нового кадра при смене src — корректировка во время рендера.
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setIncomingOk(false);
  }
  const incoming = shown === src ? null : src;

  const imgStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    pointerEvents: "none",
  };
  return (
    <>
      {!shown && (
        <>
          <style>{`@keyframes tdSceneShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
          <div
            aria-hidden
            style={{
              ...imgStyle,
              zIndex: 0,
              background:
                "linear-gradient(115deg, rgba(255,255,255,0.04) 30%, rgba(255,255,255,0.11) 50%, rgba(255,255,255,0.04) 70%)",
              backgroundSize: "200% 100%",
              animation: "tdSceneShimmer 1.4s ease infinite",
            }}
          />
        </>
      )}
      {shown && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shown} alt="" aria-hidden draggable={false} style={{ ...imgStyle, zIndex: 0 }} />
      )}
      {incoming && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={incoming}
          alt="Сцена ритуального комплекта"
          draggable={false}
          onLoad={() => setIncomingOk(true)}
          onError={onError}
          onTransitionEnd={() => setShown(incoming)}
          style={{
            ...imgStyle,
            zIndex: 1,
            opacity: incomingOk ? 1 : 0,
            transition: "opacity 0.45s ease",
          }}
        />
      )}
    </>
  );
}

// ── Венок на мольберте ──────────────────────────────────────────────────────
// Вариант C против «наклейки»: лёгкая CSS-перспектива по плоскости мольберта,
// контактная тень на подставке, цветокоррекция под свет зала и мягкая окклюзия
// нижней части венка держателем.
function WreathOnEasel({ src, cx, side }: { src: string; cx: number; side: "left" | "right" }) {
  const [state, setState] = useState<"load" | "ok" | "err">("load");
  // Сброс состояния при смене венка — корректировка во время рендера.
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setState("load");
  }
  if (state === "err") return null;

  const ok = state === "ok";
  const topPct = (WREATH_CENTER_Y - WREATH_HEIGHT / 2) * 100;
  const bottomPct = (WREATH_CENTER_Y + WREATH_HEIGHT / 2) * 100;
  // Мольберты развёрнуты внутрь к камере: у левого ближе правый край, у правого — левый.
  const rotY = side === "left" ? -WREATH_TILT_Y : WREATH_TILT_Y;

  return (
    <>
      {/* Контактная тень на подставке мольберта */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: `${cx * 100}%`,
          top: `${bottomPct - 1.6}%`,
          width: "15%",
          height: "3.2%",
          transform: "translateX(-50%)",
          background: "radial-gradient(closest-side, rgba(24,16,10,0.4), rgba(24,16,10,0) 72%)",
          filter: "blur(3px)",
          opacity: ok ? 1 : 0,
          transition: "opacity 0.4s ease",
          zIndex: 2,
          pointerEvents: "none",
        }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Венок"
        draggable={false}
        onLoad={() => setState("ok")}
        onError={() => setState("err")}
        style={{
          position: "absolute",
          left: `${cx * 100}%`,
          top: `${topPct}%`,
          height: `${WREATH_HEIGHT * 100}%`,
          width: "auto",
          transform:
            `translateX(-50%) perspective(${WREATH_PERSPECTIVE}px) ` +
            `rotateX(${WREATH_TILT_X}deg) rotateY(${rotY}deg) scale(${ok ? 1 : 1.03})`,
          transformOrigin: "50% 88%",
          objectFit: "contain",
          zIndex: 3,
          filter: WREATH_GRADE_FILTER,
          opacity: ok ? 1 : 0,
          transition: "opacity 0.35s ease, transform 0.35s ease",
          pointerEvents: "none",
        }}
      />
      {/* Окклюзия: держатель мольберта затеняет низ венка */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: `${cx * 100}%`,
          top: `${bottomPct - 5.5}%`,
          width: "9%",
          height: "5.5%",
          transform: "translateX(-50%)",
          background: "linear-gradient(to top, rgba(20,13,8,0.34), rgba(20,13,8,0))",
          filter: "blur(2.5px)",
          opacity: ok ? 0.75 : 0,
          transition: "opacity 0.4s ease",
          zIndex: 4,
          pointerEvents: "none",
        }}
      />
    </>
  );
}

// AI-сцена: фотореалистичный кадр зала с выбранным гробом (фон) + до двух венков,
// наложенных по центру мольбертов (левый/правый) по карте якорей сцены. Венок —
// чистый вырез из каталога; садится в держатель мольберта с перспективой, тенью
// и цветокоррекцией под свет зала.
function SceneStage({
  sceneSrc,
  sku,
  wreathSrcs,
  onSceneError,
}: {
  sceneSrc: string;
  sku: string;
  wreathSrcs: string[];
  onSceneError: () => void;
}) {
  const anchors = SCENE_EASEL_ANCHORS[sku] ?? DEFAULT_EASEL_ANCHORS;
  return (
    <>
      <SceneBackdrop src={sceneSrc} onError={onSceneError} />
      {/* [0] → левый мольберт, [1] → правый мольберт */}
      {wreathSrcs[0] && <WreathOnEasel src={wreathSrcs[0]} cx={anchors.left} side="left" />}
      {wreathSrcs[1] && <WreathOnEasel src={wreathSrcs[1]} cx={anchors.right} side="right" />}
    </>
  );
}

export default function RitualSetPreview({
  coffinId,
  upholsteryId,
  wreathId,
  wreathIds,
  crossId,
  showWreath,
  showCross,
  summary,
  title = "Предпросмотр комплекта",
  fallback,
  enableZoom = true,
  variant = "card",
  className,
}: RitualSetPreviewProps) {
  const coffinSrc = assetPath("coffins", coffinId);
  const upholsterySrc = assetPath("upholstery", upholsteryId);
  const wreathSrc = showWreath ? assetPath("wreaths", wreathId) : undefined;
  const crossSrc = showCross ? assetPath("crosses", crossId) : undefined;

  // Сброс ошибки гроба при смене модели - корректировка во время рендера.
  const [coffinErr, setCoffinErr] = useState(false);
  const [prevCoffin, setPrevCoffin] = useState(coffinSrc);
  if (prevCoffin !== coffinSrc) {
    setPrevCoffin(coffinSrc);
    setCoffinErr(false);
  }
  const showStage = Boolean(coffinSrc) && !coffinErr;

  // AI-сцена приоритетнее слоёв: /visualizer/scenes/<coffinId>.jpg.
  const sceneSrc = coffinId ? `/visualizer/scenes/${coffinId}.jpg` : undefined;
  // До двух венков: приоритет wreathIds, иначе одиночный wreathId. [0]→левый, [1]→правый.
  const wreathIdList = (wreathIds && wreathIds.length ? wreathIds : wreathId ? [wreathId] : []).filter(Boolean).slice(0, 2);
  const wreathCutSrcs = showWreath ? wreathIdList.map((id) => `/visualizer/wreaths-cut/${id}.webp`) : [];
  const [sceneErr, setSceneErr] = useState(false);
  const [prevScene, setPrevScene] = useState(sceneSrc);
  if (prevScene !== sceneSrc) {
    setPrevScene(sceneSrc);
    setSceneErr(false);
  }
  const useScene = Boolean(sceneSrc) && !sceneErr;
  const hasStage = useScene || showStage;
  const stageNode = useScene ? (
    <SceneStage sceneSrc={sceneSrc as string} sku={coffinId} wreathSrcs={wreathCutSrcs} onSceneError={() => setSceneErr(true)} />
  ) : showStage ? (
    <LayerStack
      coffinSrc={coffinSrc}
      upholsterySrc={upholsterySrc}
      wreathSrc={wreathSrc}
      crossSrc={crossSrc}
      onCoffinError={() => setCoffinErr(true)}
    />
  ) : null;

  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  // Лайтбокс общий для обоих вариантов (card и bare).
  const lightboxNode = zoom ? (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-ink/70 p-4 backdrop-blur-sm"
      onClick={() => setZoom(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Крупный предпросмотр комплекта"
    >
      <div className="relative w-full max-w-[860px]" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setZoom(false)}
          aria-label="Закрыть"
          className="absolute -top-11 right-0 grid h-9 w-9 place-items-center rounded-full bg-surface/90 text-ink-2 transition-colors hover:text-ink"
        >
          <X size={18} />
        </button>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-b from-surface-2 to-surface shadow-pop">
          {stageNode}
        </div>
      </div>
    </div>
  ) : null;

  if (variant === "bare") {
    return (
      <div className={`absolute inset-0 ${className ?? ""}`}>
        {hasStage ? stageNode : <Placeholder node={fallback} onDark />}
        {enableZoom && hasStage && (
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-[12px] font-medium text-white/85 backdrop-blur transition-colors hover:bg-black/60 hover:text-white"
          >
            <ArrowsOut size={14} /> Крупнее
          </button>
        )}
        {lightboxNode}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-b from-surface-2 to-surface shadow-soft">
        <div className="relative aspect-[4/3] max-h-[58vh] w-full">
          {hasStage ? stageNode : <Placeholder node={fallback} />}
        </div>

        {enableZoom && hasStage && (
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-surface/85 px-3 py-1.5 text-[12px] font-medium text-ink-2 shadow-soft backdrop-blur transition-colors hover:text-ink"
          >
            <ArrowsOut size={14} /> Крупнее
          </button>
        )}
      </div>

      {(title || summary) && (
        <div className="mt-3">
          {title && <p className="text-[12px] font-semibold text-ink">{title}</p>}
          <SummaryRows summary={summary} />
        </div>
      )}

      {/* Lightbox */}
      {lightboxNode}
    </div>
  );
}
