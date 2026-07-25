import { test } from "node:test";
import assert from "node:assert/strict";
import { IDS, MONEY, NOW, PAST_MEETING, eventEnvelope } from "./fixtures/productTruth";
import { InMemoryTestStorage } from "./fixtures/testStorage";
import { isIsolatedTestDatabase } from "./integration/testDatabaseSafety";
import { productionRegistrationRequiresInvite } from "../lib/invitations";
import { isDemoMode } from "../lib/demo";
import { dateTime } from "../lib/format";
import { zonedLocalInput, zonedLocalToIso } from "../lib/zonedDateTime";

type MoneyValue = { kind: "KNOWN"; kopecks: number } | { kind: "UNKNOWN" };
type QuoteVersion = { id: string; state: "DRAFT" | "PUBLISHED"; total: MoneyValue };
type PaymentEntry = { id: string; amountKopecks: number; reversesEntryId?: string };

function clientQuote(versions: QuoteVersion[], publishedVersionId: string | null) {
  return versions.find((version) => version.id === publishedVersionId && version.state === "PUBLISHED") ?? null;
}

function canPublish(prices: MoneyValue[]) {
  return prices.length > 0 && prices.every((price) => price.kind === "KNOWN" && Number.isFinite(price.kopecks) && price.kopecks >= 0);
}

function quoteSurfacesConsistent(publishedVersionId: string, surfaceVersionIds: string[]) {
  return surfaceVersionIds.length > 0 && surfaceVersionIds.every((id) => id === publishedVersionId);
}

function paymentStatus(obligationKopecks: number, entries: PaymentEntry[]) {
  const paid = entries.reduce((sum, entry) => sum + entry.amountKopecks, 0);
  if (paid <= 0) return "UNPAID";
  if (paid < obligationKopecks) return "PARTIALLY_PAID";
  return "PAID";
}

function appendCorrection(entries: PaymentEntry[], originalId: string, amountKopecks: number) {
  assert.ok(entries.some((entry) => entry.id === originalId), "original entry must exist");
  return [...entries, { id: `correction-${entries.length + 1}`, amountKopecks, reversesEntryId: originalId }];
}

function margin(clientPrice: MoneyValue, cost: MoneyValue) {
  if (clientPrice.kind === "UNKNOWN" || cost.kind === "UNKNOWN") return null;
  return clientPrice.kopecks - cost.kopecks;
}

function documentProjection(requirementIds: string[], uploadedIds: string[], verifiedIds: string[]) {
  const uploaded = new Set(uploadedIds);
  const verified = new Set(verifiedIds);
  return {
    required: requirementIds.length,
    uploaded: requirementIds.filter((id) => uploaded.has(id)).length,
    verified: requirementIds.filter((id) => verified.has(id)).length,
    ready: requirementIds.length > 0 && requirementIds.every((id) => verified.has(id)),
  };
}

function projectTaskCompletion(processedKeys: Set<string>, idempotencyKey: string) {
  if (processedKeys.has(idempotencyKey)) return 0;
  processedKeys.add(idempotencyKey);
  return 1;
}

type PilotScenario = "CREMATION" | "FAMILY_PLOT_BURIAL";

const REQUIRED_GUARDS: Record<PilotScenario, string[]> = {
  CREMATION: ["identity_verified", "death_document_verified", "cremation_authorization_verified", "crematorium_confirmed", "contract_signed", "payment_satisfied"],
  FAMILY_PLOT_BURIAL: ["identity_verified", "death_document_verified", "plot_entitlement_verified", "relationship_verified", "cemetery_confirmed", "contract_signed", "payment_satisfied"],
};

function canCloseCase(scenario: PilotScenario, satisfiedGuards: string[]) {
  const satisfied = new Set(satisfiedGuards);
  return REQUIRED_GUARDS[scenario].every((guard) => satisfied.has(guard));
}

function projectMeetingEscalation(status: string, scheduledAt: string, now: string, processedKeys: Set<string>) {
  if (status !== "SCHEDULED" || new Date(scheduledAt) >= new Date(now)) return 0;
  return projectTaskCompletion(processedKeys, `meeting-overdue:${scheduledAt}`);
}

function validEventEnvelope(value: ReturnType<typeof eventEnvelope>) {
  return Boolean(
    value.organizationId && value.actor.id && value.occurredAt && value.idempotencyKey &&
    value.correlationId && "before" in value && "after" in value,
  );
}

test("PT-001 client projection ignores transient draft and reads published snapshot", () => {
  const versions: QuoteVersion[] = [
    { id: IDS.publishedVersionId, state: "PUBLISHED", total: { kind: "KNOWN", kopecks: 2_500_000 } },
    { id: IDS.draftVersionId, state: "DRAFT", total: { kind: "KNOWN", kopecks: 3_100_000 } },
  ];
  assert.deepEqual(clientQuote(versions, IDS.publishedVersionId)?.total, { kind: "KNOWN", kopecks: 2_500_000 });
});

test("PT-002 unknown price remains unknown and blocks publication", () => {
  assert.equal(canPublish([{ kind: "KNOWN", kopecks: MONEY.knownPriceKopecks }, { kind: "UNKNOWN" }]), false);
  assert.equal(canPublish([{ kind: "KNOWN", kopecks: MONEY.knownPriceKopecks }]), true);
});

test("PT-003 all quote surfaces must reference one version ID", () => {
  assert.equal(quoteSurfacesConsistent(IDS.publishedVersionId, [IDS.publishedVersionId, IDS.publishedVersionId]), true);
  assert.equal(quoteSurfacesConsistent(IDS.publishedVersionId, [IDS.publishedVersionId, IDS.draftVersionId]), false);
});

test("PT-004 quote publication closes its projected task exactly once", () => {
  const processed = new Set<string>();
  assert.equal(projectTaskCompletion(processed, "publish-001"), 1);
  assert.equal(projectTaskCompletion(processed, "publish-001"), 0);
});

test("PT-005 partial advance cannot produce PAID", () => {
  const entries = [{ id: "advance-001", amountKopecks: MONEY.advanceKopecks }];
  assert.equal(paymentStatus(MONEY.obligationKopecks, entries), "PARTIALLY_PAID");
});

test("PT-006 financial correction appends and preserves original entry", () => {
  const entries = [{ id: "payment-001", amountKopecks: MONEY.advanceKopecks }];
  const corrected = appendCorrection(entries, "payment-001", -MONEY.advanceKopecks);
  assert.equal(corrected.length, 2);
  assert.equal(corrected[0].id, "payment-001");
  assert.equal(paymentStatus(MONEY.obligationKopecks, corrected), "UNPAID");
});

test("PT-007 uploaded document does not satisfy a verified requirement", () => {
  const uploaded = documentProjection(["death-certificate"], ["death-certificate"], []);
  assert.deepEqual(uploaded, { required: 1, uploaded: 1, verified: 0, ready: false });
  const verified = documentProjection(["death-certificate"], ["death-certificate"], ["death-certificate"]);
  assert.deepEqual(verified, { required: 1, uploaded: 1, verified: 1, ready: true });
});

test("PT-008 unknown cost produces unknown margin, never false 100% margin", () => {
  assert.equal(margin({ kind: "KNOWN", kopecks: MONEY.knownPriceKopecks }, { kind: "UNKNOWN" }), null);
  assert.equal(margin({ kind: "KNOWN", kopecks: MONEY.knownPriceKopecks }, { kind: "KNOWN", kopecks: 0 }), MONEY.knownPriceKopecks);
});

test("PT-009 past scheduled meeting requires escalation", () => {
  const processed = new Set<string>();
  assert.equal(projectMeetingEscalation("SCHEDULED", PAST_MEETING, NOW, processed), 1);
  assert.equal(projectMeetingEscalation("SCHEDULED", PAST_MEETING, NOW, processed), 0);
  assert.equal(projectMeetingEscalation("COMPLETED", PAST_MEETING, NOW, processed), 0);
});

test("PT-010 case cannot close while a scenario guard is missing", () => {
  const cremationGuards = REQUIRED_GUARDS.CREMATION.filter((guard) => guard !== "cremation_authorization_verified");
  const burialGuards = REQUIRED_GUARDS.FAMILY_PLOT_BURIAL.filter((guard) => guard !== "plot_entitlement_verified");
  assert.equal(canCloseCase("CREMATION", cremationGuards), false);
  assert.equal(canCloseCase("FAMILY_PLOT_BURIAL", burialGuards), false);
  assert.equal(canCloseCase("CREMATION", REQUIRED_GUARDS.CREMATION), true);
  assert.equal(canCloseCase("FAMILY_PLOT_BURIAL", REQUIRED_GUARDS.FAMILY_PLOT_BURIAL), true);
});

test("PT-011 event envelope carries tenant, actor, time, idempotency and correlation", () => {
  const event = eventEnvelope("quote.published.v1", "publish-001");
  assert.equal(validEventEnvelope(event), true);
  assert.equal(event.organizationId, IDS.organizationId);
  assert.equal(event.actor.type, "agent");
  assert.equal(event.eventVersion, 1);
  assert.ok(event.occurredAt);
  assert.ok(event.idempotencyKey);
  assert.ok(event.correlationId);
  assert.equal(event.before, null);
  assert.deepEqual(event.after, { state: "PUBLISHED" });
});

test("test storage fixture is isolated and deterministic", () => {
  const storage = new InMemoryTestStorage();
  const input = new Uint8Array([1, 2, 3]);
  assert.deepEqual(storage.putBytes("document-version-001", input), {
    key: "document-version-001",
    checksumInput: [1, 2, 3],
  });
  assert.deepEqual(storage.get("document-version-001"), input);
  storage.clear();
  assert.equal(storage.get("document-version-001"), null);
});

test("integration DB guard allows only approved exact local test databases", () => {
  assert.equal(isIsolatedTestDatabase("postgresql://postgres:postgres@127.0.0.1:5432/td_agent_test"), true);
  assert.equal(isIsolatedTestDatabase("postgresql://local@127.0.0.1:5432/td_agent_m1_local_20260718"), true);
  assert.equal(isIsolatedTestDatabase("postgresql://postgres:postgres@localhost:5432/td_agent_prod"), false);
  assert.equal(isIsolatedTestDatabase("postgresql://local@127.0.0.1:5432/td_agent_m1_local_20260718_copy"), false);
  assert.equal(isIsolatedTestDatabase("postgresql://user:pass@example.com/td_agent_test"), false);
  assert.equal(isIsolatedTestDatabase(undefined), false);
});

test("M1 production registration is invite-only", () => {
  assert.equal(productionRegistrationRequiresInvite("production"), true);
  assert.equal(productionRegistrationRequiresInvite("development"), false);
  assert.equal(productionRegistrationRequiresInvite("test"), false);
});

test("M1 demo authentication is explicitly enabled, never inferred", () => {
  assert.equal(isDemoMode("1"), true);
  assert.equal(isDemoMode("0"), false);
  assert.equal(isDemoMode(""), false);
  assert.equal(isDemoMode(), process.env.DEMO_MODE === "1");
});

test("M1 organization timezone round-trips case ceremony input and display", () => {
  const local = "2026-07-22T10:30";
  const iso = zonedLocalToIso(local, "Asia/Yekaterinburg");
  assert.equal(iso, "2026-07-22T05:30:00.000Z");
  assert.equal(zonedLocalInput(iso!, "Asia/Yekaterinburg"), local);
  assert.equal(dateTime(iso, "Asia/Yekaterinburg"), "22 июля, 10:30");
  assert.equal(dateTime(iso, "Europe/Moscow"), "22 июля, 08:30");
});
