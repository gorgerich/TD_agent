import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { appendOperationalAudit } from "@/lib/operationalAudit";
import { assertCapability } from "@/lib/operationalAuth";
import { runOperationalTransaction } from "@/lib/operationalTransaction";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["MY", "TEAM"]).default("MY"),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    assertCapability(session, "work:read");
    const views = await prisma.savedOperationalView.findMany({
      where: {
        organizationId: session.organizationId,
        OR: [
          { ownerMembershipId: session.membershipId },
          ...(session.role === "AGENT" ? [] : [{ scope: "TEAM" as const }]),
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ views });
  } catch (error) {
    return handleApiError(error, "operations/views/list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    assertCapability(session, "work:read");
    const parsed = ViewSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Некорректное представление");
    if (parsed.data.scope === "TEAM") assertCapability(session, "team:read");
    const idempotencyKey = req.headers.get("idempotency-key")?.trim();
    const correlationId = req.headers.get("x-correlation-id")?.trim();
    if (!idempotencyKey || !correlationId) return jsonError(400, "Нужны Idempotency-Key и X-Correlation-Id");
    const view = await runOperationalTransaction(async (tx) => {
      const current = await tx.savedOperationalView.findUnique({
        where: { ownerMembershipId_name: { ownerMembershipId: session.membershipId, name: parsed.data.name } },
      });
      const saved = await tx.savedOperationalView.upsert({
        where: { ownerMembershipId_name: { ownerMembershipId: session.membershipId, name: parsed.data.name } },
        update: { scope: parsed.data.scope, query: parsed.data.query },
        create: {
          organizationId: session.organizationId,
          ownerMembershipId: session.membershipId,
          name: parsed.data.name,
          scope: parsed.data.scope,
          query: parsed.data.query,
        },
      });
      await appendOperationalAudit(tx, session, {
        entityType: "saved_view",
        entityId: saved.id,
        action: current ? "saved_view.updated" : "saved_view.created",
        before: current ? { name: current.name, scope: current.scope, query: current.query } : {},
        after: { name: saved.name, scope: saved.scope, query: saved.query },
        correlationId,
        idempotencyKey,
        result: { id: saved.id },
      });
      return saved;
    });
    return NextResponse.json({ view }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "operations/views/save");
  }
}
