import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const runId = process.env.M1_UAT_RUN_ID ?? "mission-1";
const email = process.env.E2E_AGENT_EMAIL ?? `m1-agent-${runId}@synthetic.invalid`;
const managerEmail = process.env.E2E_MANAGER_EMAIL ?? `m1-manager-${runId}@synthetic.invalid`;
const password = process.env.M1_UAT_PASSWORD;
const rbacRunId = process.env.M2_UAT_RUN_ID;
const foreignEmail = rbacRunId ? `m2-second-${rbacRunId}@synthetic.invalid` : null;
const foreignPassword = process.env.M2_UAT_PASSWORD;
/**
 * Intl.NumberFormat("ru-RU") groups thousands with U+00A0, and newer ICU builds use
 * U+202F, so a raw textContent() comparison against a plain-space literal fails on money
 * that renders identically. Playwright's own text matchers normalize whitespace; do the
 * same wherever we compare textContent() by hand.
 */
const normalizeText = (value) => (value ?? "").replace(/\s+/g, " ").trim();

/** Bounded retries for a login the rate limiter throttled. See login(). */
const LOGIN_RATE_LIMIT_ATTEMPTS = 3;

if (!password) throw new Error("M1_UAT_PASSWORD is required for M2 commercial E2E");
if (!foreignEmail || !foreignPassword) {
  throw new Error("M2_UAT_RUN_ID and M2_UAT_PASSWORD are required for commercial cross-tenant E2E");
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1365, height: 900 },
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
});
const page = await context.newPage();
const browserErrors = [];
// Two probes deliberately drive a non-2xx response through an in-page fetch: the
// unknown-price publish block (422) and the cross-tenant quote read (404). Chromium logs
// a resource-load console error for each. The explicit status assertions are what prove
// the behaviour, so account for that noise here instead of treating it as a page defect.
let expectedPublishBlocks = 0;
let expectedCrossTenantMisses = 0;
let throttledLogins = 0;
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const location = message.location().url;
  if (message.text().includes("status of 422") && location.includes("/api/agent/quotes/")) {
    expectedPublishBlocks += 1;
    return;
  }
  if (message.text().includes("status of 404") && location.includes("/api/agent/meeting/")) {
    expectedCrossTenantMisses += 1;
    return;
  }
  // login() handles a throttled login by honouring Retry-After and trying again. The
  // browser still logs the 429 it received. Whether it happens at all depends on how many
  // logins the earlier suites spent from the shared bucket, so this is accounted for but
  // never required.
  if (message.text().includes("status of 429") && location.includes("/api/agent/auth/login")) {
    throttledLogins += 1;
    return;
  }
  browserErrors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

try {
  await login(page, email, password);
  const cremation = await commercialJourney(page, "Семья Кремова · синтетика", "CREMATION_V1", true);
  const burial = await commercialJourney(page, "Семья Участкова · синтетика", "FAMILY_PLOT_BURIAL_V1", false);

  await page.goto(`${baseUrl}/agent/estimates`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Сметы", exact: true }).waitFor();
  await page.getByText(/v2/).first().waitFor();
  await assertA11y(page, "quote registry");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/co/${burial.token}`, { waitUntil: "networkidle" });
  await page.getByText("Опубликована версия 1", { exact: true }).waitFor();
  await assertNoOverflow(page, "client quote mobile");
  await assertA11y(page, "client quote mobile");

  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await assertNoOverflow(page, "client quote 200 percent zoom");
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });

  await context.clearCookies();
  await login(page, managerEmail, password);
  await page.goto(`${baseUrl}/agent/estimates`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Сметы", exact: true }).waitFor();
  await page.getByText(/v2/).first().waitFor();
  const managerQuote = await readQuoteStatus(page, cremation.meetingId);
  assert.equal(managerQuote, 200, "Manager must read the tenant commercial aggregate");

  await context.clearCookies();
  await login(page, foreignEmail, foreignPassword);
  await page.goto(`${baseUrl}/agent/estimates`, { waitUntil: "domcontentloaded" });
  const foreignQuote = await readQuoteStatus(page, cremation.meetingId);
  assert.equal(foreignQuote, 404, "Another organization must not discover the quote");

  assert.deepEqual(browserErrors, [], `Unexpected browser errors:\n${browserErrors.join("\n")}`);
  assert.ok(expectedPublishBlocks >= 1, "Unknown-price publish must be observed as blocked in the browser");
  assert.ok(expectedCrossTenantMisses >= 1, "Cross-tenant quote read must be observed as not found in the browser");
  process.stdout.write(`${JSON.stringify({
    cremation: cremation.status,
    relativeBurial: burial.status,
    draftPublishedIsolation: "PASS",
    clientDecision: "PASS",
    print: "PASS",
    accessibilityCriticalSerious: 0,
    mobile: "PASS",
    zoom200: "PASS",
    managerContext: "PASS",
    crossTenant: "PASS",
    throttledLoginsRetried: throttledLogins,
    skipped: 0,
  })}\n`);
} finally {
  await context.close();
  await browser.close();
}

/**
 * `npm run test:e2e` runs four suites back to back against one server, and the login route
 * allows 10 attempts per minute per client IP — every suite shares that bucket. Crossing it
 * is the rate limiter working correctly, not a product defect, so the test cooperates with
 * it: honour Retry-After and try again, exactly as a real client would.
 *
 * The backoff is deliberately narrow. Only 429 is retried; any other non-2xx login response
 * fails immediately with its status, so a genuinely broken login can never be mistaken for
 * throttling and silently waited out.
 */
async function login(target, identity, identityPassword) {
  for (let attempt = 1; ; attempt += 1) {
    await target.goto(`${baseUrl}/agent/login`, { waitUntil: "networkidle" });
    await target.locator("#agent-email").fill(identity);
    await target.locator("#agent-password").fill(identityPassword);
    const [response] = await Promise.all([
      target.waitForResponse((res) => res.url().includes("/api/agent/auth/login") && res.request().method() === "POST"),
      target.locator('form button[type="submit"]').click(),
    ]);
    if (response.status() === 429) {
      assert.ok(
        attempt < LOGIN_RATE_LIMIT_ATTEMPTS,
        `login for ${identity} stayed rate limited after ${attempt} attempts`,
      );
      const retryAfter = Number(response.headers()["retry-after"] ?? 60);
      await target.waitForTimeout((Number.isFinite(retryAfter) ? retryAfter : 60) * 1000 + 1_000);
      continue;
    }
    assert.equal(response.status(), 200, `login for ${identity} failed with ${response.status()}`);
    await target.waitForURL(/\/agent\/cases(?:\?|$)/);
    return;
  }
}

async function commercialJourney(target, clientName, scenario, requireSecondVersion) {
  const meetingId = await findMeetingId(target, clientName);
  if (!requireSecondVersion) {
    await assertUnknownPriceBlocksPublish(target, meetingId, scenario);
  }
  const first = await saveReviewPublish(target, meetingId, scenario, 125_000, "v1");
  assert.equal(first.versionNumber, 1);
  const linkV1 = await createLink(target, first.quoteId, "v1");

  await target.goto(`${baseUrl}/co/${linkV1.token}`, { waitUntil: "networkidle" });
  await target.getByText("Опубликована версия 1", { exact: true }).waitFor();
  await target.getByText("1 250 ₽", { exact: true }).first().waitFor();
  await assertA11y(target, `${scenario} published v1`);

  let finalToken = linkV1.token;
  if (requireSecondVersion) {
    await target.getByRole("button", { name: "Запросить изменения" }).click();
    await target.getByLabel("Что нужно изменить").fill("Уточнить состав транспорта");
    await target.getByRole("button", { name: "Передать агенту" }).click();
    await target.getByText("Изменения переданы агенту", { exact: true }).waitFor();

    await saveDraftOnly(target, meetingId, scenario, 140_000, "autosave-v2");
    const publishedStillV1 = await target.request.get(`${baseUrl}/api/co/${linkV1.token}`);
    assert.equal(publishedStillV1.status(), 200, "Draft v2 must not revoke Published v1");
    assert.equal((await publishedStillV1.json()).version.versionNumber, 1);
    const second = await saveReviewPublish(target, meetingId, scenario, 140_000, "v2");
    assert.equal(second.quoteId, first.quoteId);
    assert.equal(second.versionNumber, 2);
    const stale = await target.request.get(`${baseUrl}/api/co/${linkV1.token}`);
    assert.equal(stale.status(), 404, "Superseded v1 link must be revoked");
    const linkV2 = await createLink(target, first.quoteId, "v2");
    finalToken = linkV2.token;
    await target.goto(`${baseUrl}/co/${finalToken}`, { waitUntil: "networkidle" });
    await target.getByText("Опубликована версия 2", { exact: true }).waitFor();
  } else {
    await target.evaluate(() => {
      window.__m2PrintCalled = false;
      window.print = () => { window.__m2PrintCalled = true; };
    });
    await target.getByRole("button", { name: "Печать / PDF" }).click();
    assert.equal(await target.evaluate(() => window.__m2PrintCalled), true, "Print action must be wired");
  }

  await target.goto(`${baseUrl}/agent/meetings/${meetingId}/quote`, { waitUntil: "networkidle" });
  await target.getByTestId("quote-visible-total").waitFor();
  assert.equal(
    normalizeText(await target.getByTestId("quote-visible-total").textContent()),
    `${requireSecondVersion ? "1 400" : "1 250"} ₽`,
    "Builder total must equal the latest immutable Published version",
  );

  await target.goto(`${baseUrl}/co/${finalToken}`, { waitUntil: "networkidle" });
  await target.getByRole("button", { name: "Принять смету" }).click();
  await target.getByText("Смета принята", { exact: true }).waitFor();
  return { status: "PASS", token: finalToken, meetingId };
}

async function findMeetingId(target, clientName) {
  await target.goto(`${baseUrl}/agent/meetings`, { waitUntil: "networkidle" });
  const toggle = target.locator("button.td-entity-row")
    .filter({ hasText: clientName })
    .filter({ hasNotText: "Церемония" });
  await toggle.waitFor();
  const row = toggle.locator("..");
  await toggle.click();
  const href = await row.getByRole("link", { name: "Встреча", exact: true }).getAttribute("href");
  const match = href?.match(/\/agent\/meetings\/(\d+)/);
  if (!match) throw new Error(`Meeting ID missing for ${clientName}`);
  return Number(match[1]);
}

async function saveReviewPublish(target, meetingId, scenario, price, suffix) {
  const saved = await saveDraftOnly(target, meetingId, scenario, price, suffix);
  return target.evaluate(async ({ quoteId, keySuffix }) => {
    const command = async (url, body, key) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          "X-Correlation-Id": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`${url}: ${result.error ?? response.status}`);
      return result;
    };
    const runKey = `e2e-m2:${quoteId}:${keySuffix}`;
    await command(`/api/agent/quotes/${quoteId}/review`, undefined, `${runKey}:review`);
    return command(`/api/agent/quotes/${quoteId}/publish`, {
      validUntil: new Date(Date.now() + 86_400_000).toISOString(),
      channel: "link",
      reason: "Synthetic browser UAT",
    }, `${runKey}:publish`);
  }, { quoteId: saved.quoteId, keySuffix: suffix });
}

async function saveDraftOnly(target, meetingId, scenario, price, suffix, priceState = "KNOWN") {
  return target.evaluate(async ({
    meetingId: id,
    scenario: quoteScenario,
    price: unitPrice,
    suffix: keySuffix,
    priceState: valueState,
  }) => {
    const command = async (url, body, key) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          "X-Correlation-Id": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`${url}: ${result.error ?? response.status}`);
      return result;
    };
    const runKey = `e2e-m2:${id}:${keySuffix}`;
    const saved = await command(`/api/agent/meeting/${id}/quote`, {
      scenario: quoteScenario,
      lines: [{
        stableKey: `e2e:${quoteScenario}:service`,
        position: 0,
        type: "SERVICE",
        serviceCode: `e2e:${quoteScenario}`,
        description: quoteScenario === "CREMATION_V1" ? "Организация кремации" : "Организация родственного захоронения",
        quantity: 1,
        unit: "услуга",
        priceState: valueState,
        clientUnitPrice: valueState === "KNOWN" ? unitPrice : null,
        costState: "KNOWN",
        unitCost: 80_000,
        discountAmount: 0,
        included: false,
        optional: false,
        relationKind: "STANDALONE",
        source: "e2e-catalog",
        sourceVersion: "1",
        scenarioCompatibility: [quoteScenario],
      }],
      editorState: { e2e: true, scenario: quoteScenario },
    }, `${runKey}:draft`);
    return saved;
  }, { meetingId, scenario, price, suffix, priceState });
}

/**
 * Playwright's APIRequestContext (`page.request`) does not attach the SameSite=Lax session
 * cookie, so every authenticated call in this journey goes through an in-page fetch, which
 * carries the cookie exactly as the real browser does.
 */
function readQuoteStatus(target, meetingId) {
  return target.evaluate(
    async (id) => (await fetch(`/api/agent/meeting/${id}/quote`)).status,
    meetingId,
  );
}

async function assertUnknownPriceBlocksPublish(target, meetingId, scenario) {
  const saved = await saveDraftOnly(target, meetingId, scenario, 0, "unknown-price", "UNKNOWN");
  const review = await target.evaluate(async (quoteId) => {
    const key = `e2e-m2:${quoteId}:unknown-review`;
    const res = await fetch(`/api/agent/quotes/${quoteId}/review`, {
      method: "POST",
      headers: { "Idempotency-Key": key, "X-Correlation-Id": key },
    });
    return { status: res.status };
  }, saved.quoteId);
  assert.equal(review.status, 200, "Unknown-price review must remain inspectable");
  const publish = await target.evaluate(async (quoteId) => {
    const key = `e2e-m2:${quoteId}:unknown-publish`;
    const res = await fetch(`/api/agent/quotes/${quoteId}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        "X-Correlation-Id": key,
      },
      body: JSON.stringify({
        validUntil: new Date(Date.now() + 86_400_000).toISOString(),
        channel: "link",
        reason: "Must remain blocked",
      }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, saved.quoteId);
  assert.equal(publish.status, 422);
  assert.match(publish.body.error ?? "", /не подтверждена/);
}

async function createLink(target, quoteId, suffix) {
  return target.evaluate(async ({ quoteId: id, suffix: keySuffix }) => {
    const key = `e2e-m2:${id}:link:${keySuffix}`;
    const response = await fetch(`/api/agent/quotes/${id}/link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        "X-Correlation-Id": key,
      },
      body: JSON.stringify({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Client link failed");
    return result;
  }, { quoteId, suffix });
}

async function assertA11y(target, label) {
  await target.addScriptTag({ path: axePath });
  const violations = await target.evaluate(async () => {
    const result = await globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return result.violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      }));
  });
  assert.deepEqual(violations, [], `${label} accessibility violations: ${JSON.stringify(violations)}`);
}

async function assertNoOverflow(target, label) {
  const dimensions = await target.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth + 1, `${label} overflow: ${JSON.stringify(dimensions)}`);
}
