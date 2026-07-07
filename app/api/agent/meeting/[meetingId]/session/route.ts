import { NextRequest, NextResponse } from "next/server";
import { readCoState, writeCoState } from "@/lib/coSession";
import { requireAgent, assertMeetingAccess, parseId, jsonError, handleApiError } from "@/lib/apiAuth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  try {
    const session = await requireAgent(req);
    const { meetingId } = await params;
    const id = parseId(meetingId, "номер встречи");

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return jsonError(400, "Invalid body");

    // Владение: co-state содержит ПДн клиента — писать может только агент встречи.
    await assertMeetingAccess(id, session);

    const ok = await writeCoState(id, body);
    return NextResponse.json({ ok });
  } catch (err) {
    return handleApiError(err, "co-session/put");
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  try {
    const session = await requireAgent(req);
    const { meetingId } = await params;
    const id = parseId(meetingId, "номер встречи");

    await assertMeetingAccess(id, session);

    const entry = await readCoState(id);
    if (!entry) return NextResponse.json({ state: null });
    return NextResponse.json({ state: entry.state, updatedAt: entry.updatedAt });
  } catch (err) {
    return handleApiError(err, "co-session/get");
  }
}
