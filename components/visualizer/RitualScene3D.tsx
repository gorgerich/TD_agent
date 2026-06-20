"use client";

// Параметрический 3D-визуализатор ритуального комплекта (гроб + крест + венок).
// Единый свет/ракурс/тени; цвет дерева и цвет венка - параметры материала, поэтому
// любой выбор валиден (в отличие от пофотослойного 2.5D). three грузится динамически
// (нет SSR, типы не нужны - см. three.d.ts). Любая ошибка/нет WebGL -> graceful fallback.

import { useEffect, useRef, type ReactNode } from "react";

const WOOD: Array<[string, number]> = [
  ["махагон", 0x5a2114], ["вишн", 0x6e2a1a], ["тёмный орех", 0x4f2c1a], ["темный орех", 0x4f2c1a],
  ["светлый орех", 0x9a6334], ["орех", 0x8a5a2b], ["дуб", 0x6e4423], ["груша", 0xa9713f],
  ["сосн", 0x9a6741], ["светл", 0x9a6741], ["чёрн", 0x1c1c1c], ["черн", 0x1c1c1c],
  ["бел", 0xe9e3d6], ["тёмн", 0x4f2c1a],
];

function woodHex(name?: string): number {
  const n = (name || "").toLowerCase();
  for (const [k, h] of WOOD) if (n.includes(k)) return h;
  return 0x5a321f;
}

function hexNum(s?: string, dflt = 0xb83341): number {
  if (!s) return dflt;
  const v = parseInt(String(s).replace("#", "").slice(0, 6), 16);
  return Number.isFinite(v) ? v : dflt;
}

export type RitualScene3DProps = {
  woodColor?: string;
  wreathColor?: string;
  showCross?: boolean;
  showWreath?: boolean;
  crossMetal?: boolean;
  autoRotate?: boolean;
  className?: string;
  fallback?: ReactNode;
};

export default function RitualScene3D({
  woodColor,
  wreathColor,
  showCross = true,
  showWreath = true,
  crossMetal = false,
  autoRotate = true,
  className,
  fallback,
}: RitualScene3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const failRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<{ apply: (p: RitualScene3DProps) => void; dispose: () => void } | null>(null);
  const propsRef = useRef<RitualScene3DProps>({});
  propsRef.current = { woodColor, wreathColor, showCross, showWreath, crossMetal, autoRotate };

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const mount = mountRef.current;
    if (!mount) return;

    const showFallback = () => {
      if (failRef.current) failRef.current.style.display = "block";
      if (mount) mount.style.display = "none";
    };

    let cleanup = () => {};

    (async () => {
      let THREE: any;
      try {
        THREE = await import("three");
      } catch {
        if (!disposed) showFallback();
        return;
      }
      if (disposed) return;
      try {
        const w = mount.clientWidth || 480;
        const h = mount.clientHeight || 320;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
        if (THREE.ACESFilmicToneMapping) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
        renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:grab";
        mount.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const bg = document.createElement("canvas");
        bg.width = 16; bg.height = 256;
        const g = bg.getContext("2d") as CanvasRenderingContext2D;
        const grd = g.createLinearGradient(0, 0, 0, 256);
        grd.addColorStop(0, "#f1f3f1"); grd.addColorStop(0.55, "#e7eae7"); grd.addColorStop(1, "#d2d6d2");
        g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
        scene.background = new THREE.CanvasTexture(bg);

        const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x9c9c94, 0.55));
        const key = new THREE.DirectionalLight(0xfff3e4, 1.15);
        key.position.set(4.5, 7.5, 5);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        key.shadow.camera.near = 1; key.shadow.camera.far = 30;
        key.shadow.camera.left = -7; key.shadow.camera.right = 7;
        key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
        key.shadow.bias = -0.0004;
        key.shadow.radius = 7;
        scene.add(key);
        const fill = new THREE.DirectionalLight(0xdfe7ff, 0.32);
        fill.position.set(-5, 3.5, 2);
        scene.add(fill);

        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(60, 60),
          new THREE.MeshStandardMaterial({ color: 0xe9ebe8, roughness: 0.96, metalness: 0 }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        const root = new THREE.Group();
        scene.add(root);

        const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a321f, roughness: 0.42, metalness: 0.06 });
        const trimMat = new THREE.MeshStandardMaterial({ color: 0x2a160f, roughness: 0.5 });
        const goldMat = new THREE.MeshStandardMaterial({ color: 0xc8a24a, roughness: 0.3, metalness: 0.85 });
        const flowerMat = new THREE.MeshStandardMaterial({ color: 0xb83341, roughness: 0.6 });
        const greenMat = new THREE.MeshStandardMaterial({ color: 0x2f5230, roughness: 0.82 });
        const standMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.55, metalness: 0.35 });
        const geos: Array<{ dispose: () => void }> = [];
        const box = (bw: number, bh: number, bd: number, m: unknown, cast = true) => {
          const geo = new THREE.BoxGeometry(bw, bh, bd);
          geos.push(geo);
          const mesh = new THREE.Mesh(geo, m);
          mesh.castShadow = cast; mesh.receiveShadow = true;
          return mesh;
        };

        const coffin = new THREE.Group(); root.add(coffin);
        const pl = box(2.16, 0.12, 0.88, trimMat); pl.position.y = 0.06; coffin.add(pl);
        const body = box(2.0, 0.46, 0.74, woodMat); body.position.y = 0.35; coffin.add(body);
        const l1 = box(2.06, 0.1, 0.8, woodMat); l1.position.y = 0.63; coffin.add(l1);
        const l2 = box(1.5, 0.14, 0.5, woodMat); l2.position.y = 0.75; coffin.add(l2);
        for (const sd of [-1, 1]) for (let i = -1; i <= 1; i++) {
          const hd = box(0.28, 0.05, 0.05, goldMat, false);
          hd.position.set(i * 0.62, 0.34, sd * 0.4);
          coffin.add(hd);
        }

        const cross = new THREE.Group(); root.add(cross);
        const cw = 0.1;
        const vb = box(cw, 2.2, cw, woodMat); vb.position.y = 1.1; cross.add(vb);
        const hb = box(0.8, cw, cw, woodMat); hb.position.y = 1.5; cross.add(hb);
        const tb = box(0.42, cw, cw, woodMat); tb.position.y = 1.86; cross.add(tb);
        const ftb = box(0.5, cw, cw, woodMat); ftb.position.y = 0.98; ftb.rotation.z = Math.PI / 7; cross.add(ftb);
        cross.position.set(-1.95, 0, -0.55); cross.rotation.y = 0.28;

        const wreath = new THREE.Group(); root.add(wreath);
        const ringGeo = new THREE.TorusGeometry(0.62, 0.13, 14, 44); geos.push(ringGeo);
        const ring = new THREE.Mesh(ringGeo, greenMat);
        ring.scale.set(0.82, 1.15, 0.8); ring.castShadow = true; wreath.add(ring);
        const flGeo = new THREE.SphereGeometry(0.1, 10, 10); geos.push(flGeo);
        for (let i = 0; i < 46; i++) {
          const a = (i / 46) * Math.PI * 2;
          const f = new THREE.Mesh(flGeo, flowerMat);
          f.position.set(Math.cos(a) * 0.62 * 0.82, Math.sin(a) * 0.62 * 1.15, ((i % 5) - 2) * 0.03);
          f.castShadow = true; wreath.add(f);
        }
        wreath.position.set(1.75, 0.98, -0.15);
        const legGeo = new THREE.CylinderGeometry(0.018, 0.022, 1.05, 8); geos.push(legGeo);
        const lL = new THREE.Mesh(legGeo, standMat); lL.position.set(1.6, 0.5, -0.02); lL.rotation.z = 0.1; lL.castShadow = true; root.add(lL);
        const lR = new THREE.Mesh(legGeo, standMat); lR.position.set(1.9, 0.5, -0.02); lR.rotation.z = -0.1; lR.castShadow = true; root.add(lR);

        let az = 0.55, pol = 0.3, drag = false, px = 0, py = 0;
        let auto = propsRef.current.autoRotate !== false;
        const updCam = () => {
          const r = 6.0;
          camera.position.set(r * Math.cos(pol) * Math.sin(az), 1.3 + r * Math.sin(pol), r * Math.cos(pol) * Math.cos(az));
          camera.lookAt(0, 0.7, 0);
        };
        const onDown = (e: PointerEvent) => { drag = true; auto = false; px = e.clientX; py = e.clientY; renderer.domElement.style.cursor = "grabbing"; };
        const onUp = () => { drag = false; renderer.domElement.style.cursor = "grab"; };
        const onMove = (e: PointerEvent) => {
          if (!drag) return;
          az -= (e.clientX - px) * 0.008;
          pol = Math.max(0.05, Math.min(0.72, pol + (e.clientY - py) * 0.005));
          px = e.clientX; py = e.clientY;
        };
        renderer.domElement.addEventListener("pointerdown", onDown);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointermove", onMove);

        const ro = new ResizeObserver(() => {
          const cw2 = mount.clientWidth, ch2 = mount.clientHeight;
          if (cw2 && ch2) { renderer.setSize(cw2, ch2, false); camera.aspect = cw2 / ch2; camera.updateProjectionMatrix(); }
        });
        ro.observe(mount);

        const api = {
          apply: (p: RitualScene3DProps) => {
            woodMat.color.setHex(woodHex(p.woodColor));
            woodMat.metalness = woodHex(p.woodColor) === 0xe9e3d6 ? 0 : 0.06;
            flowerMat.color.setHex(hexNum(p.wreathColor));
            cross.visible = p.showCross !== false;
            const wv = p.showWreath !== false;
            wreath.visible = wv; lL.visible = wv; lR.visible = wv;
            const cm = p.crossMetal ? goldMat : woodMat;
            vb.material = hb.material = tb.material = ftb.material = cm;
            auto = p.autoRotate !== false;
          },
          dispose: () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            renderer.domElement.removeEventListener("pointerdown", onDown);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointermove", onMove);
            geos.forEach((x) => x.dispose());
            [woodMat, trimMat, goldMat, flowerMat, greenMat, standMat, ground.material].forEach((m: { dispose: () => void }) => m.dispose());
            renderer.dispose();
            if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
          },
        };
        api.apply(propsRef.current);
        apiRef.current = api;
        cleanup = api.dispose;

        const loop = () => {
          if (disposed) return;
          if (auto) az += 0.0015;
          updCam();
          renderer.render(scene, camera);
          raf = requestAnimationFrame(loop);
        };
        loop();

        if (disposed) api.dispose();
      } catch {
        if (!disposed) showFallback();
      }
    })();

    return () => { disposed = true; cancelAnimationFrame(raf); cleanup(); };
  }, []);

  useEffect(() => {
    apiRef.current?.apply(propsRef.current);
  }, [woodColor, wreathColor, showCross, showWreath, crossMetal, autoRotate]);

  return (
    <>
      <div ref={mountRef} className={className} style={{ position: "absolute", inset: 0, touchAction: "none" }} />
      <div ref={failRef} style={{ display: "none", position: "absolute", inset: 0 }}>{fallback}</div>
    </>
  );
}
