"use client";

// Процедурные объекты сцены: гроб, обивка, православный венок, православный крест.
// Каждый объект изолирован и параметризован через FuneralVisualizationConfig.
//
// ▸ ЗАМЕНА НА GLB ПОЗЖЕ:
//   Внутри каждого компонента помечено место "GLB SWAP". Чтобы перейти на
//   реальную модель — загрузите её через useGLTF("/models/<name>.glb") и
//   верните <primitive object={scene} />, сохранив position/scale/rotation.
//   Процедурный меш ниже — fallback на время отсутствия моделей.

import { useMemo } from "react";
import * as THREE from "three";
import { Instances, Instance } from "@react-three/drei";
import {
  BRASS,
  UPHOLSTERY_PALETTE,
  WOOD_PALETTE,
  WREATH_PALETTE,
  type CoffinWood,
  type FuneralVisualizationConfig,
} from "./config";

// Детерминированный PRNG (mulberry32) — стабильная текстура без Math.random в render.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WOOD_SEED: Record<CoffinWood, number> = {
  dark_oak: 11, walnut: 23, mahogany: 37, black: 53, white: 71,
};

// ── Текстура дерева (процедурный fallback вместо файла-текстуры) ───────────
function useWoodTexture(wood: CoffinWood) {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const { color, grain } = WOOD_PALETTE[wood];
    const rand = mulberry32(WOOD_SEED[wood]);
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    // вертикальные волокна с лёгким изгибом
    for (let i = 0; i < 70; i++) {
      const x = rand() * size;
      ctx.strokeStyle = grain;
      ctx.globalAlpha = 0.05 + rand() * 0.12;
      ctx.lineWidth = 0.6 + rand() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      const bow = (rand() - 0.5) * 18;
      ctx.bezierCurveTo(x + bow, size * 0.33, x - bow, size * 0.66, x + bow * 0.5, size);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [wood]);
}

// ── Геометрия гроба: вытянутый шестигранный (трапециевидный) силуэт ────────
// Половины ширины по длине: голова → плечи (макс) → ноги.
const COFFIN = {
  length: 2.05,
  bodyHeight: 0.42,
  hwHead: 0.21,
  hwShoulder: 0.33,
  hwFeet: 0.17,
  shoulderZ: -0.52, // смещение плеч от центра по длине
};

function coffinFootprint(scale = 1): THREE.Shape {
  const { length, hwHead, hwShoulder, hwFeet, shoulderZ } = COFFIN;
  const yHead = -length / 2;
  const yFeet = length / 2;
  const ySh = shoulderZ;
  const hH = hwHead * scale;
  const hS = hwShoulder * scale;
  const hF = hwFeet * scale;
  const s = new THREE.Shape();
  s.moveTo(-hH, yHead);
  s.lineTo(-hS, ySh);
  s.lineTo(-hF, yFeet);
  s.lineTo(hF, yFeet);
  s.lineTo(hS, ySh);
  s.lineTo(hH, yHead);
  s.closePath();
  return s;
}

// Прямой меш стенок гроба (экструзия силуэта по высоте) с фасками.
function useCoffinGeometry() {
  return useMemo(() => {
    const shape = coffinFootprint(1);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: COFFIN.bodyHeight,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
      steps: 1,
    });
    geo.rotateX(-Math.PI / 2); // экструзия (Z) → высота (Y), длина → Z
    geo.computeVertexNormals();
    return geo;
  }, []);
}

// Рамка-борт (внешний контур минус внутренний) — открытый верх гроба.
function useRimGeometry() {
  return useMemo(() => {
    const outer = coffinFootprint(1);
    const inner = coffinFootprint(0.8);
    // отверстие задаётся обратным контуром
    const holePts = inner.getPoints().reverse();
    outer.holes.push(new THREE.Path(holePts));
    const geo = new THREE.ExtrudeGeometry(outer, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 1,
      steps: 1,
    });
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }, []);
}

// Тонкая панель крышки (контур гроба, малой толщины).
function useLidGeometry() {
  return useMemo(() => {
    const shape = coffinFootprint(0.99);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.07,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.015,
      bevelSegments: 1,
      steps: 1,
    });
    geo.rotateX(-Math.PI / 2);
    geo.center();
    geo.computeVertexNormals();
    return geo;
  }, []);
}

// ── Гроб ──────────────────────────────────────────────────────────────────
export function Coffin({ config }: { config: FuneralVisualizationConfig }) {
  const wood = WOOD_PALETTE[config.coffinWood];
  const uph = UPHOLSTERY_PALETTE[config.upholstery];
  const tex = useWoodTexture(config.coffinWood);
  const bodyGeo = useCoffinGeometry();
  const rimGeo = useRimGeometry();
  const lidGeo = useLidGeometry();

  const finish =
    config.coffinFinish === "gloss"
      ? { roughness: Math.max(0.18, wood.roughness - 0.18), clearcoat: 0.85 }
      : config.coffinFinish === "matte"
        ? { roughness: Math.min(0.85, wood.roughness + 0.2), clearcoat: 0.1 }
        : { roughness: wood.roughness, clearcoat: wood.clearcoat };

  // позиции ручек вдоль длинных сторон
  const handleZ = [-0.55, 0, 0.55];

  return (
    <group>
      {/* ▸ GLB SWAP: корпус гроба → useGLTF("/models/coffin.glb") */}
      <mesh geometry={bodyGeo} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={wood.color}
          map={tex ?? undefined}
          roughness={finish.roughness}
          clearcoat={finish.clearcoat}
          clearcoatRoughness={0.35}
          metalness={0}
          envMapIntensity={0.8}
        />
      </mesh>

      {/* Борт по периметру открытого верха */}
      <mesh geometry={rimGeo} position={[0, COFFIN.bodyHeight - 0.02, 0]} castShadow>
        <meshPhysicalMaterial
          color={wood.color}
          map={tex ?? undefined}
          roughness={finish.roughness}
          clearcoat={finish.clearcoat}
          clearcoatRoughness={0.35}
          envMapIntensity={0.8}
        />
      </mesh>

      {/* Внутренняя обивка + тёмная подкладка для глубины */}
      <Upholstery config={config} />
      <InnerLining color={uph.color} />

      {/* Ручки (приглушённая латунь) */}
      {handleZ.map((z) =>
        [-1, 1].map((side) => (
          <group key={`${z}-${side}`} position={[side * 0.345, COFFIN.bodyHeight * 0.46, z]}>
            <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
              <capsuleGeometry args={[0.022, 0.22, 4, 8]} />
              <meshStandardMaterial color={BRASS.color} roughness={BRASS.roughness} metalness={BRASS.metalness} />
            </mesh>
          </group>
        )),
      )}

      {/* Крышка, прислонённая вертикально позади-слева — интерьер открыт */}
      <group position={[-0.95, 0, -0.15]} rotation={[Math.PI / 2 - 0.18, 0, Math.PI / 2]}>
        {/* ▸ GLB SWAP: крышка → отдельный mesh из coffin.glb */}
        <mesh geometry={lidGeo} position={[0, 1.02, 0]} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={wood.color}
            map={tex ?? undefined}
            roughness={finish.roughness}
            clearcoat={finish.clearcoat}
            clearcoatRoughness={0.35}
            envMapIntensity={0.8}
          />
        </mesh>
        {/* мягкая обивка на внутренней стороне крышки */}
        <mesh geometry={lidGeo} position={[0, 1.02, 0.05]} scale={[0.82, 0.86, 0.4]}>
          <meshPhysicalMaterial color={uph.color} roughness={uph.roughness} sheen={uph.sheen} sheenColor={uph.sheenColor} />
        </mesh>
      </group>
    </group>
  );
}

// тонкая тёмная подкладка внутреннего контура (видна как глубина гроба)
function InnerLining({ color }: { color: string }) {
  const geo = useMemo(() => {
    const outer = coffinFootprint(0.8);
    const inner = coffinFootprint(0.7);
    outer.holes.push(new THREE.Path(inner.getPoints().reverse()));
    const g = new THREE.ExtrudeGeometry(outer, { depth: 0.14, bevelEnabled: false, steps: 1 });
    g.rotateX(-Math.PI / 2);
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} position={[0, COFFIN.bodyHeight - 0.16, 0]}>
      <meshStandardMaterial color={color} roughness={0.8} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Обивка: подушка + изголовье + сложенное покрывало ──────────────────────
export function Upholstery({ config }: { config: FuneralVisualizationConfig }) {
  const uph = UPHOLSTERY_PALETTE[config.upholstery];
  const y = COFFIN.bodyHeight - 0.14;

  const satin = (
    <meshPhysicalMaterial
      color={uph.color}
      roughness={uph.roughness}
      sheen={uph.sheen}
      sheenRoughness={0.5}
      sheenColor={uph.sheenColor}
      clearcoat={0.12}
      envMapIntensity={0.6}
    />
  );

  // лёгкие складки: несколько чуть приподнятых валиков вдоль длины
  const folds = useMemo(() => Array.from({ length: 5 }, (_, i) => -0.7 + i * 0.34), []);

  return (
    <group>
      {/* основной матрас */}
      <mesh position={[0, y, 0.1]} receiveShadow>
        <boxGeometry args={[0.5, 0.07, 1.6]} />
        {satin}
      </mesh>
      {/* валики-складки */}
      {folds.map((z) => (
        <mesh key={z} position={[0, y + 0.045, z]} rotation={[0, 0, Math.PI / 2]}>
          <capsuleGeometry args={[0.028, 0.42, 3, 8]} />
          {satin}
        </mesh>
      ))}
      {/* изголовье-подушка */}
      <mesh position={[0, y + 0.07, -0.72]} receiveShadow>
        <boxGeometry args={[0.34, 0.12, 0.26]} />
        {satin}
      </mesh>
      {/* аккуратно сложенное покрывало у ног */}
      <mesh position={[0, y + 0.05, 0.62]} rotation={[0.12, 0, 0]}>
        <boxGeometry args={[0.46, 0.06, 0.34]} />
        {satin}
      </mesh>
    </group>
  );
}

// ── Православный венок: вертикальный овал на подставке ─────────────────────
export function OrthodoxWreath({ config, position }: { config: FuneralVisualizationConfig; position: [number, number, number] }) {
  const pal = WREATH_PALETTE[config.wreathColor];

  // точки по овалу для цветов/листвы
  const points = useMemo(() => {
    const rx = 0.42;
    const ry = 0.62;
    const n = 30;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * rx, Math.sin(a) * ry, 0);
    });
  }, []);

  // Плотная цветочная композиция: два кольца бутонов (внешнее + чуть утопленное),
  // чередование белого/кремового и акцентного цвета. Детерминированно.
  const flowers = useMemo(() => {
    const list: { pos: [number, number, number]; color: string; s: number }[] = [];
    points.forEach((p, i) => {
      list.push({ pos: [p.x * 1.05, p.y * 1.05, 0.09], color: i % 4 === 0 ? pal.flowerB : pal.flowerA, s: 0.075 });
      list.push({ pos: [p.x * 0.88, p.y * 0.88, 0.05], color: i % 3 === 0 ? pal.flowerB : pal.flowerA, s: 0.058 });
    });
    return list;
  }, [points, pal]);

  return (
    // ▸ GLB SWAP: венок → useGLTF("/models/wreath.glb"); сохранить вертикальную ориентацию и масштаб
    <group position={position} rotation={[0.12, -0.3, 0]}>
      {/* подставка-стойка */}
      <mesh position={[0, 0.02, 0.04]} castShadow>
        <cylinderGeometry args={[0.26, 0.3, 0.04, 24]} />
        <meshStandardMaterial color="#3a2c1d" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.5, 0.07]} rotation={[0.16, 0, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.03, 1.0, 12]} />
        <meshStandardMaterial color="#4a3826" roughness={0.6} />
      </mesh>

      {/* сам венок поднят над полом, овальная форма */}
      <group position={[0, 1.0, 0]}>
        {/* зелёная основа (хвоя) */}
        <mesh castShadow>
          <torusGeometry args={[0.52, 0.1, 14, 48]} />
          <meshStandardMaterial color={pal.foliage} roughness={0.85} />
        </mesh>
        <mesh scale={[1, 1, 1]}>
          <torusGeometry args={[0.52, 0.07, 12, 40]} />
          <meshStandardMaterial color={pal.foliageDark} roughness={0.9} />
        </mesh>

        {/* листва — инстансы тёмных эллипсоидов */}
        <Instances limit={points.length} castShadow>
          <sphereGeometry args={[0.06, 6, 5]} />
          <meshStandardMaterial color={pal.foliageDark} roughness={0.9} />
          {points.map((p, i) => (
            <Instance key={`l${i}`} position={[p.x, p.y, (i % 3) * 0.02 - 0.02]} scale={[0.7, 1.5, 0.7]} />
          ))}
        </Instances>

        {/* цветы — плотные бутоны в два кольца */}
        <Instances limit={flowers.length} castShadow>
          <sphereGeometry args={[1, 8, 7]} />
          <meshStandardMaterial roughness={0.5} />
          {flowers.map((f, i) => (
            <Instance key={`f${i}`} position={f.pos} scale={f.s} color={f.color} />
          ))}
        </Instances>

        {/* траурная лента снизу */}
        <mesh position={[0.04, -0.62, 0.05]} rotation={[0, 0, -0.2]}>
          <boxGeometry args={[0.1, 0.5, 0.012]} />
          <meshStandardMaterial color={pal.flowerB} roughness={0.6} />
        </mesh>
      </group>
    </group>
  );
}

// ── Православный крест: 6- или 8-конечный ──────────────────────────────────
export function OrthodoxCross({ config, position }: { config: FuneralVisualizationConfig; position: [number, number, number] }) {
  const tex = useWoodTexture("walnut");
  const isMetal = config.crossMaterial === "metal";

  const material = isMetal ? (
    <meshStandardMaterial color="#9aa0a8" roughness={0.35} metalness={0.9} envMapIntensity={1} />
  ) : (
    <meshPhysicalMaterial color="#5e4126" map={tex ?? undefined} roughness={0.6} clearcoat={0.1} />
  );

  const beamW = 0.1;
  const beamD = 0.08;
  const totalH = 1.7;

  return (
    // ▸ GLB SWAP: крест → useGLTF("/models/cross.glb"); сохранить тип (6/8) и масштаб
    <group position={position} rotation={[0, -0.25, 0]}>
      {/* небольшое основание */}
      <mesh position={[0, 0.04, 0]} castShadow>
        <boxGeometry args={[0.26, 0.08, 0.2]} />
        <meshStandardMaterial color="#3a2c1d" roughness={0.75} />
      </mesh>

      {/* вертикальная балка */}
      <mesh position={[0, totalH / 2 + 0.06, 0]} castShadow receiveShadow>
        <boxGeometry args={[beamW, totalH, beamD]} />
        {material}
      </mesh>

      {/* верхняя короткая перекладина (титло) — только для 8-конечного */}
      {config.crossPoints === 8 && (
        <mesh position={[0, totalH * 0.86 + 0.06, 0.005]} castShadow>
          <boxGeometry args={[0.34, beamW * 0.8, beamD]} />
          {material}
        </mesh>
      )}

      {/* средняя длинная перекладина */}
      <mesh position={[0, totalH * 0.62 + 0.06, 0.005]} castShadow>
        <boxGeometry args={[0.72, beamW, beamD]} />
        {material}
      </mesh>

      {/* нижняя косая перекладина (подножие) */}
      <mesh position={[0, totalH * 0.34 + 0.06, 0.005]} rotation={[0, 0, 0.32]} castShadow>
        <boxGeometry args={[0.44, beamW * 0.85, beamD]} />
        {material}
      </mesh>
    </group>
  );
}
