import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const CreateLeadSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(7).max(30),
  source: z.string().min(1).max(50),
  context: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const leads = await prisma.clientLead.findMany({
      where: { agentId: session.agentId },
      orderBy: { createdAt: "desc" },
      include: { meetings: { select: { status: true } } },
    });
    return NextResponse.json(leads);
  } catch {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateLeadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  try {
    const lead = await prisma.clientLead.create({
      data: {
        agentId: session.agentId,
        name: parsed.data.name,
        phone: parsed.data.phone,
        source: parsed.data.source,
        context: parsed.data.context,
      },
    });
    return NextResponse.json(lead, { status: 201 });
  } catch {
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}
