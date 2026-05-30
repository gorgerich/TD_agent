"use client";

// Превью конфигуратора: тёмный студийный фон + стопка слоёв-картинок (фейд).
// Если слой-картинка гроба отсутствует — падаем на интерактивную 3D-сцену,
// чтобы превью никогда не было пустым.

import { useState } from "react";
import FuneralScene from "../funeral3d/FuneralScene";
import { layerPaths, toSceneConfig, type ConfigState } from "./layers";

const STUDIO_BG = "radial-gradient(120% 120% at 50% 38%, #4a4a4d 0%, #313134 45%, #1d1d1f 100%)";

// key={src} в родителе ремонтирует компонент при смене картинки → state сбрасывается без эффекта.
function LayerImg({ src, z, onError }: { src: string; z: number; onError?: () => void }) {
  const [state, setState] = useState<"load" | "ok" | "err">("load");
  if (state === "err") return null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onLoad={() => setState("ok")}
      onError={() => {
        setState("err");
        onError?.();
      }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
        opacity: state === "ok" ? 1 : 0,
        transition: "opacity 0.35s ease",
        zIndex: z,
        pointerEvents: "none",
      }}
    />
  );
}

export default function ConfiguratorScene({ config }: { config: ConfigState }) {
  const { bg, layers } = layerPaths(config);
  const [coffinFailed, setCoffinFailed] = useState(false);
  const [bgOk, setBgOk] = useState(false);

  // Повторная попытка показать картинку гроба при смене модели/дерева —
  // корректировка состояния во время рендера (без эффекта).
  const coffinKey = `${config.coffinModel}_${config.wood}`;
  const [prevCoffinKey, setPrevCoffinKey] = useState(coffinKey);
  if (prevCoffinKey !== coffinKey) {
    setPrevCoffinKey(coffinKey);
    setCoffinFailed(false);
  }

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: STUDIO_BG }}>
      {/* фон-картинка студии (если есть) */}
      <img
        src={bg}
        alt=""
        draggable={false}
        onLoad={() => setBgOk(true)}
        onError={() => setBgOk(false)}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: bgOk ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      />

      {coffinFailed ? (
        // Фолбэк: интерактивная 3D-сцена
        <FuneralScene config={toSceneConfig(config)} />
      ) : (
        layers.map((l) => (
          <LayerImg key={l.src} src={l.src} z={l.z} onError={l.id === "coffin" ? () => setCoffinFailed(true) : undefined} />
        ))
      )}
    </div>
  );
}
