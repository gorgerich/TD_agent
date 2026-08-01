import { NextRequest, NextResponse } from "next/server";
import { requireOperationalContext } from "@/lib/auth";
import { handleApiError } from "@/lib/apiAuth";
import { commandMeta } from "@/lib/commercialQuoteValidation";
import { endCommercialPresentation, getCommercialPresentation } from "@/lib/commercialQuoteService";
import { assertCapability } from "@/lib/operationalAuth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ presentationId: string }> }) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:read");
    return NextResponse.json(await getCommercialPresentation((await params).presentationId, context));
  } catch (error) {
    return handleApiError(error, "quote/presentation-read");
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ presentationId: string }> }) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:read");
    return NextResponse.json(await endCommercialPresentation({
      presentationId: (await params).presentationId,
      context,
      meta: commandMeta(req),
    }));
  } catch (error) {
    return handleApiError(error, "quote/presentation-end");
  }
}
