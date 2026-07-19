import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const runId = process.env.M1_UAT_RUN_ID ?? "mission-1";
const agentEmail = process.env.E2E_AGENT_EMAIL ?? `m1-agent-${runId}@synthetic.invalid`;
const managerEmail = process.env.E2E_MANAGER_EMAIL ?? `m1-manager-${runId}@synthetic.invalid`;
const password = process.env.M1_UAT_PASSWORD;

if (!password) throw new Error("M1_UAT_PASSWORD is required for authenticated M1 E2E");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow" });
const page = await context.newPage();
const failures = [];
let expectedConflictErrors = 0;
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const location = message.location().url;
  if (
    message.text().includes("server responded with a status of 409")
    && location.includes("/api/agent/cases/")
    && location.includes("/tasks/")
  ) {
    expectedConflictErrors += 1;
    return;
  }
  failures.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));

try {
  await login(page, agentEmail, password);
  await agentFlow(page, context);
  await context.clearCookies();
  await login(page, managerEmail, password);
  await managerFlow(page);
  await responsiveAndAccessibility(page);
  assert.equal(expectedConflictErrors, 2, "Both injected task version conflicts must reach the browser");
  assert.deepEqual(failures, [], `Unexpected browser errors:\n${failures.join("\n")}`);
  process.stdout.write(`${JSON.stringify({
    agent: "PASS",
    manager: "PASS",
    cremation: "PASS",
    relativeBurial: "PASS",
    accessibilityCriticalSerious: 0,
    mobile: "PASS",
    zoom200: "PASS",
    skipped: 0,
  })}\n`);
} finally {
  await context.close();
  await browser.close();
}

async function login(target, email, secret) {
  await target.goto(`${baseUrl}/agent/login`, { waitUntil: "networkidle" });
  await target.locator("#agent-email").fill(email);
  await target.locator("#agent-password").fill(secret);
  await Promise.all([
    target.waitForURL(/\/agent\/cases(?:\?|$)/),
    target.locator('form button[type="submit"]').click(),
  ]);
  await target.getByRole("heading", { name: "Кейсы", exact: true }).waitFor();
}

async function agentFlow(target, browserContext) {
  await target.goto(`${baseUrl}/agent/tasks`, { waitUntil: "networkidle" });
  await target.getByRole("heading", { name: "Сегодня", exact: true, level: 1 }).waitFor();
  await target.getByRole("heading", { name: "Просрочено", exact: true }).waitFor();
  await target.getByText("Синтетический UAT: срочное действие", { exact: true }).waitFor();
  const escalationRows = target.locator("li").filter({ hasText: "Зафиксировать итог прошедшей встречи" });
  assert.equal(await escalationRows.count(), 1, "A projected past meeting must appear as one logical obligation");
  assert.equal(await escalationRows.getByRole("link", { name: "Зафиксировать исход" }).count(), 1);
  assert.equal(await escalationRows.getByRole("button", { name: "Зафиксировать результат" }).count(), 0);
  await assertA11y(target, "agent-today");

  await target.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  const search = target.getByRole("combobox", { name: "Поиск команд" });
  await search.fill("Кремова");
  await target.getByRole("option", { name: /Семья Кремова.*Кейс \/ клиент/ }).waitFor();
  await target.keyboard.press("Escape");

  const urgentRow = target.locator("li").filter({ hasText: "Синтетический UAT: срочное действие" });
  await urgentRow.getByRole("button", { name: "Зафиксировать результат" }).click();
  await urgentRow.locator("textarea").fill("Синтетический результат агента");
  let conflictInjected = false;
  await target.route("**/api/agent/cases/*/tasks/*", async (route) => {
    if (!conflictInjected && route.request().method() === "PATCH") {
      conflictInjected = true;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "VERSION_CONFLICT" }) });
      return;
    }
    await route.continue();
  });
  await urgentRow.getByRole("button", { name: "Сохранить результат" }).click();
  await urgentRow.getByRole("alert").filter({ hasText: "другом окне" }).waitFor();
  await target.unroute("**/api/agent/cases/*/tasks/*");
  await urgentRow.getByRole("button", { name: "Сохранить результат" }).click();
  await target.getByRole("status").filter({ hasText: "зафиксирован" }).waitFor();

  const preparationRow = target.locator("li").filter({ hasText: "Подготовить сценарный чек-лист" }).first();
  await preparationRow.getByRole("button", { name: "Зафиксировать результат" }).click();
  await preparationRow.locator("textarea").fill("Не отправлять при офлайн-проверке");
  await browserContext.setOffline(true);
  const offlineSubmit = preparationRow.getByRole("button", { name: "Сохранить результат" });
  await target.locator('[role="status"]').filter({ hasText: "Офлайн." }).waitFor();
  assert.equal(await offlineSubmit.isDisabled(), true, "Offline outcome submit must fail closed before a network request");
  assert.equal(await preparationRow.locator("textarea").inputValue(), "Не отправлять при офлайн-проверке");
  await browserContext.setOffline(false);
  await preparationRow.getByRole("button", { name: "Отмена" }).click();

  await target.goto(`${baseUrl}/agent/operations`, { waitUntil: "networkidle" });
  await target.getByRole("heading", { name: "Раздел доступен руководителю" }).waitFor();

  await target.goto(`${baseUrl}/agent/meetings`, { waitUntil: "networkidle" });
  const meetingRow = target.locator("li").filter({ hasText: "Семья Кремова" }).first();
  await meetingRow.getByRole("button").click();
  await Promise.all([
    target.waitForURL(/\/agent\/meetings\/\d+/),
    meetingRow.getByRole("link", { name: /Встреча/ }).click(),
  ]);
  await target.getByRole("button", { name: "Зафиксировать итог" }).click();
  await target.getByLabel("Фактический результат").fill("Синтетический исход встречи зафиксирован");
  await target.getByRole("button", { name: "Сохранить" }).click();
  await target.getByRole("status").filter({ hasText: "результат встречи сохранены" }).waitFor();
}

async function managerFlow(target) {
  await target.goto(`${baseUrl}/agent/operations`, { waitUntil: "networkidle" });
  await target.getByRole("heading", { name: "Команда", exact: true }).waitFor();
  await target.getByRole("heading", { name: "Распределение задач" }).waitFor();
  await assertA11y(target, "manager-control-tower");

  const unassigned = target.locator("li").filter({ hasText: "Не назначено" }).filter({ hasText: "Подготовить сценарный чек-лист" }).first();
  await unassigned.getByRole("button", { name: "Назначить", exact: true }).click();
  await unassigned.getByLabel("Исполнитель").selectOption({ label: "Синтетический агент" });
  await unassigned.getByLabel("Причина изменения").fill("UAT: распределение нагрузки");
  let conflictInjected = false;
  await target.route("**/api/agent/cases/*/tasks/*", async (route) => {
    if (!conflictInjected && route.request().method() === "PATCH") {
      conflictInjected = true;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "VERSION_CONFLICT" }) });
      return;
    }
    await route.continue();
  });
  await unassigned.getByRole("button", { name: "Сохранить", exact: true }).click();
  await unassigned.getByRole("alert").filter({ hasText: "другим пользователем" }).waitFor();
  await target.unroute("**/api/agent/cases/*/tasks/*");
  await unassigned.getByRole("button", { name: "Сохранить", exact: true }).click();
  await target.getByRole("status").filter({ hasText: "Исполнитель задачи" }).waitFor();

  await target.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  const search = target.getByRole("combobox", { name: "Поиск команд" });
  await search.fill("Участкова");
  await target.getByRole("option", { name: /Семья Участкова.*Кейс \/ клиент/ }).waitFor();
  await target.keyboard.press("Escape");

  const audit = await target.evaluate(async () => {
    const response = await fetch("/api/agent/operations/audit?entityType=task");
    return { status: response.status, body: await response.json() };
  });
  assert.equal(audit.status, 200);
  assert.ok(audit.body.events.some((event) => event.action === "task.assigned"));
}

async function responsiveAndAccessibility(target) {
  await target.goto(`${baseUrl}/agent/tasks`, { waitUntil: "networkidle" });
  await target.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await assertNoHorizontalOverflow(target, "200% zoom");
  await target.evaluate(() => { document.documentElement.style.zoom = ""; });

  await target.setViewportSize({ width: 390, height: 844 });
  await target.goto(`${baseUrl}/agent/tasks`, { waitUntil: "networkidle" });
  await target.getByRole("heading", { name: "Сегодня", exact: true, level: 1 }).waitFor();
  await assertNoHorizontalOverflow(target, "mobile Today");
  await assertA11y(target, "mobile-today");
  await target.keyboard.press("Tab");
  const focused = await target.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    return { tag: element.tagName, outline: style.outlineStyle, width: element.getBoundingClientRect().width };
  });
  assert.ok(focused && focused.width > 0 && focused.outline !== "none", "Keyboard focus must remain visible on mobile");
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
        nodes: violation.nodes.length,
        samples: violation.nodes.slice(0, 6).map((node) => ({
          target: node.target,
          failureSummary: node.failureSummary,
        })),
      }));
  });
  assert.deepEqual(violations, [], `${label} accessibility violations: ${JSON.stringify(violations)}`);
}

async function assertNoHorizontalOverflow(target, label) {
  const dimensions = await target.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth + 1, `${label} horizontally overflows: ${JSON.stringify(dimensions)}`);
}
