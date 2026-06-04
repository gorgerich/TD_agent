import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertLeadOwned, handleApiError } from "@/lib/apiAuth";

function generateCobrowseCode(): string {
  // 5 байт = 10 hex-символов (~1.1e12 вариантов). Код даёт доступ к co-state с
  // ПДн без авторизации, поэтому пространство должно быть неперебираемым.
  return Buffer.from(crypto.getRandomValues(new Uint8Array(5))).toString("hex").toUpperCase();
}

const CreateMeetingSchema = z.object({
  leadId: z.number().int().positive(),
  scheduledAt: z.string().trim().min(1).optional(),
});

function parseMeetingDatetime(value?: string): Date | undefined {
  if (!value) return undefined;
  const normalized = value.includes("Z") ? value : `${value}:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

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

  const scheduledAt = parseMeetingDatetime(parsed.data.scheduledAt);
  if (parsed.data.scheduledAt && !scheduledAt) {
    return NextResponse.json({ error: "Некорректная дата встречи" }, { status: 400 });
  }

  const cobrowseCode = generateCobrowseCode();

  try {
    // Владение: лид должен принадлежать агенту (иначе IDOR — привязка к чужому клиенту).
    // agentId === 0 — только dev-заглушка без куки (в prod невозможна).
    if (session.agentId) await assertLeadOwned(parsed.data.leadId, session.agentId);

    const meeting = await prisma.meeting.create({
      data: {
        leadId: parsed.data.leadId,
        agentId: session.agentId,
        cobrowseCode,
        scheduledAt,
      },
    });
    return NextResponse.json(meeting, { status: 201 });
  } catch (err) {
    return handleApiError(err, "meetings/create");
  }
}
