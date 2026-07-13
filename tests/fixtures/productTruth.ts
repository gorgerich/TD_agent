export const IDS = {
  organizationId: "org-test-001",
  caseId: "case-test-001",
  quoteId: "quote-test-001",
  draftVersionId: "quote-version-draft-001",
  publishedVersionId: "quote-version-published-001",
  obligationId: "obligation-test-001",
  taskId: "task-send-quote-001",
} as const;

export const MONEY = {
  obligationKopecks: 17_600_000,
  advanceKopecks: 8_800_000,
  knownPriceKopecks: 2_500_000,
} as const;

export const NOW = "2026-07-13T09:00:00.000Z";
export const PAST_MEETING = "2026-07-12T09:00:00.000Z";

export function eventEnvelope(eventType: string, idempotencyKey: string) {
  return {
    eventId: `event-${idempotencyKey}`,
    eventType,
    eventVersion: 1 as const,
    aggregateType: "Case",
    aggregateId: IDS.caseId,
    organizationId: IDS.organizationId,
    actor: { type: "agent" as const, id: "agent-test-001" },
    occurredAt: NOW,
    idempotencyKey,
    correlationId: "correlation-test-001",
    before: null,
    after: { state: "PUBLISHED" },
    payload: {},
  };
}
