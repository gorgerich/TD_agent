import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireOperationalContext } from "@/lib/auth";
import { parseId, jsonError, handleApiError } from "@/lib/apiAuth";
import { assertCapability } from "@/lib/operationalAuth";
import { CommercialDraftSchema, commandMeta } from "@/lib/commercialQuoteValidation";
import {
  getCommercialQuoteForMeeting,
  requireCommercialMeetingAccess,
  saveCommercialDraft,
} from "@/lib/commercialQuoteService";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:read");
    const { meetingId: raw } = await params;
    const meetingId = parseId(raw, "номер встречи");
    await requireCommercialMeetingAccess(meetingId, context);
    const quote = await getCommercialQuoteForMeeting(meetingId, context);
    return NextResponse.json({ quote });
  } catch (error) {
    return handleApiError(error, "quote/read");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:edit");
    const { meetingId: meetingIdStr } = await params;
    const meetingId = parseId(meetingIdStr, "номер встречи");
    await requireCommercialMeetingAccess(meetingId, context);

    const parsed = CommercialDraftSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные сметы");
    }

    const result = await saveCommercialDraft({
      meetingId,
      scenario: parsed.data.scenario,
      lines: parsed.data.lines,
      editorState: JSON.parse(JSON.stringify(parsed.data.editorState ?? null)) as Prisma.InputJsonValue,
      context,
      meta: commandMeta(req),
    });
    return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) });
  } catch (err) {
    return handleApiError(err, "quote/save");
  }
}
