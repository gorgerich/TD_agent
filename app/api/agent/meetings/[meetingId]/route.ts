import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PatchMeetingSchema = z.object({
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  scheduledAt: z.string().trim().min(1).optional(),
});

function parseMeetingDatetime(value?: string): Date | undefined {
  if (!value) return undefined;
  const normalized = value.includes("Z") ? value : `${value}:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { meetingId } = await params;

  try {
    const meeting = await prisma.meeting.findFirst({
      where: { id: Number(meetingId), agentId: session.agentId },
      include: { lead: { select: { name: true, phone: true } } },
    });
    if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(meeting);
  } catch {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { meetingId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchMeetingSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  try {
    const updateData: Record<string, unknown> = {};
    if (parsed.data.status) {
      updateData.status = parsed.data.status;
      if (parsed.data.status === "IN_PROGRESS") updateData.startedAt = new Date();
      if (parsed.data.status === "COMPLETED") updateData.endedAt = new Date();
    }
    if (parsed.data.scheduledAt) {
      const scheduledAt = parseMeetingDatetime(parsed.data.scheduledAt);
      if (!scheduledAt) return NextResponse.json({ error: "Некорректная дата встречи" }, { status: 400 });
      updateData.scheduledAt = scheduledAt;
    }

    const meeting = await prisma.meeting.updateMany({
      where: { id: Number(meetingId), agentId: session.agentId },
      data: updateData,
    });
    if (meeting.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}
