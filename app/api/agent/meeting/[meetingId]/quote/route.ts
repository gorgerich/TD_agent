import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAgent, assertMeetingOwned, parseId, jsonError, handleApiError } from "@/lib/apiAuth";

export const runtime = "nodejs";

const Body = z.object({
  payload: z.unknown(),
  total: z.number().finite().nonnegative(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  try {
    const session = await requireAgent(req);
    const { meetingId: meetingIdStr } = await params;
    const meetingId = parseId(meetingIdStr, "номер встречи");

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные сметы");
    }

    // Владение: встреча должна принадлежать агенту сессии (закрывает IDOR).
    // agentId === 0 — только dev-заглушка без куки (в prod невозможна).
    if (session.agentId) await assertMeetingOwned(meetingId, session.agentId);

    // total из calculationUtils — рубли; схема хранит копейки.
    const totalKopecks = Math.round(parsed.data.total * 100);

    // Атомарно: находим/создаём Quote и добавляем QuoteVersion.
    const version = await prisma.$transaction(async (tx) => {
      const quote =
        (await tx.quote.findFirst({ where: { meetingId } })) ??
        (await tx.quote.create({ data: { meetingId } }));
      return tx.quoteVersion.create({
        data: {
          quoteId: quote.id,
          payload: JSON.stringify(parsed.data.payload ?? {}),
          total: totalKopecks,
        },
      });
    });

    return NextResponse.json({ ok: true, versionId: version.id, total: totalKopecks });
  } catch (err) {
    return handleApiError(err, "quote/save");
  }
}
