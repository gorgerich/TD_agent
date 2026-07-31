import { NextRequest, NextResponse } from "next/server";
import { requireOperationalContext } from "@/lib/auth";
import { handleApiError, parseId } from "@/lib/apiAuth";
import { commandMeta } from "@/lib/commercialQuoteValidation";
import { startCommercialPresentation } from "@/lib/commercialQuoteService";
import { assertCapability } from "@/lib/operationalAuth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:read");
    const result = await startCommercialPresentation({
      quoteId: parseId((await params).quoteId, "номер сметы"),
      context,
      meta: commandMeta(req),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleApiError(error, "quote/presentation-start");
  }
}
