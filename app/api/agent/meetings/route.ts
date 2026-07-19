import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { createMeeting } from "@/lib/meetingService";

export const runtime = "nodejs";

const CreateMeetingSchema = z.object({
  leadId: z.number().int().positive(),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable(),
  ownerMembershipId: z.string().min(1).optional(),
  type: z.enum(["CONSULTATION", "FOLLOW_UP", "DOCUMENT_REVIEW", "CEREMONY_COORDINATION", "OTHER"]).optional(),
  channel: z.enum(["IN_PERSON", "PHONE", "VIDEO", "OTHER"]).optional(),
  location: z.string().max(300).optional().nullable(),
  durationMinutes: z.number().int().min(15).max(720).optional().nullable(),
  attendees: z.array(z.object({ label: z.string().min(1).max(120), role: z.string().max(80).optional() })).max(20).optional(),
});

const MeetingStatusSchema = z.enum(["TENTATIVE", "SCHEDULED", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"]);

export async function GET(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    const rawStatus = new URL(req.url).searchParams.get("status");
    const parsedStatus = rawStatus ? MeetingStatusSchema.safeParse(rawStatus) : null;
    if (parsedStatus && !parsedStatus.success) return jsonError(400, "Неизвестный статус встречи");
    const meetings = await prisma.meeting.findMany({
      where: {
        organizationId: session.organizationId,
        ...(session.role === "AGENT" ? { ownerMembershipId: session.membershipId } : {}),
        ...(parsedStatus?.success ? { operationalStatus: parsedStatus.data } : {}),
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: 300,
      include: { lead: { select: { name: true, phone: true } } },
    });
    return NextResponse.json(meetings);
  } catch (err) {
    return handleApiError(err, "meetings/list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    const parsed = CreateMeetingSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");

    const meeting = await createMeeting(session, {
      ...parsed.data,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
    }, { idempotencyKey, correlationId });
    return NextResponse.json(meeting, { status: 201 });
  } catch (err) {
    return handleApiError(err, "meetings/create");
  }
}
