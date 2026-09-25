import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, requireAgent } from "@/lib/apiAuth";
import { appendOperationalAudit } from "@/lib/operationalAudit";
import { assertCapability, hasTeamOperationalScope } from "@/lib/operationalAuth";
import { runOperationalTransaction } from "@/lib/operationalTransaction";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const SavedQuerySchema = z.discriminatedUnion("screen", [
  z.object({
    screen: z.literal("today"),
    group: z.enum(["ALL", "OVERDUE", "TODAY", "UPCOMING", "WAITING"]),
  }).strict(),
  z.object({
    screen: z.literal("team"),
    filter: z.enum(["ATTENTION", "UNASSIGNED", "ALL"]),
  }).strict(),
]);

const ViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["MY", "TEAM"]).default("MY"),
  query: SavedQuerySchema,
}).strict();

export async function GET(req: NextRequest) {
  try {
    const session = await requireAgent(req);
    assertCapability(session, "work:read");
    const views = await prisma.savedOperationalView.findMany({
      where: {
        organizationId: session.organizationId,
        OR: [
          { ownerMembershipId: session.membershipId },
          ...(hasTeamOperationalScope(session.role) ? [{ scope: "TEAM" as const }] : []),
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
    let replayed = false;
    let view;
    try {
      view = await runOperationalTransaction(async (tx) => {
      const replay = await tx.operationalAuditEvent.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: session.organizationId, idempotencyKey } },
      });
      if (replay) {
        replayed = true;
        const replayId = String((replay.result as Record<string, unknown>).id ?? "");
        const replayView = await tx.savedOperationalView.findFirst({
          where: { id: replayId, organizationId: session.organizationId, ownerMembershipId: session.membershipId },
        });
        if (!replayView) throw new Error("Saved view replay target missing");
        return replayView;
      }
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
        before: current ? savedViewAuditSnapshot(current.scope, current.query) : {},
        after: savedViewAuditSnapshot(saved.scope, saved.query),
        correlationId,
        idempotencyKey,
        result: { id: saved.id },
      });
      return saved;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const replay = await prisma.operationalAuditEvent.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: session.organizationId, idempotencyKey } },
      });
      const replayId = String((replay?.result as Record<string, unknown> | undefined)?.id ?? "");
      view = await prisma.savedOperationalView.findFirst({
        where: { id: replayId, organizationId: session.organizationId, ownerMembershipId: session.membershipId },
      });
      if (!view) throw error;
      replayed = true;
    }
    return NextResponse.json({ view, replayed }, { status: replayed ? 200 : 201 });
  } catch (error) {
    return handleApiError(error, "operations/views/save");
  }
}

function savedViewAuditSnapshot(scope: "MY" | "TEAM", query: Prisma.JsonValue): Prisma.InputJsonValue {
  const screen = query && !Array.isArray(query) && typeof query === "object" && typeof query.screen === "string"
    ? query.screen
    : "unknown";
  return { scope, screen, hasFilter: true };
}
