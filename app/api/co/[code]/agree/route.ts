import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Клиент нажал «Согласовать смету» в /co. Доступ по cobrowseCode (capability).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (code.startsWith("DEV-")) return NextResponse.json({ ok: true }); // dev — не пишем

  try {
    const meeting = await prisma.meeting.findUnique({ where: { cobrowseCode: code }, select: { id: true, coAgreedAt: true } });
    if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!meeting.coAgreedAt) {
      await prisma.meeting.update({ where: { id: meeting.id }, data: { coAgreedAt: new Date() } });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 503 });
  }
}
