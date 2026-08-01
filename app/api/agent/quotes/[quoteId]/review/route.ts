import { NextRequest, NextResponse } from "next/server";
import { requireOperationalContext } from "@/lib/auth";
import { handleApiError, parseId } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";
import { commandMeta } from "@/lib/commercialQuoteValidation";
import { markCommercialQuoteInReview } from "@/lib/commercialQuoteService";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:edit");
    const { quoteId: raw } = await params;
    const result = await markCommercialQuoteInReview({
      quoteId: parseId(raw, "номер сметы"),
      context,
      meta: commandMeta(req),
    });
    return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) });
  } catch (error) {
    return handleApiError(error, "quote/review");
  }
}
