import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readCoState, mergeCoAttributes } from "@/lib/coSession";

async function resolveMeetingId(code: string): Promise<number | null> {
  if (code.startsWith("DEV-")) return Number(code.slice(4)) || null;
  try {
    const meeting = await prisma.meeting.findUnique({ where: { cobrowseCode: code }, select: { id: true } });
    return meeting?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const meetingId = await resolveMeetingId(code);
  if (!meetingId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const entry = await readCoState(meetingId);
  if (!entry) return NextResponse.json({ state: null, updatedAt: null });
  return NextResponse.json({ state: entry.state, updatedAt: entry.updatedAt });
}

// Клиент меняет только атрибутику (без авторизации — доступ по коду встречи).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const meetingId = await resolveMeetingId(code);
  if (!meetingId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const ok = await mergeCoAttributes(meetingId, (body as { attributes?: unknown }).attributes);
  if (!ok) return NextResponse.json({ error: "Save failed" }, { status: 500 });
  const entry = await readCoState(meetingId);
  return NextResponse.json({ ok: true, state: entry?.state ?? null, updatedAt: entry?.updatedAt ?? null });
}
