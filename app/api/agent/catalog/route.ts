import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
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
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const items = await prisma.agentCatalogItem.findMany({
      where: { agentId: session.agentId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ items });
  } catch {
    // таблицы ещё нет / БД недоступна — не роняем UI, отдаём пустой каталог
    return NextResponse.json({ items: [] });
  }
}

// POST — создать товар: { name, category, clientPrice, costPrice?, description?, imageData }.
export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const category = String(body.category ?? "").trim();
  const clientPrice = Math.round(Number(body.clientPrice));
  const costPrice = Math.max(0, Math.round(Number(body.costPrice ?? 0)));
  const description = String(body.description ?? "").trim().slice(0, 500);
  const imageData = String(body.imageData ?? "");

  if (name.length < 2) return NextResponse.json({ error: "Укажите название товара" }, { status: 400 });
  if (!ALLOWED_CATEGORIES.has(category)) return NextResponse.json({ error: "Неизвестная категория" }, { status: 400 });
  if (!Number.isFinite(clientPrice) || clientPrice < 0) return NextResponse.json({ error: "Укажите корректную цену" }, { status: 400 });
  if (!imageData.startsWith("data:image/")) return NextResponse.json({ error: "Нет изображения товара" }, { status: 400 });
  if (imageData.length > MAX_IMAGE_CHARS) return NextResponse.json({ error: "Изображение слишком большое" }, { status: 413 });

  try {
    const item = await prisma.agentCatalogItem.create({
      data: { agentId: session.agentId, name, category, clientPrice, costPrice, description, imageData },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "БД недоступна (выполните prisma db push)" }, { status: 503 });
  }
}
