import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const runId = (process.env.M3_UAT_RUN_ID ?? "mission-3").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
const password = process.env.M3_UAT_PASSWORD;
const webhookSecret = process.env.M3_PAYMENT_WEBHOOK_SECRET;
const mfaSecret = process.env.M3_UAT_MFA_SECRET;
if (!password || password.length < 32) throw new Error("M3_UAT_PASSWORD is required");
if (!webhookSecret || webhookSecret.length < 32) throw new Error("M3_PAYMENT_WEBHOOK_SECRET is required");
if (!mfaSecret || !/^[A-Z2-7]{32,}$/.test(mfaSecret)) throw new Error("M3_UAT_MFA_SECRET is required");

const identities = {
  agent: `m3-agent-${runId}@synthetic.invalid`,
  manager: `m3-manager-${runId}@synthetic.invalid`,
  reviewer: `m3-reviewer-${runId}@synthetic.invalid`,
  financeA: `m3-finance-a-${runId}@synthetic.invalid`,
  financeB: `m3-finance-b-${runId}@synthetic.invalid`,
  foreign: `m3-foreign-${runId}@synthetic.invalid`,
};
const cases = {
  cremation: {
    name: "Кремация M3 · синтетика",
    publicRef: `M3-${runId.toUpperCase()}-C`,
    canonicalId: `m3-uat-case:${runId}:cremation`,
    requirements: [
      "Документ, удостоверяющий личность",
      "Документ о смерти",
      "Основание для кремации",
    ],
  },
  burial: {
    name: "Родственное захоронение M3 · синтетика",
    publicRef: `M3-${runId.toUpperCase()}-B`,
    canonicalId: `m3-uat-case:${runId}:burial`,
    requirements: [
      "Документ, удостоверяющий личность",
      "Документ о смерти",
      "Право на родственный участок",
      "Подтверждение родства",
    ],
  },
};

const browser = await chromium.launch({ headless: true });
const protectionBypass = process.env.E2E_PROTECTION_BYPASS?.trim();
const context = await browser.newContext({
  viewport: { width: 1365, height: 900 },
  locale: "ru-RU",
  timezoneId: "Europe/Moscow",
  ...(protectionBypass ? { extraHTTPHeaders: { "x-vercel-protection-bypass": protectionBypass } } : {}),
});
const page = await context.newPage();
const pageErrors = [];
const unexpected5xx = [];
let expectedStorageFailure = false;
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("response", (response) => {
  if (response.status() < 500) return;
  if (expectedStorageFailure && response.url().includes("/documents")) return;
  unexpected5xx.push(`${response.status()} ${new URL(response.url()).pathname}`);
});

try {
  await login(page, identities.agent, password, /\/agent\/cases/);
  const cremation = await prepareAgentCase(page, cases.cremation, {
    roles: ["Заявитель", "Плательщик"],
    partyName: "Синтетический плательщик кремации",
    exerciseFailure: true,
    exerciseQuarantine: true,
  });
  const burial = await prepareAgentCase(page, cases.burial, {
    roles: ["Заявитель", "Принимает решения", "Плательщик", "Ответственный за захоронение"],
    partyName: "Синтетический плательщик захоронения",
    exerciseFailure: false,
    exerciseQuarantine: false,
  });

  await context.clearCookies();
  await login(page, identities.reviewer, password, /\/agent\/document-review/);
  await assertReviewerPrivacy(page);
  for (const requirement of cases.cremation.requirements) await reviewDocument(page, cases.cremation.publicRef, requirement, "VERIFY");
  for (const requirement of cases.burial.requirements) {
    if (requirement === "Право на родственный участок") await reviewDocument(page, cases.burial.publicRef, requirement, "REJECT");
    else await reviewDocument(page, cases.burial.publicRef, requirement, "VERIFY");
  }

  await context.clearCookies();
  await login(page, identities.agent, password, /\/agent\/cases/);
  await replaceRejectedDocument(page, cases.burial, "Право на родственный участок");
  await context.clearCookies();
  await login(page, identities.reviewer, password, /\/agent\/document-review/);
  await reviewDocument(page, cases.burial.publicRef, "Право на родственный участок", "VERIFY");

  await context.clearCookies();
  await login(page, identities.agent, password, /\/agent\/cases/);
  const cremationContract = await completeContract(page, cases.cremation, cremation.leadId);
  await completeContract(page, cases.burial, burial.leadId);

  await context.clearCookies();
  await login(page, identities.financeA, password, /\/agent\/finance/);
  await assertFinancePrivacy(page);
  await recordPayment(page, cases.cremation.publicRef, 88_000, "Synthetic partial payment");
  const webhook = await replayWebhookFiveTimes(context, {
    organizationId: `m3-uat:${runId}:a`,
    caseId: cases.cremation.canonicalId,
    obligationId: cremationContract.obligationId,
    payerPartyId: cremation.partyId,
  });
  await page.reload({ waitUntil: "networkidle" });
  await obligationRow(page, cases.cremation.publicRef).getByText("Оплачено", { exact: true }).waitFor();

  const financeRetry = await recordPayment(
    page,
    cases.burial.publicRef,
    176_000,
    "Synthetic full payment",
    { exerciseLostResponse: true },
  );
  await recordRefundAndReversal(page, cases.burial.publicRef);
  await context.clearCookies();
  await login(page, identities.financeB, password, /\/agent\/finance/);
  await approvePendingAdjustment(page);
  await obligationRow(page, cases.burial.publicRef).getByText("Оплачено", { exact: true }).waitFor();

  await context.clearCookies();
  await login(page, identities.agent, password, /\/agent\/cases/);
  await assertCanonicalCaseSummary(page, cremation.leadId, "3/3");
  await page.getByText("Исполнение", { exact: true }).first().waitFor();
  await assertCanonicalCaseSummary(page, burial.leadId, "4/4");
  await page.getByText("Исполнение", { exact: true }).first().waitFor();
  const cremationReconciliation = await reconcile(page, cremation.leadId);
  const burialReconciliation = await reconcile(page, burial.leadId);
  assert.equal(cremationReconciliation.discrepancyCount, 0, JSON.stringify(cremationReconciliation.discrepancies));
  assert.equal(burialReconciliation.discrepancyCount, 0, JSON.stringify(burialReconciliation.discrepancies));

  await assertRoleBoundaries(page, context, cremation.leadId);
  await assertResponsiveAndAccessible(page, cremation.leadId);

  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join("; ")}`);
  assert.deepEqual(unexpected5xx, [], `Unexpected 5xx: ${unexpected5xx.join("; ")}`);
  process.stdout.write(`${JSON.stringify({
    cremation: "PASS",
    relativeBurial: "PASS",
    documentQuarantineReviewReplacement: "PASS",
    contractObligation: "PASS",
    partialFullRefundReversal: "PASS",
    webhookReplayFive: webhook,
    financeLostResponseRetry: financeRetry,
    financeVisibility: "PASS",
    reviewerVisibility: "PASS",
    stageGuards: "PASS",
    reconciliation: 0,
    crossTenant: "PASS",
    accessibilityCriticalSerious: 0,
    mobile: "PASS",
    zoom200: "PASS",
    unexpected5xx: 0,
    skipped: 0,
  })}\n`);
} finally {
  await context.close();
  await browser.close();
}

async function prepareAgentCase(target, caseFixture, options) {
  const leadId = await openCase(target, caseFixture.name);
  await target.getByRole("tab", { name: /Семья/ }).click();
  await target.getByRole("button", { name: "Добавить участника" }).click();
  const form = target.locator('form[aria-label="Добавить участника кейса"]');
  await form.getByLabel("Имя", { exact: true }).fill(options.partyName);
  await form.getByLabel("Email", { exact: true }).fill(`m3-party-${leadId}@synthetic.invalid`);
  for (const role of options.roles) await form.getByLabel(role, { exact: true }).check();
  await form.locator('select[name="consentStatus"]').selectOption("GRANTED");
  await form.locator('input[name="consentSource"]').fill("Synthetic isolated UAT");
  const partyResponsePromise = target.waitForResponse((response) => response.url().includes(`/cases/${leadId}/parties`) && response.request().method() === "POST");
  await form.getByRole("button", { name: "Сохранить участника" }).click();
  const partyResponse = await partyResponsePromise;
  assert.equal(partyResponse.status(), 201);
  const party = await partyResponse.json();

  await target.getByRole("tab", { name: /Документы/ }).click();
  if (options.exerciseFailure) {
    expectedStorageFailure = true;
    await target.route("**/api/agent/cases/*/documents", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic isolated storage outage" }) });
    }, { times: 1 });
    await uploadDocument(target, caseFixture.requirements[0], "failure.pdf", "synthetic failure probe");
    await target.getByRole("alert").getByText("Synthetic isolated storage outage", { exact: true }).waitFor();
    await target.unroute("**/api/agent/cases/*/documents");
    expectedStorageFailure = false;
  }
  for (const [index, requirement] of caseFixture.requirements.entries()) {
    if (options.exerciseQuarantine && index === caseFixture.requirements.length - 1) {
      await uploadDocument(target, requirement, "infected.pdf", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
      await target.locator("li").filter({ hasText: requirement }).getByText("Карантин", { exact: true }).waitFor();
    }
    await uploadDocument(target, requirement, `${index + 1}.pdf`, `synthetic ${caseFixture.publicRef} ${requirement}`);
  }
  return { leadId, partyId: party.partyId };
}

async function openCase(target, name) {
  await target.goto(`${baseUrl}/agent/cases`, { waitUntil: "networkidle" });
  const link = target.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
  const href = await link.getAttribute("href");
  assert.ok(href, `Case link missing for ${name}`);
  await link.click();
  await target.waitForURL(/\/agent\/cases\/\d+/);
  await target.waitForLoadState("networkidle");
  const match = target.url().match(/\/agent\/cases\/(\d+)/);
  assert.ok(match);
  return Number(match[1]);
}

async function uploadDocument(target, requirement, filename, content) {
  const row = target.locator("li").filter({ hasText: requirement });
  const input = row.locator('input[type="file"]');
  await input.setInputFiles({ name: filename, mimeType: "application/pdf", buffer: Buffer.from(content) });
  if (!expectedStorageFailure) {
    await row.getByText(/Загружен, ожидает проверки|Карантин/).waitFor();
    await target.locator('[aria-label="Сценарные документы"][aria-busy="false"]').waitFor();
  }
}

async function reviewDocument(target, publicRef, typeName, decision) {
  await target.goto(`${baseUrl}/agent/document-review`, { waitUntil: "networkidle" });
  let row = reviewRow(target, publicRef, typeName);
  await row.getByRole("button", { name: "Взять в работу" }).click();
  await target.waitForLoadState("networkidle");
  row = reviewRow(target, publicRef, typeName);
  await row.getByText("Назначен вам", { exact: true }).waitFor();
  const documentResponsePromise = target.waitForResponse((response) => (
    response.url().includes("/documents/") && response.request().method() === "GET"
  ));
  const openButton = row.getByRole("button", { name: "Открыть" });
  await openButton.focus();
  await target.keyboard.press("Enter");
  const documentResponse = await documentResponsePromise;
  assert.equal(documentResponse.status(), 200);
  assert.match(documentResponse.headers()["content-type"] ?? "", /^application\/pdf/);
  const viewer = target.getByRole("dialog", { name: new RegExp(typeName) });
  await viewer.waitFor();
  await assertFocused(target, viewer.getByRole("button", { name: "Закрыть документ" }), "document viewer close");
  const viewerSource = await viewer.locator("iframe").getAttribute("src");
  assert.match(viewerSource ?? "", /^blob:/, "Protected viewer must render an in-memory blob URL");
  await target.keyboard.press("Shift+Tab");
  assert.equal(await viewer.evaluate((dialog) => dialog.contains(document.activeElement)), true, "Document viewer must trap keyboard focus");
  await viewer.getByRole("button", { name: "Закрыть документ" }).focus();
  await target.keyboard.press("Escape");
  await viewer.waitFor({ state: "hidden" });
  await assertFocused(target, openButton, "document viewer invoking button");
  if (decision === "REJECT") {
    await row.getByRole("button", { name: "Отклонить" }).click();
    await row.getByLabel("Причина отклонения").fill("Synthetic UAT: требуется новая читаемая версия");
    const responsePromise = target.waitForResponse((response) => response.url().includes("/decision") && response.request().method() === "POST");
    await row.getByRole("button", { name: "Сохранить решение" }).click();
    assert.equal((await responsePromise).status(), 200);
    return;
  }
  const checks = row.getByRole("checkbox");
  for (let index = 0; index < await checks.count(); index += 1) await checks.nth(index).check();
  const responsePromise = target.waitForResponse((response) => response.url().includes("/decision") && response.request().method() === "POST");
  await row.getByRole("button", { name: "Проверено" }).click();
  assert.equal((await responsePromise).status(), 200);
}

function reviewRow(target, publicRef, typeName) {
  return target.locator("li").filter({ hasText: publicRef }).filter({ hasText: typeName });
}

async function replaceRejectedDocument(target, caseFixture, requirement) {
  await openCase(target, caseFixture.name);
  await target.getByRole("tab", { name: /Документы/ }).click();
  const row = target.locator("li").filter({ hasText: requirement });
  await row.getByText(/Synthetic UAT: требуется новая читаемая версия/).waitFor();
  await uploadDocument(target, requirement, "replacement.pdf", "synthetic clean replacement");
}

async function completeContract(target, caseFixture, leadId) {
  await target.goto(`${baseUrl}/agent/cases/${leadId}`, { waitUntil: "networkidle" });
  await target.getByRole("button", { name: "Создать черновик договора" }).click();
  await target.getByLabel("Условия оплаты").fill("Synthetic isolated UAT: оплата по подтверждённому ledger");
  let responsePromise = target.waitForResponse((response) => response.url().includes("/contract") && response.request().method() === "POST");
  await target.getByRole("button", { name: "Создать", exact: true }).click();
  const createResponse = await responsePromise;
  assert.equal(createResponse.status(), 200);
  const created = await createResponse.json();
  assert.equal(created.status, "DRAFT");
  assert.equal(created.replayed, false);
  assert.equal(typeof created.contractVersionId, "string");
  assert.ok(created.contractVersionId.length > 0);
  await target.goto(`${baseUrl}/agent/cases/${leadId}`, { waitUntil: "networkidle" });
  await target.getByText(/v\d+ · Черновик/).waitFor();
  const issueButton = target.getByRole("button", { name: "Выдать договор" });
  assert.equal(await issueButton.isEnabled(), true, "Issue action must be enabled after the canonical draft refresh");
  const [issueResponse] = await Promise.all([
    target.waitForResponse((response) => response.url().includes("/contract") && response.request().method() === "POST"),
    issueButton.click(),
  ]);
  assert.equal(issueResponse.status(), 200);
  await target.goto(`${baseUrl}/agent/cases/${leadId}`, { waitUntil: "networkidle" });
  await target.getByText(/v\d+ · Выдан/).waitFor();
  await target.getByRole("button", { name: "Зафиксировать подписание" }).click();
  await target.getByLabel("Тип подтверждения").fill("SYNTHETIC_UAT_ACK");
  await target.getByLabel("Ссылка или реестр подтверждения").fill(`synthetic-evidence:${caseFixture.canonicalId}`);
  await target.getByLabel("Версия Legal policy").fill("SYNTHETIC-UAT-V1");
  responsePromise = target.waitForResponse((response) => response.url().includes("/contract") && response.request().method() === "POST");
  await target.getByRole("button", { name: "Сохранить immutable evidence" }).click();
  const signedResponse = await responsePromise;
  assert.equal(signedResponse.status(), 200);
  const signed = await signedResponse.json();
  await target.goto(`${baseUrl}/agent/cases/${leadId}`, { waitUntil: "networkidle" });
  await target.getByText(/v\d+ · Подписан/).waitFor();
  await target.waitForLoadState("networkidle");
  await target.getByText("Ожидаем оплату", { exact: true }).first().waitFor();
  return signed;
}

async function recordPayment(target, publicRef, rubles, reason, options = {}) {
  await target.goto(`${baseUrl}/agent/finance`, { waitUntil: "networkidle" });
  const row = obligationRow(target, publicRef);
  const paymentButton = row.getByRole("button", { name: /Оплата|Записать оплату/ });
  await paymentButton.focus();
  await target.keyboard.press("Enter");
  const dialog = target.getByRole("dialog", { name: "Записать подтверждённую оплату" });
  await dialog.getByLabel("Сумма, ₽").fill(String(rubles));
  await dialog.getByLabel("Подтверждение").fill(`synthetic-evidence:${publicRef}:${rubles}`);
  await dialog.getByLabel("Причина").fill(reason);
  let retryEvidence = null;
  if (options.exerciseLostResponse) {
    let originalRequest = null;
    let originalResult = null;
    await target.route("**/api/agent/cases/*/payments", async (route) => {
      originalRequest = {
        idempotencyKey: route.request().headers()["idempotency-key"],
        correlationId: route.request().headers()["x-correlation-id"],
        body: route.request().postData(),
      };
      const serverResponse = await route.fetch();
      assert.equal(serverResponse.status(), 201);
      originalResult = await serverResponse.json();
      await route.abort("failed");
    }, { times: 1 });
    await dialog.getByRole("button", { name: "Добавить в реестр" }).click();
    await target.getByRole("alert").getByText(/fetch|network|команд/i).waitFor();
    await target.unroute("**/api/agent/cases/*/payments");
    const replayPromise = target.waitForResponse((response) => response.url().includes("/payments") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Добавить в реестр" }).click();
    const replayResponse = await replayPromise;
    const replayRequest = {
      idempotencyKey: replayResponse.request().headers()["idempotency-key"],
      correlationId: replayResponse.request().headers()["x-correlation-id"],
      body: replayResponse.request().postData(),
    };
    const replayResult = await replayResponse.json();
    assert.equal(replayResponse.status(), 200);
    assert.equal(originalResult.replayed, false);
    assert.equal(replayResult.replayed, true);
    assert.equal(replayResult.ledgerEntryId, originalResult.ledgerEntryId);
    assert.deepEqual(replayRequest, originalRequest);
    retryEvidence = { original: false, replay: true, sameCommandEnvelope: true, oneLedgerEntry: true };
  } else {
    const responsePromise = target.waitForResponse((response) => response.url().includes("/payments") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Добавить в реестр" }).click();
    assert.equal((await responsePromise).status(), 201);
  }
  await dialog.waitFor({ state: "hidden" });
  await obligationRow(target, publicRef).getByText(rubles === 176_000 ? "Оплачено" : "Частично оплачено", { exact: true }).waitFor();
  return retryEvidence;
}

function obligationRow(target, publicRef) {
  return target.locator("tr").filter({ hasText: publicRef }).or(target.locator("li").filter({ hasText: publicRef })).first();
}

async function replayWebhookFiveTimes(requestContext, ids) {
  const command = {
    ...ids,
    externalEventId: `m3-uat:${runId}:webhook-payment`,
    eventVersion: "1",
    externalTransactionId: `m3-uat:${runId}:external-transaction`,
    amountKopecks: 8_800_000,
    currency: "RUB",
    occurredAt: new Date().toISOString(),
    method: "BANK_TRANSFER",
    evidenceReference: "synthetic-provider-receipt",
  };
  const rawBody = JSON.stringify(command);
  const signature = `sha256=${createHmac("sha256", webhookSecret).update(`synthetic.${rawBody}`).digest("hex")}`;
  const responses = await Promise.all(Array.from({ length: 5 }, () => requestContext.request.post(`${baseUrl}/api/webhooks/m3/payments/synthetic`, {
    data: rawBody,
    headers: { "Content-Type": "application/json", "X-TD-Payment-Signature": signature },
  })));
  assert.equal(responses.every((response) => response.status() === 200), true);
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.equal(new Set(results.map((result) => result.ledgerEntryId)).size, 1);
  assert.equal(results.filter((result) => result.replayed === false).length, 1);
  assert.equal(results.filter((result) => result.replayed === true).length, 4);
  return { uniqueEntries: 1, original: 1, replayed: 4 };
}

async function recordRefundAndReversal(target, publicRef) {
  let row = obligationRow(target, publicRef);
  await row.getByRole("button", { name: "Открыть ledger" }).click();
  let ledgerDialog = target.getByRole("dialog", { name: new RegExp(`Реестр.*${publicRef}`) });
  const payment = ledgerDialog.locator("li").filter({ hasText: "Оплата" }).first();
  await payment.getByRole("button", { name: "Возврат" }).click();
  let actionDialog = target.getByRole("dialog", { name: "Записать возврат" });
  await actionDialog.getByLabel("Сумма, ₽").fill("1000");
  await actionDialog.getByLabel("Подтверждение").fill("synthetic-refund-evidence");
  await actionDialog.getByLabel("Причина").fill("Synthetic UAT refund");
  let responsePromise = target.waitForResponse((response) => response.url().includes("/finance/refunds") && response.request().method() === "POST");
  await actionDialog.getByRole("button", { name: "Добавить в реестр" }).click();
  assert.equal((await responsePromise).status(), 201);

  await target.goto(`${baseUrl}/agent/finance`, { waitUntil: "networkidle" });
  row = obligationRow(target, publicRef);
  await row.getByRole("button", { name: "Открыть ledger" }).click();
  ledgerDialog = target.getByRole("dialog", { name: new RegExp(`Реестр.*${publicRef}`) });
  const refund = ledgerDialog.locator("li").filter({ hasText: "Возврат" }).first();
  await refund.getByRole("button", { name: "Коррекция" }).click();
  actionDialog = target.getByRole("dialog", { name: "Запросить коррекцию или сторно" });
  await actionDialog.getByLabel("Операция").selectOption("REVERSAL");
  await actionDialog.getByLabel("Сумма, ₽").fill("1000");
  await actionDialog.getByLabel("Подтверждение").fill("synthetic-reversal-evidence");
  await actionDialog.getByLabel("Причина").fill("Synthetic UAT four-eyes reversal");
  responsePromise = target.waitForResponse((response) => response.url().endsWith("/finance/adjustments") && response.request().method() === "POST");
  await actionDialog.getByRole("button", { name: "Создать запрос" }).click();
  assert.equal((await responsePromise).status(), 201);
}

async function approvePendingAdjustment(target) {
  const section = target.getByRole("region", { name: "Независимое решение" });
  await section.getByRole("button", { name: "Одобрить" }).click();
  const dialog = target.getByRole("dialog", { name: "Одобрить коррекцию" });
  await dialog.getByLabel("Основание решения").fill("Independent synthetic Finance approval");
  const responsePromise = target.waitForResponse((response) => /\/finance\/adjustments\//.test(response.url()) && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Сохранить решение" }).click();
  assert.equal((await responsePromise).status(), 200);
}

async function reconcile(target, leadId) {
  const response = await browserRequest(target, `/api/agent/cases/${leadId}/reconciliation`);
  assert.equal(response.status, 200);
  return JSON.parse(response.body);
}

async function browserRequest(target, path, init = {}) {
  return target.evaluate(async ({ url, requestInit }) => {
    const response = await fetch(url, { ...requestInit, credentials: "same-origin" });
    return { status: response.status, body: await response.text() };
  }, { url: `${baseUrl}${path}`, requestInit: init });
}

async function assertCanonicalCaseSummary(target, leadId, expectedDocuments) {
  await target.goto(`${baseUrl}/agent/cases/${leadId}`, { waitUntil: "networkidle" });
  const summary = target.locator('dl[aria-label="Контроль кейса"]');
  const documentMetric = summary.locator("dt", { hasText: /^Документы$/ }).locator("..");
  const balanceMetric = summary.locator("dt", { hasText: /^Остаток$/ }).locator("..");
  await documentMetric.locator("dd").getByText(expectedDocuments, { exact: true }).waitFor();
  await balanceMetric.locator("dd").getByText(/^(0|0,00)\s*₽$/).waitFor();
}

async function assertReviewerPrivacy(target) {
  await target.getByRole("heading", { name: "Проверка документов" }).waitFor();
  const text = await target.locator("main").textContent();
  assert.equal(text.includes("ledger"), false);
  assert.equal(text.includes("маржа"), false);
  assert.equal(text.includes("Синтетический плательщик"), false);
}

async function assertFinancePrivacy(target) {
  await target.getByRole("heading", { name: "Финансы" }).waitFor();
  const text = await target.locator("main").textContent();
  assert.equal(text.includes("Синтетический плательщик"), false);
  assert.equal(text.includes("Документ о смерти"), false);
}

async function assertRoleBoundaries(target, browserContext, leadId) {
  const agentFinance = await browserRequest(target, "/agent/finance");
  assert.equal(agentFinance.status, 404);
  await browserContext.clearCookies();
  await login(target, identities.manager, password, /\/agent\/cases/);
  const managerFinance = await browserRequest(target, "/agent/finance");
  assert.equal(managerFinance.status, 404);
  const managerCase = await browserRequest(target, `/agent/cases/${leadId}`);
  assert.equal(managerCase.status, 200);
  await browserContext.clearCookies();
  await login(target, identities.foreign, password, /\/agent\/cases/);
  const foreignReconciliation = await browserRequest(target, `/api/agent/cases/${leadId}/reconciliation`);
  assert.equal(foreignReconciliation.status, 404);
  const foreignCase = await browserRequest(target, `/agent/cases/${leadId}`);
  const foreignCaseBody = foreignCase.body;
  assert.equal(foreignCaseBody.includes(cases.cremation.name), false);
  assert.equal(foreignCaseBody.includes(cases.cremation.publicRef), false);
  assert.ok(
    foreignCase.status === 404
      || (foreignCase.status === 200 && /This page could not be found|>404</.test(foreignCaseBody)),
    `Cross-tenant Case must render a safe not-found response, received ${foreignCase.status}`,
  );
}

async function assertResponsiveAndAccessible(target, leadId) {
  await context.clearCookies();
  await login(target, identities.agent, password, /\/agent\/cases/);
  await target.setViewportSize({ width: 390, height: 844 });
  await target.goto(`${baseUrl}/agent/cases/${leadId}?tab=docs`, { waitUntil: "networkidle" });
  await assertNoOverflow(target, "case documents mobile");
  await assertA11y(target, "case documents mobile");
  await target.setViewportSize({ width: 195, height: 422 });
  await assertNoOverflow(target, "case documents 200 percent zoom");
  await assertTextFullyVisible(
    target,
    target.getByRole("heading", { name: cases.cremation.name, level: 1 }),
    "case title 200 percent zoom",
  );
  const documentMetadataValues = target.locator('[aria-label="Сценарные документы"] dl dd');
  for (let index = 0; index < await documentMetadataValues.count(); index += 1) {
    await assertTextFullyVisible(
      target,
      documentMetadataValues.nth(index),
      `document metadata ${index + 1} at 200 percent zoom`,
    );
  }
  await target.setViewportSize({ width: 390, height: 844 });
  await context.clearCookies();
  await login(target, identities.financeA, password, /\/agent\/finance/);
  await assertNoOverflow(target, "finance mobile");
  await assertA11y(target, "finance mobile");
  const finalFinanceRecord = target.locator('ul[aria-label="Финансовые обязательства"] > li').last();
  await finalFinanceRecord.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await assertClearOfMobileDock(target, finalFinanceRecord, "final Finance record");
  await target.setViewportSize({ width: 195, height: 422 });
  await assertNoOverflow(target, "finance 200 percent zoom");
  await assertA11y(target, "finance 200 percent zoom");
  await target.setViewportSize({ width: 390, height: 844 });
  await context.clearCookies();
  await login(target, identities.reviewer, password, /\/agent\/document-review/);
  await assertNoOverflow(target, "reviewer mobile");
  await assertA11y(target, "reviewer mobile");
  await target.setViewportSize({ width: 195, height: 422 });
  await assertNoOverflow(target, "reviewer 200 percent zoom");
  await assertA11y(target, "reviewer 200 percent zoom");
}

async function assertFocused(target, locator, label) {
  const handle = await locator.elementHandle();
  assert.ok(handle, `${label} element missing`);
  assert.equal(await target.evaluate((element) => document.activeElement === element, handle), true, `${label} focus missing`);
}

async function assertA11y(target, label) {
  await target.addScriptTag({ path: axePath });
  const violations = await target.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations.filter((item) => item.impact === "critical" || item.impact === "serious").map((item) => ({ id: item.id, impact: item.impact }));
  });
  assert.deepEqual(violations, [], `${label} accessibility: ${JSON.stringify(violations)}`);
}

async function assertNoOverflow(target, label) {
  const overflow = await target.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(overflow.scroll <= overflow.width + 1, `${label} overflow ${overflow.scroll}/${overflow.width}`);
}

async function assertTextFullyVisible(target, locator, label) {
  const metrics = await locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      boxLeft: box.left,
      boxRight: box.right,
      textLeft: text.left,
      textRight: text.right,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });
  assert.ok(metrics.boxLeft >= -1 && metrics.boxRight <= metrics.viewportWidth + 1, `${label} box clipped`);
  assert.ok(metrics.textLeft >= -1 && metrics.textRight <= metrics.viewportWidth + 1, `${label} text clipped`);
  assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1, `${label} internal overflow ${metrics.scrollWidth}/${metrics.clientWidth}`);
}

async function assertClearOfMobileDock(target, locator, label) {
  const record = await locator.boundingBox();
  const dock = await target.getByRole("navigation", { name: "Основная навигация" }).boundingBox();
  assert.ok(record && dock, `${label} or mobile dock missing`);
  assert.ok(record.y + record.height <= dock.y - 8, `${label} remains obscured by the mobile dock`);
}

async function login(target, email, identityPassword, landing) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await target.goto(`${baseUrl}/agent/login`, { waitUntil: "networkidle" });
    await target.locator("#agent-email").fill(email);
    await target.locator("#agent-password").fill(identityPassword);
    let responsePromise = target.waitForResponse((response) => response.url().includes("/api/agent/auth/login") && response.request().method() === "POST");
    await target.locator('form button[type="submit"]').click();
    let response = await responsePromise;
    if (response.status() === 429 && attempt < 3) {
      const retryAfter = Number(response.headers()["retry-after"] ?? 60);
      await target.waitForTimeout((Number.isFinite(retryAfter) ? retryAfter : 60) * 1000 + 1_000);
      continue;
    }
    const body = await response.json().catch(() => null);
    if (body?.mfaRequired === true) {
      await target.locator("#platform-mfa-code").fill(totp(mfaSecret));
      responsePromise = target.waitForResponse((next) => next.url().includes("/api/agent/auth/login") && next.request().method() === "POST");
      await target.locator('form button[type="submit"]').click();
      response = await responsePromise;
      if (response.status() === 429 && attempt < 3) {
        const retryAfter = Number(response.headers()["retry-after"] ?? 60);
        await target.waitForTimeout((Number.isFinite(retryAfter) ? retryAfter : 60) * 1000 + 1_000);
        continue;
      }
    }
    assert.equal(response.status(), 200, `Login ${email}: ${response.status()}`);
    await target.waitForURL(landing);
    return;
  }
  throw new Error(`Login remained rate-limited for ${email}`);
}

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of secret) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid protected M3 UAT MFA secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
