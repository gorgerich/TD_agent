import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireOperationalContext } from "@/lib/auth";
import { appendOperationalAudit, findOperationalReplay } from "@/lib/operationalAudit";
import { assertCapability } from "@/lib/operationalAuth";
import { prisma } from "@/lib/prisma";

// Лимит на размер картинки (data URL). ~2.7МБ base64 ≈ 2МБ бинарь.
const MAX_IMAGE_CHARS = 2_800_000;

const ALLOWED_CATEGORIES = new Set([
  "Гробы",
  "Постель / комплект в гроб",
  "Венки",
  "Кресты / таблички",
  "Транспорт",
  "Бригада / грузчики",
  "Урны",
  "Дополнительные услуги",
]);

// GET — список товаров текущего агента.
export async function GET(req: NextRequest) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:read");
    const items = await prisma.agentCatalogItem.findMany({
      where: {
        organizationId: context.organizationId,
        availability: "AVAILABLE",
        ...(context.role === "AGENT" ? { agentId: context.agentId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    return NextResponse.json({
      items: items.map(({ revisions, ...item }) => ({
        ...item,
        currentRevisionId: revisions[0]?.id ?? null,
        sourceVersion: String(revisions[0]?.version ?? item.currentVersion),
      })),
    });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 503;
    return NextResponse.json(
      { error: status === 503 ? "Каталог временно недоступен. Повторите попытку." : "Недостаточно прав" },
      { status },
    );
  }
}

// POST — создать товар: { name, category, clientPrice, costPrice?, description?, imageData }.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const category = String(body.category ?? "").trim();
  const clientPrice = Math.round(Number(body.clientPrice));
  const hasCost = body.costPrice !== null && body.costPrice !== undefined && String(body.costPrice).trim() !== "";
  const costPrice = hasCost ? Math.round(Number(body.costPrice)) : null;
  const description = String(body.description ?? "").trim().slice(0, 500);
  const imageData = String(body.imageData ?? "");

  if (name.length < 2) return NextResponse.json({ error: "Укажите название товара" }, { status: 400 });
  if (!ALLOWED_CATEGORIES.has(category)) return NextResponse.json({ error: "Неизвестная категория" }, { status: 400 });
  if (!Number.isFinite(clientPrice) || clientPrice <= 0) return NextResponse.json({ error: "Укажите подтверждённую цену" }, { status: 400 });
  if (costPrice !== null && (!Number.isFinite(costPrice) || costPrice <= 0)) {
    return NextResponse.json({ error: "Себестоимость должна быть положительной или оставаться пустой" }, { status: 400 });
  }
  if (!imageData.startsWith("data:image/")) return NextResponse.json({ error: "Нет изображения товара" }, { status: 400 });
  if (imageData.length > MAX_IMAGE_CHARS) return NextResponse.json({ error: "Изображение слишком большое" }, { status: 413 });

  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:edit");
    const requestKey = req.headers.get("idempotency-key")?.trim();
    if (!requestKey) return NextResponse.json({ error: "Отсутствует ключ сохранения" }, { status: 400 });
    const correlationId = req.headers.get("x-correlation-id")?.trim() || randomUUID();
    const auditKey = `catalog:create:${requestKey}`;
    const item = await prisma.$transaction(async (tx) => {
      const replay = await findOperationalReplay(tx, context.organizationId, auditKey);
      if (replay) {
        const existing = await tx.agentCatalogItem.findFirst({
          where: {
            id: replay.entityId,
            organizationId: context.organizationId,
            ...(context.role === "AGENT" ? { agentId: context.agentId } : {}),
          },
        });
        if (!existing) throw new Error("Catalog replay target is missing");
        return existing;
      }
      const created = await tx.agentCatalogItem.create({
        data: {
          agentId: context.agentId,
          organizationId: context.organizationId,
          name,
          category,
          clientPrice,
          costPrice: costPrice ?? 0,
          description,
          imageData,
          priceState: "KNOWN",
          costState: costPrice === null ? "UNKNOWN" : "KNOWN",
        },
      });
      await tx.catalogItemRevision.create({
        data: {
          catalogItemId: created.id,
          organizationId: context.organizationId,
          version: 1,
          name,
          description,
          priceState: "KNOWN",
          clientUnitPrice: clientPrice * 100,
          costState: costPrice === null ? "UNKNOWN" : "KNOWN",
          unitCost: costPrice === null ? null : costPrice * 100,
          availability: "AVAILABLE",
          scenarioCompatibility: ["CREMATION_V1", "FAMILY_PLOT_BURIAL_V1"],
        },
      });
      await appendOperationalAudit(tx, context, {
        entityType: "catalog_item",
        entityId: created.id,
        action: "catalog.item_created",
        before: {},
        after: {
          version: 1,
          priceState: "KNOWN",
          costState: costPrice === null ? "UNKNOWN" : "KNOWN",
          availability: "AVAILABLE",
        },
        correlationId,
        idempotencyKey: auditKey,
        result: { itemId: created.id, version: 1 },
      });
      return created;
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 503;
    return NextResponse.json(
      { error: status === 503 ? "Не удалось сохранить товар. Данные не изменены." : "Недостаточно прав" },
      { status },
    );
  }
}
