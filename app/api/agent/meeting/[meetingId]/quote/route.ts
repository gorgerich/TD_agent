import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const { meetingId: meetingIdStr } = await params;
  const meetingId = Number(meetingIdStr);

  if (!Number.isInteger(meetingId) || meetingId <= 0) {
    return NextResponse.json({ error: "Некорректный номер встречи" }, { status: 400 });
  }

  let body: { payload: unknown; total: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректные данные сметы" }, { status: 400 });
  }

  const { payload, total } = body;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return NextResponse.json({ error: "Некорректная сумма сметы" }, { status: 400 });
  }

  // total из calculationUtils — рубли; схема хранит копейки
  const totalKopecks = Math.round(total * 100);

  try {
    // Встреча обязана существовать (FK Quote.meetingId → Meeting.id)
    const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true } });
    if (!meeting) {
      return NextResponse.json(
        { error: "Встреча не найдена — обновите страницу" },
        { status: 404 },
      );
    }

    // Сохраняем версию атомарно: находим/создаём Quote и добавляем QuoteVersion.
    const version = await prisma.$transaction(async (tx) => {
      let quote = await tx.quote.findFirst({ where: { meetingId } });
      if (!quote) {
        quote = await tx.quote.create({ data: { meetingId } });
      }
      return tx.quoteVersion.create({
        data: {
          quoteId: quote.id,
          payload: JSON.stringify(payload ?? {}),
          total: totalKopecks,
        },
      });
    });

    return NextResponse.json({ ok: true, versionId: version.id, total: totalKopecks });
  } catch (err) {
    console.error("[quote/save] meetingId=%s failed:", meetingId, err);

    // Известные ошибки Prisma → понятные сообщения
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2003") {
        return NextResponse.json({ error: "Встреча не найдена — обновите страницу" }, { status: 404 });
      }
    }
    if (
      err instanceof Prisma.PrismaClientInitializationError ||
      (err instanceof Error && /Can't reach database|ECONNREFUSED|P1001/.test(err.message))
    ) {
      return NextResponse.json(
        { error: "База данных недоступна. Попробуйте ещё раз через минуту." },
        { status: 503 },
      );
    }

    const detail = process.env.NODE_ENV === "production" ? undefined : (err as Error)?.message;
    return NextResponse.json(
      { error: "Не удалось сохранить смету", detail },
      { status: 500 },
    );
  }
}
