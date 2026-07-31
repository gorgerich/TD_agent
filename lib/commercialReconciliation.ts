import { createHash } from "node:crypto";
import type { QuoteLineItem } from "@prisma/client";
import { calculateCommercialTotals, type CommercialLine, type CommercialScenario } from "@/lib/commercialQuote";
import { prisma } from "@/lib/prisma";

export type CommercialReconciliation = {
  organizationId: string;
  quotesChecked: number;
  versionsChecked: number;
  ownershipMismatches: number;
  pointerMismatches: number;
  totalMismatches: number;
  checksumMismatches: number;
  catalogRevisionMismatches: number;
  discrepancies: number;
};

export async function reconcileCommercialQuotes(
  organizationId: string,
): Promise<CommercialReconciliation> {
  const quotes = await prisma.quote.findMany({
    where: {
      organizationId,
      status: { not: "LEGACY_INCOMPLETE" },
    },
    include: {
      meeting: {
        select: {
          organizationId: true,
          caseId: true,
          ownerMembershipId: true,
        },
      },
      case: {
        select: {
          tenantId: true,
          scenarioId: true,
        },
      },
      ownerMembership: {
        select: {
          organizationId: true,
        },
      },
      activeDraftVersion: {
        include: {
          lineItems: {
            include: {
              catalogRevision: { select: { catalogItemId: true } },
            },
          },
        },
      },
      latestPublishedVersion: {
        include: {
          lineItems: {
            include: {
              catalogRevision: { select: { catalogItemId: true } },
            },
          },
        },
      },
      versions: {
        where: {
          state: { in: ["PUBLISHED", "SUPERSEDED", "EXPIRED"] },
        },
        include: {
          lineItems: {
            include: {
              catalogRevision: { select: { catalogItemId: true } },
            },
          },
        },
      },
    },
  });

  let ownershipMismatches = 0;
  let pointerMismatches = 0;
  let totalMismatches = 0;
  let checksumMismatches = 0;
  let catalogRevisionMismatches = 0;
  let versionsChecked = 0;

  for (const quote of quotes) {
    if (
      !quote.case
      || !quote.caseId
      || !quote.ownerMembership
      || quote.case.tenantId !== organizationId
      || quote.ownerMembership.organizationId !== organizationId
      || quote.meeting.organizationId !== organizationId
      || quote.meeting.caseId !== quote.caseId
      || quote.meeting.ownerMembershipId !== quote.ownerMembershipId
      || quote.case.scenarioId !== quote.scenario
    ) {
      ownershipMismatches += 1;
    }

    if (
      quote.activeDraftVersion && quote.activeDraftVersion.state !== "DRAFT"
      || quote.latestPublishedVersion && quote.latestPublishedVersion.state !== "PUBLISHED"
      || quote.activeDraftVersion && quote.activeDraftVersion.quoteId !== quote.id
      || quote.latestPublishedVersion && quote.latestPublishedVersion.quoteId !== quote.id
    ) {
      pointerMismatches += 1;
    }

    const scenario = quote.scenario as CommercialScenario;
    const versions = [
      ...(quote.activeDraftVersion ? [quote.activeDraftVersion] : []),
      ...quote.versions,
    ];
    for (const version of versions) {
      versionsChecked += 1;
      const lines = version.lineItems.map(toCommercialLine);
      const totals = calculateCommercialTotals(lines, scenario);
      const storedTotal = totals.total ?? totals.subtotal - totals.discountTotal;
      if (
        version.subtotal !== totals.subtotal
        || version.discountTotal !== totals.discountTotal
        || version.total !== storedTotal
        || version.totalState !== totals.totalState
      ) {
        totalMismatches += 1;
      }
      if (
        version.state !== "DRAFT"
        && version.snapshotChecksum !== createHash("sha256").update(version.payload).digest("hex")
      ) {
        checksumMismatches += 1;
      }
      catalogRevisionMismatches += version.lineItems.filter((line) => (
        line.catalogRevision
        && line.catalogItemId
        && line.catalogRevision.catalogItemId !== line.catalogItemId
      )).length;
    }
  }

  const discrepancies = ownershipMismatches
    + pointerMismatches
    + totalMismatches
    + checksumMismatches
    + catalogRevisionMismatches;

  return {
    organizationId,
    quotesChecked: quotes.length,
    versionsChecked,
    ownershipMismatches,
    pointerMismatches,
    totalMismatches,
    checksumMismatches,
    catalogRevisionMismatches,
    discrepancies,
  };
}

function toCommercialLine(line: QuoteLineItem): CommercialLine {
  const compatibility = Array.isArray(line.scenarioCompatibility)
    ? line.scenarioCompatibility.filter(
        (value): value is CommercialScenario =>
          value === "CREMATION_V1" || value === "FAMILY_PLOT_BURIAL_V1",
      )
    : [];
  return {
    stableKey: line.stableKey,
    position: line.position,
    type: line.type,
    catalogItemId: line.catalogItemId,
    catalogRevisionId: line.catalogRevisionId,
    serviceCode: line.serviceCode,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    priceState: line.priceState,
    clientUnitPrice: line.clientUnitPrice,
    costState: line.costState,
    unitCost: line.unitCost,
    discountAmount: line.discountAmount,
    included: line.included,
    optional: line.optional,
    relationKind: line.relationKind,
    relationKey: line.relationKey,
    source: line.source,
    sourceVersion: line.sourceVersion,
    scenarioCompatibility: compatibility,
  };
}
