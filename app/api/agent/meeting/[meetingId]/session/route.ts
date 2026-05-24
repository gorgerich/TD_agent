import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

declare global {
  // eslint-disable-next-line no-var
  var __coSessions: Map<string, { state: string; updatedAt: number }> | undefined;
}

function getStore() {
  if (!globalThis.__coSessions) {
    globalThis.__coSessions = new Map();
  }
  return globalThis.__coSessions;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { meetingId } = await params;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const key = `meeting:${meetingId}`;
  getStore().set(key, { state: JSON.stringify(body), updatedAt: Date.now() });

  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { meetingId } = await params;
  const entry = getStore().get(`meeting:${meetingId}`);
  if (!entry) return NextResponse.json({ state: null });

  return NextResponse.json({ state: JSON.parse(entry.state), updatedAt: entry.updatedAt });
}
