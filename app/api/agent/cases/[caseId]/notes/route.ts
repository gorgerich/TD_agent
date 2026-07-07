import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAgent, assertLeadAccess, parseId, jsonError, handleApiError } from "@/lib/apiAuth";
import { encryptField } from "@/lib/crypto";

export const runtime = "nodejs";

const CreateBody = z.object({
  body: z.string().min(1).max(4000),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const session = await requireAgent(req);
    const { caseId: caseIdStr } = await params;
    const leadId = parseId(caseIdStr, "caseId");

    await assertLeadAccess(leadId, session);

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректные данные");

    const note = await prisma.caseNote.create({
      data: {
        leadId,
        agentId: session.agentId,
        body: encryptField(parsed.data.body) ?? parsed.data.body,
      },
    });

    // Return plaintext body — encryption is internal storage detail.
    return NextResponse.json({ ok: true, note: { ...note, body: parsed.data.body } });
  } catch (err) {
    return handleApiError(err, "notes/create");
  }
}
