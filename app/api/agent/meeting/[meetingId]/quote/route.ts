import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const { meetingId: meetingIdStr } = await params;
  const meetingId = Number(meetingIdStr);

  if (isNaN(meetingId)) {
    return NextResponse.json({ error: "Некорректный meetingId" }, { status: 400 });
  }

  let body: { payload: unknown; total: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const { payload, total } = body;
  if (typeof total !== "number" || total < 0) {
    return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 });
  }

  // Find or create the Quote for this meeting
  let quote = await prisma.quote.findFirst({ where: { meetingId } });
  if (!quote) {
    quote = await prisma.quote.create({ data: { meetingId } });
  }

  // total из calculationUtils — рубли; схема хранит копейки
  const totalKopecks = Math.round(total * 100);

  const version = await prisma.quoteVersion.create({
    data: {
      quoteId: quote.id,
      payload: JSON.stringify(payload),
      total: totalKopecks,
    },
  });

  return NextResponse.json({ ok: true, versionId: version.id, total: totalKopecks });
}
