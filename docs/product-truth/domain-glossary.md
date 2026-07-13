# Domain glossary and identity

| Term | Definition | Stable identity / relation |
| --- | --- | --- |
| Organization | Tenant owning all business data and access policy. | `organizationId`; required on every aggregate. Not present in current schema. |
| Agent | Authenticated operator working for one organization. | `agentId -> organizationId`; current `Agent.id`. |
| Case | Durable unit of work for one family situation. | `caseId`; current temporary implementation is `ClientLead.id`. |
| Person / Contact Role | Person participating in a case with an explicit role and permissions. | `personId`, `casePersonId`; not a name or phone lookup. |
| Deceased | Structured deceased-person record attached to a case. | `deceasedId -> caseId`; currently flattened into `ClientLead`. |
| Scenario | Versioned operational policy for cremation or family-plot burial. | `scenarioKey + scenarioVersion`. |
| Meeting | Scheduled interaction with an outcome, linked to a case. | `meetingId -> caseId`; current `Meeting.id -> leadId`. |
| Task | Required action, manual or projected from a domain event. | `taskId -> caseId`; projected tasks also hold `sourceEventId`. |
| Quote | Mutable aggregate containing one working draft and immutable versions. | `quoteId -> caseId`. Current relation is through `meetingId`. |
| Quote Version | Immutable snapshot of composition, prices, policy and totals. | `quoteVersionId -> quoteId`; published identity never changes. |
| Contract | Agreement bound to one published quote version. | `contractId -> caseId, quoteVersionId`; missing in current schema. |
| Payment Entry | Append-only financial ledger entry or reversal/correction. | `paymentEntryId -> caseId, obligationId`; never deleted. |
| Document Requirement | Scenario/version-specific rule describing evidence needed. | `requirementId -> scenarioVersion`. Missing today. |
| Document Version | Immutable uploaded file version with independent verification state. | `documentVersionId -> requirementId, caseId`. |
| Catalog Item | Versioned sellable/costable item; unknown values stay unknown. | `catalogItemId + catalogVersion`; current `AgentCatalogItem.id`. |
| Vendor | External organization fulfilling an item or expense. | `vendorId -> organizationId`; absent today. |
| Domain Event | Immutable fact emitted after an accepted mutation. | `eventId`, `eventType`, `eventVersion`, `aggregateId`. |

## Identity rules

1. Relationships use IDs, never display names, array indexes or selected UI rows.
2. A co-view code is a revocable access token, not an aggregate ID.
3. `AgentSession.state` is transient presentation state, never quote truth.
4. A meeting does not own the case or define its lifecycle.
5. Published quote, contract and payment references are immutable IDs.
6. Every aggregate must carry tenant ownership before real multi-organization pilot data.
