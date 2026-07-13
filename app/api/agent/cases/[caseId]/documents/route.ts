import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertLeadOwned, handleApiError, parseId } from "@/lib/apiAuth";
import { getDocumentStorage } from "@/lib/documentStorage";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 МБ
const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
]);
const CATEGORIES = new Set([
  "Свидетельство о смерти",
  "Паспорт",
  "Договор",
  "Доверенность",
  "Прочее",
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Сессия устарела — войдите снова" }, { status: 401 });

  try {
    const leadId = parseId((await params).caseId, "caseId");
    await assertLeadOwned(leadId, session.agentId);

    const storage = getDocumentStorage();
    if (!storage.isConfigured()) {
      return NextResponse.json({ error: "Хранилище файлов не настроено (BLOB_READ_WRITE_TOKEN)" }, { status: 503 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const category = String(form.get("category") ?? "Прочее");

    if (!(file instanceof File)) return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
    if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Неизвестная категория" }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "Пустой файл" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 10 МБ" }, { status: 400 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "Допустимы PDF, JPG, PNG" }, { status: 400 });

    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 120) || "file";
    const blob = await storage.put(`cases/${leadId}/${Date.now()}-${safeName}`, file);

    const doc = await prisma.document.create({
      data: {
        leadId,
        agentId: session.agentId,
        name: file.name.slice(0, 200),
        category,
        url: blob.url,
        pathname: blob.pathname,
        mimeType: file.type,
        size: file.size,
      },
      select: { id: true, name: true, category: true, url: true, mimeType: true, size: true, createdAt: true },
    });

    return NextResponse.json({ document: doc });
  } catch (err) {
    return handleApiError(err, "documents/upload");
  }
}
