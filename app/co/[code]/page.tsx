import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { AGENT_ATTRIBUTION_CATALOG, type EstimateItem } from "@/lib/calculationUtils";
import { SCENE_EASEL_ANCHORS } from "@/components/visualizer/sceneAnchors";
import CoView from "./CoView";

// SKU-слой (basename imageUrl) — та же схема, что в AttributeRender.SKU_LAYER.
const SKU_LAYER: Record<string, string> = Object.fromEntries(
  AGENT_ATTRIBUTION_CATALOG.filter((i) => i.imageUrl).map((i) => [
    i.id,
    i.imageUrl!.split("/").pop()!.replace(/\.[a-z]+$/i, ""),
  ]),
);

// og:image со сценой выбранного комплекта: клиент видит превью своего
// зала прощания прямо в мессенджере при получении ссылки на смету.
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const base: Metadata = { title: "Смета — Тихий дом" };
  try {
    const { code } = await params;
    if (code.startsWith("DEV-")) return base;
    const meeting = await prisma.meeting.findUnique({ where: { cobrowseCode: code }, select: { id: true } });
    if (!meeting) return base;
    const quote = await prisma.quote.findFirst({
      where: { meetingId: meeting.id },
      include: { versions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const payload = quote?.versions[0]?.payload;
    if (!payload) return base;
    const raw = JSON.parse(payload) as { estimateItems?: EstimateItem[] };
    const items = Array.isArray(raw.estimateItems) ? [...raw.estimateItems].reverse() : [];
    const coffinItem = items.find((i) => i.category === "Гробы" && SKU_LAYER[i.catalogItemId]);
    const wreathSkus = items
      .filter((i) => i.category === "Венки" && SKU_LAYER[i.catalogItemId])
      .slice(0, 2)
      .map((i) => SKU_LAYER[i.catalogItemId]);
    const coffin = coffinItem ? SKU_LAYER[coffinItem.catalogItemId] : undefined;
    if (!coffin || !SCENE_EASEL_ANCHORS[coffin]) return base;
    const qs = new URLSearchParams({ coffin });
    if (wreathSkus[0]) qs.set("wl", wreathSkus[0]);
    if (wreathSkus[1]) qs.set("wr", wreathSkus[1]);
    return {
      ...base,
      openGraph: {
        title: "Смета — Тихий дом",
        description: "Состав ритуального комплекта и итоговая смета.",
        images: [{ url: `/api/visualizer/scene?${qs.toString()}`, width: 1200, height: 630 }],
      },
    };
  } catch {
    return base;
  }
}

export default async function CoPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  // Тёплая бумага B2C tihiydom.com - клиент видит знакомый материал.
  return (
    <div className="min-h-[100dvh] bg-paper">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 px-5 py-3.5 backdrop-blur-md sm:px-7">
        <span className="mx-auto flex w-full max-w-[700px] items-baseline justify-between gap-4">
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Тихий дом</span>
          <span className="td-eyebrow text-ink-3">Смета</span>
        </span>
      </header>

      <main className="px-5 py-7 sm:px-7 sm:py-10">
        <CoView code={code} />
      </main>
    </div>
  );
}
