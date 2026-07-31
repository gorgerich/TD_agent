import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperationalContext } from "@/lib/auth";
import { handleApiError, jsonError, parseId } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";
import { commandMeta } from "@/lib/commercialQuoteValidation";
import { publishCommercialQuote } from "@/lib/commercialQuoteService";

export const runtime = "nodejs";

const Body = z.object({
  validUntil: z.iso.datetime(),
  channel: z.enum(["link", "presentation", "print", "email", "messenger"]),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:publish");
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) return jsonError(400, body.error.issues[0]?.message ?? "Некорректные параметры публикации");
    const { quoteId: raw } = await params;
    const result = await publishCommercialQuote({
      quoteId: parseId(raw, "номер сметы"),
      validUntil: new Date(body.data.validUntil),
      channel: body.data.channel,
      context,
      meta: { ...commandMeta(req), reason: body.data.reason },
    });
    return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) });
  } catch (error) {
    return handleApiError(error, "quote/publish");
  }
}
