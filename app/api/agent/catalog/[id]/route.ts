import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperationalContext } from "@/lib/auth";
import { appendOperationalAudit, findOperationalReplay } from "@/lib/operationalAudit";
import { assertCapability } from "@/lib/operationalAuth";
import { prisma } from "@/lib/prisma";

const PriceUpdate = z.discriminatedUnion("action", [
  z.object({ action: z.literal("REQUEST_PRICE") }),
  z.object({
    action: z.literal("CONFIRM_PRICE"),
    clientPrice: z.number().int().positive(),
    costPrice: z.number().int().positive().nullable().optional(),
  }),
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsed = PriceUpdate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректное изменение цены" }, { status: 400 });
  const { id } = await params;
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:edit");
    const requestKey = req.headers.get("idempotency-key")?.trim();
    if (!requestKey) return NextResponse.json({ error: "Отсутствует ключ изменения" }, { status: 400 });
    const correlationId = req.headers.get("x-correlation-id")?.trim() || randomUUID();
    const auditKey = `catalog:price:${requestKey}`;
    const result = await prisma.$transaction(async (tx) => {
      const replay = await findOperationalReplay(tx, context.organizationId, auditKey);
      if (replay) {
        // Narrow the replay exactly as the fresh path narrows: an AGENT replaying a key a
        // teammate used must not be handed that teammate's item, prices included.
        return tx.agentCatalogItem.findFirst({
          where: {
            id: replay.entityId,
            organizationId: context.organizationId,
            ...(context.role === "AGENT" ? { agentId: context.agentId } : {}),
          },
          include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
        });
      }
      const item = await tx.agentCatalogItem.findFirst({
        where: {
          id,
          organizationId: context.organizationId,
          ...(context.role === "AGENT" ? { agentId: context.agentId } : {}),
        },
        include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
      });
      const latest = item?.revisions[0];
      if (!item || !latest) return null;
      const nextVersion = latest.version + 1;
      const update = parsed.data;
      const priceState = update.action === "CONFIRM_PRICE" ? "KNOWN" : "REQUESTED";
      const clientPrice = update.action === "CONFIRM_PRICE" ? update.clientPrice : null;
      // Confirming a price says nothing about the cost. Carry a previously confirmed cost
      // forward instead of discarding it: the only UI path sends clientPrice alone, so
      // treating an omitted cost as UNKNOWN silently destroyed the item's margin fact with
      // no way for the agent to restore it.
      const previousCost = latest.costState === "KNOWN" && latest.unitCost !== null ? latest.unitCost / 100 : null;
      const costPrice = update.action === "CONFIRM_PRICE" ? (update.costPrice ?? previousCost) : null;
      const costState = costPrice === null ? "UNKNOWN" : "KNOWN";
      const revision = await tx.catalogItemRevision.create({
        data: {
          catalogItemId: item.id,
          organizationId: context.organizationId,
          version: nextVersion,
          name: latest.name,
          description: latest.description,
          unit: latest.unit,
          priceState,
          clientUnitPrice: clientPrice === null ? null : clientPrice * 100,
          costState,
          unitCost: costPrice === null ? null : costPrice * 100,
          currency: latest.currency,
          availability: latest.availability,
          scenarioCompatibility: JSON.parse(
            JSON.stringify(latest.scenarioCompatibility),
          ) as Prisma.InputJsonValue,
          vendorSource: latest.vendorSource,
          vendorSourceVersion: latest.vendorSourceVersion,
        },
      });
      const updated = await tx.agentCatalogItem.update({
        where: { id: item.id },
        data: {
          priceState,
          // A REQUESTED price must not keep the old figure on the item: the builder reads
          // clientPrice for its editor arithmetic, and a stale value there is how an
          // unconfirmed line ended up contributing a confident number to the headline.
          clientPrice: clientPrice ?? 0,
          costState,
          costPrice: costPrice ?? 0,
          currentVersion: nextVersion,
        },
      });
      await appendOperationalAudit(tx, context, {
        entityType: "catalog_item",
        entityId: item.id,
        action: update.action === "CONFIRM_PRICE" ? "catalog.price_confirmed" : "catalog.price_requested",
        before: { version: latest.version, priceState: latest.priceState, costState: latest.costState },
        after: { version: nextVersion, priceState, costState },
        correlationId,
        idempotencyKey: auditKey,
        result: { itemId: item.id, revisionId: revision.id, version: nextVersion },
      });
      return { ...updated, revisions: [revision] };
    });
    if (!result) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    return NextResponse.json({
      item: {
        ...result,
        currentRevisionId: result.revisions[0]?.id ?? null,
        sourceVersion: String(result.revisions[0]?.version ?? result.currentVersion),
      },
    });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 503;
    return NextResponse.json(
      { error: status === 503 ? "Не удалось изменить цену. Данные не изменены." : "Недостаточно прав" },
      { status },
    );
  }
}

// DELETE — удалить свой товар (только владелец).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const context = await requireOperationalContext(req);
    assertCapability(context, "commercial:edit");
    const requestKey = req.headers.get("idempotency-key")?.trim();
    if (!requestKey) return NextResponse.json({ error: "Отсутствует ключ изменения" }, { status: 400 });
    const correlationId = req.headers.get("x-correlation-id")?.trim() || randomUUID();
    const auditKey = `catalog:discontinue:${requestKey}`;
    const result = await prisma.$transaction(async (tx) => {
      const replay = await findOperationalReplay(tx, context.organizationId, auditKey);
      if (replay) {
        return tx.agentCatalogItem.findFirst({
          where: {
            id: replay.entityId,
            organizationId: context.organizationId,
            ...(context.role === "AGENT" ? { agentId: context.agentId } : {}),
          },
        });
      }
      const item = await tx.agentCatalogItem.findFirst({
        where: {
          id,
          organizationId: context.organizationId,
          ...(context.role === "AGENT" ? { agentId: context.agentId } : {}),
        },
      });
      if (!item) return null;
      if (item.availability === "UNAVAILABLE") return item;
      const latestRevision = await tx.catalogItemRevision.findFirst({
        where: { catalogItemId: item.id, organizationId: context.organizationId },
        orderBy: { version: "desc" },
      });
      if (!latestRevision) throw new Error("Catalog revision is missing");
      const nextVersion = latestRevision.version + 1;
      await tx.catalogItemRevision.create({
        data: {
          catalogItemId: item.id,
          organizationId: context.organizationId,
          version: nextVersion,
          name: latestRevision.name,
          description: latestRevision.description,
          unit: latestRevision.unit,
          priceState: latestRevision.priceState,
          clientUnitPrice: latestRevision.clientUnitPrice,
          costState: latestRevision.costState,
          unitCost: latestRevision.unitCost,
          currency: latestRevision.currency,
          availability: "UNAVAILABLE",
          scenarioCompatibility: JSON.parse(
            JSON.stringify(latestRevision.scenarioCompatibility),
          ) as Prisma.InputJsonValue,
          vendorSource: latestRevision.vendorSource,
          vendorSourceVersion: latestRevision.vendorSourceVersion,
        },
      });
      const updated = await tx.agentCatalogItem.update({
        where: { id: item.id },
        data: { availability: "UNAVAILABLE", currentVersion: nextVersion },
      });
      await appendOperationalAudit(tx, context, {
        entityType: "catalog_item",
        entityId: item.id,
        action: "catalog.item_discontinued",
        before: { availability: item.availability },
        after: { availability: updated.availability, version: nextVersion },
        correlationId,
        idempotencyKey: auditKey,
        result: { itemId: item.id, availability: updated.availability, version: nextVersion },
      });
      return updated;
    });
    if (!result) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 503;
    return NextResponse.json({ error: status === 503 ? "Не удалось изменить каталог" : "Недостаточно прав" }, { status });
  }
}
