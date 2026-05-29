"use client";

// Интерактивная 3D-сцена ритуального конфигуратора.
// Спокойная студийная подача: мягкий свет, контактные тени, ограниченные
// орбитальные контролы. Освещение бейкается локально из Lightformer'ов —
// без сетевых HDRI, чтобы сборка и offline работали стабильно.

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Coffin, OrthodoxCross, OrthodoxWreath } from "./objects";
import type { FuneralVisualizationConfig } from "./config";

function SceneContent({ config }: { config: FuneralVisualizationConfig }) {
  const compact = config.sceneMode === "compact";
  return (
    <group position={[0, -0.35, 0]}>
      <Coffin config={config} />

      {config.wreathEnabled && (
        <OrthodoxWreath config={config} position={[1.45, 0, compact ? 0.05 : 0.15]} />
      )}
      {config.crossEnabled && (
        <OrthodoxCross config={config} position={[1.72, 0, -1.05]} />
      )}

      {/* Мягкая контактная тень — «приземляет» объекты без жёстких теней */}
      <ContactShadows
        position={[0, 0.001, 0]}
        scale={7}
        far={4}
        blur={2.6}
        opacity={0.34}
        color="#2a2117"
        resolution={512}
      />
    </group>
  );
}

export default function FuneralScene({ config }: { config: FuneralVisualizationConfig }) {
  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      frameloop="demand"
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false }}
      camera={{ position: [2.7, 1.75, 3.1], fov: 34 }}
    >
      <Suspense fallback={null}>
        {/* Базовый мягкий свет */}
        <hemisphereLight intensity={0.9} color="#fff6e8" groundColor="#d8cdb6" />
        <directionalLight
          position={[3.5, 5, 4]}
          intensity={1.9}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0004}
        >
          <orthographicCamera attach="shadow-camera" args={[-4, 4, 4, -4, 0.1, 20]} />
        </directionalLight>
        <directionalLight position={[-4, 2.5, -2]} intensity={0.6} color="#e9eefc" />
        <directionalLight position={[0, 1.5, 5]} intensity={0.45} color="#fff3e2" />

        {/* Локальная студийная среда (рефлексы на лаке/латуни), без сети */}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={3.2} position={[2, 4, 3]} scale={[7, 7, 1]} color="#fff3df" />
          <Lightformer form="rect" intensity={1.3} position={[-4, 2, -2]} scale={[5, 5, 1]} color="#dfe6ff" />
          <Lightformer form="ring" intensity={0.9} position={[0, 1, -5]} scale={[3, 3, 1]} color="#ffffff" />
        </Environment>

        <SceneContent config={config} />
      </Suspense>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        target={[0.25, 0.45, 0]}
        minDistance={2.6}
        maxDistance={6}
        minPolarAngle={0.6}
        maxPolarAngle={1.5}
        minAzimuthAngle={-0.85}
        maxAzimuthAngle={0.95}
      />
    </Canvas>
  );
}
