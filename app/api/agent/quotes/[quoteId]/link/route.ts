import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperationalContext } from "@/lib/auth";
import { handleApiError, jsonError, parseId } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";
import { commandMeta } from "@/lib/commercialQuoteValidation";
import { createCommercialClientLink, revokeCommercialClientLinks } from "@/lib/commercialQuoteService";

export const runtime = "nodejs";

const Body = z.object({ expiresAt: z.iso.datetime() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:publish");
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) return jsonError(400, body.error.issues[0]?.message ?? "Некорректный срок ссылки");
    const { quoteId: raw } = await params;
    const result = await createCommercialClientLink({
      quoteId: parseId(raw, "номер сметы"),
      expiresAt: new Date(body.data.expiresAt),
      context,
      meta: commandMeta(req),
    });
    return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) });
  } catch (error) {
    return handleApiError(error, "quote/link");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:publish");
    const { quoteId: raw } = await params;
    const result = await revokeCommercialClientLinks({
      quoteId: parseId(raw, "номер сметы"),
      context,
      meta: commandMeta(req),
    });
    return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) });
  } catch (error) {
    return handleApiError(error, "quote/link-revoke");
  }
}
