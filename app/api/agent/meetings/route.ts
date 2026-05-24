import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function generateCobrowseCode(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(3))).toString("hex").toUpperCase();
}

const CreateMeetingSchema = z.object({
  leadId: z.number().int().positive(),
  scheduledAt: z.string().datetime().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;

  try {
    const meetings = await prisma.meeting.findMany({
      where: { agentId: session.agentId, ...(status ? { status: status as "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" } : {}) },
      orderBy: { scheduledAt: "desc" },
      include: { lead: { select: { name: true, phone: true } } },
    });
    return NextResponse.json(meetings);
  } catch {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateMeetingSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const cobrowseCode = generateCobrowseCode();

  try {
    const meeting = await prisma.meeting.create({
      data: {
        leadId: parsed.data.leadId,
        agentId: session.agentId,
        cobrowseCode,
        scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
      },
    });
    return NextResponse.json(meeting, { status: 201 });
  } catch {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}
