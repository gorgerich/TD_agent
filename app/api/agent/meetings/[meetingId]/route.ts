import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, parseId, requireAgent } from "@/lib/apiAuth";
import { rescheduleMeeting, updateMeetingStatus } from "@/lib/meetingService";

export const runtime = "nodejs";

const PatchMeetingSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), version: z.number().int().positive() }),
  z.object({ action: z.literal("complete"), outcome: z.string().min(1).max(2000), version: z.number().int().positive() }),
  z.object({ action: z.literal("no_show"), outcome: z.string().min(1).max(2000), version: z.number().int().positive() }),
  z.object({ action: z.literal("cancel"), reason: z.string().min(1).max(2000), version: z.number().int().positive() }),
  z.object({
    action: z.literal("reschedule"),
    scheduledAt: z.string().datetime({ offset: true }).nullable(),
    durationMinutes: z.number().int().min(15).max(720).optional().nullable(),
    reason: z.string().min(1).max(1000),
    version: z.number().int().positive(),
  }),
]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  try {
    const session = await requireAgent(req);
    const meeting = await prisma.meeting.findFirst({
      where: {
        id: parseId((await params).meetingId, "meetingId"),
        organizationId: session.organizationId,
        ...(session.role === "AGENT" ? { ownerMembershipId: session.membershipId } : {}),
      },
      include: { lead: { select: { name: true, phone: true } } },
    });
    if (!meeting) return jsonError(404, "Встреча не найдена");
    return NextResponse.json(meeting);
  } catch (err) {
    return handleApiError(err, "meetings/get");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  try {
    const session = await requireAgent(req);
    const meetingId = parseId((await params).meetingId, "meetingId");
    const parsed = PatchMeetingSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");
    const meta = { idempotencyKey, correlationId };

    const result = parsed.data.action === "reschedule"
      ? await rescheduleMeeting(session, meetingId, {
          ...parsed.data,
          scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
        }, meta)
      : await updateMeetingStatus(session, meetingId, {
          status: parsed.data.action === "confirm"
            ? "CONFIRMED"
            : parsed.data.action === "complete"
              ? "COMPLETED"
              : parsed.data.action === "no_show"
                ? "NO_SHOW"
                : "CANCELLED",
          outcome: "outcome" in parsed.data ? parsed.data.outcome : undefined,
          reason: "reason" in parsed.data ? parsed.data.reason : undefined,
          version: parsed.data.version,
        }, meta);

    return NextResponse.json({ ok: true, meeting: result });
  } catch (err) {
    return handleApiError(err, "meetings/command");
  }
}
