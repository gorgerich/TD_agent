import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { readCoState, writeCoState } from "@/lib/coSession";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { meetingId } = await params;
  const id = Number(meetingId);
  if (!id) return NextResponse.json({ error: "Invalid meeting" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const ok = await writeCoState(id, body);
  return NextResponse.json({ ok });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { meetingId } = await params;
  const id = Number(meetingId);
  if (!id) return NextResponse.json({ state: null });

  const entry = await readCoState(id);
  if (!entry) return NextResponse.json({ state: null });
  return NextResponse.json({ state: entry.state, updatedAt: entry.updatedAt });
}
