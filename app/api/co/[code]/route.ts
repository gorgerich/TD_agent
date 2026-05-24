import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

declare global {
  // eslint-disable-next-line no-var
  var __coSessions: Map<string, { state: string; updatedAt: number }> | undefined;
}

async function getMeetingIdByCode(code: string): Promise<number | null> {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { cobrowseCode: code },
      select: { id: true },
    });
    return meeting?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  // Dev: extract meeting ID from DEV-{id} codes
  let meetingId: number | null = null;
  if (code.startsWith("DEV-")) {
    meetingId = Number(code.slice(4)) || null;
  } else {
    meetingId = await getMeetingIdByCode(code);
  }

  if (!meetingId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const store = globalThis.__coSessions;
  const entry = store?.get(`meeting:${meetingId}`);
  if (!entry) return NextResponse.json({ state: null, updatedAt: null });

  return NextResponse.json({ state: JSON.parse(entry.state), updatedAt: entry.updatedAt });
}
