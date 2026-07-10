import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import {
  SCENE_EASEL_ANCHORS,
  DEFAULT_SCENE_ANCHORS,
  WREATH_CUT_ASPECTS,
  type EaselAnchor,
} from "@/components/visualizer/sceneAnchors";

// Серверный рендер сцены визуализатора: гроб (AI-сцена) + до двух венков
// (направленные AI-вырезы) по тем же якорям, что и клиентский рендер.
// Первый запрос рендерит кадр, дальше — вечный CDN-кэш (immutable):
// все комбинации 21×7×7 покрываются без хранения файлов в репо.
// Использование: /api/visualizer/scene?coffin=fs-6&wl=avtorskie&wr=krest
// Формат: 1200×630 (og:image) — кадрируется нижняя часть сцены 4:3.

export const runtime = "edge";

const WREATH_SKUS = new Set([
  "avtorskie",
  "cvetopad",
  "krest",
  "standart-blue",
  "standart-mix",
  "standart-red",
  "tricolor",
]);

const W = 1200;
const H = 630;
// Сцена 4:3 рендерится 1200×900, кадр сдвигается вверх: венки и гроб в кадре.
const SCENE_H = 900;
const OFFSET_Y = -170;

async function fetchAsDataUrl(origin: string, path: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin}${path}`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const mime = path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

// Явные размеры и позиция без transform — satori требует width/height у img.
function wreathBox(anchor: EaselAnchor, aspect: number) {
  const height = Math.round(anchor.h * SCENE_H);
  const width = Math.round(height * aspect);
  return {
    width,
    height,
    left: Math.round(anchor.x * W - width / 2),
    top: Math.round((anchor.cy - anchor.h / 2) * SCENE_H + OFFSET_Y),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const coffin = searchParams.get("coffin") ?? "";
  const wl = searchParams.get("wl") ?? "";
  const wr = searchParams.get("wr") ?? "";

  // Белые списки: сцена должна существовать, венки — из известных SKU.
  if (!SCENE_EASEL_ANCHORS[coffin]) {
    return new Response("Unknown coffin scene", { status: 404 });
  }
  const anchors = SCENE_EASEL_ANCHORS[coffin] ?? DEFAULT_SCENE_ANCHORS;

  const scene = await fetchAsDataUrl(origin, `/visualizer/scenes/${coffin}.jpg`);
  if (!scene) return new Response("Scene asset missing", { status: 404 });

  const [wlImg, wrImg] = await Promise.all([
    WREATH_SKUS.has(wl) ? fetchAsDataUrl(origin, `/visualizer/wreaths-cut/${wl}-left.webp`) : null,
    WREATH_SKUS.has(wr) ? fetchAsDataUrl(origin, `/visualizer/wreaths-cut/${wr}-right.webp`) : null,
  ]);

  const wlBox = wlImg ? wreathBox(anchors.left, WREATH_CUT_ASPECTS[wl]?.left ?? 0.65) : null;
  const wrBox = wrImg ? wreathBox(anchors.right, WREATH_CUT_ASPECTS[wr]?.right ?? 0.65) : null;

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", position: "relative", overflow: "hidden", backgroundColor: "#111" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={scene} width={W} height={SCENE_H} style={{ position: "absolute", top: OFFSET_Y, left: 0 }} alt="" />
        {wlImg && wlBox && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wlImg} width={wlBox.width} height={wlBox.height} style={{ position: "absolute", left: wlBox.left, top: wlBox.top }} alt="" />
        )}
        {wrImg && wrBox && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={wrImg} width={wrBox.width} height={wrBox.height} style={{ position: "absolute", left: wrBox.left, top: wrBox.top }} alt="" />
        )}
      </div>
    ),
    {
      width: W,
      height: H,
      headers: {
        // Комбинация неизменна — кэшируем навсегда на CDN.
        "Cache-Control": "public, s-maxage=31536000, max-age=86400, immutable",
      },
    },
  );
}
