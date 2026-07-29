import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHmac } from "node:crypto";
import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";
const runId = process.env.M2_UAT_RUN_ID ?? "mission-2";
const password = process.env.M2_UAT_PASSWORD;
const activationToken = process.env.M2_UAT_ACTIVATION_TOKEN;
const recoveryToken = process.env.M2_UAT_RECOVERY_TOKEN;
const mfaSecret = process.env.M2_UAT_MFA_SECRET;
const evidenceDir = process.env.M2_EVIDENCE_DIR;
const emails = {
  platform: `m2-platform-${runId}@synthetic.invalid`,
  activation: `m2-activation-${runId}@synthetic.invalid`,
  admin: `m2-admin-${runId}@synthetic.invalid`,
  manager: `m2-manager-${runId}@synthetic.invalid`,
  agent: `m2-agent-${runId}@synthetic.invalid`,
  second: `m2-second-${runId}@synthetic.invalid`,
};
if (!password) throw new Error("M2_UAT_PASSWORD is required");
if (!activationToken) throw new Error("M2_UAT_ACTIVATION_TOKEN is required");
if (!recoveryToken) throw new Error("M2_UAT_RECOVERY_TOKEN is required");
if (!mfaSecret) throw new Error("M2_UAT_MFA_SECRET is required");
if (evidenceDir) await fs.mkdir(evidenceDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow" });
const page = await context.newPage();
const browserErrors = [];
let expectedActivationRejection = 0;
let expectedRecoveryRejection = 0;
page.on("console", (message) => {
  if (
    message.type() === "error"
    && message.text().includes("status of 400")
    && message.location().url.includes("/api/platform-admin/activation")
  ) {
    expectedActivationRejection += 1;
    return;
  }
  if (
    message.type() === "error"
    && message.text().includes("status of 400")
    && message.location().url.includes("/api/platform-admin/owner-recovery")
  ) {
    expectedRecoveryRejection += 1;
    return;
  }
  if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

try {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRecovery(page, recoveryToken);
  await page.getByRole("heading", { name: "Восстановление доступа владельца" }).waitFor();
  try {
    await page.waitForFunction(() => window.location.hash === "", undefined, { timeout: 5_000 });
  } catch {
    throw new Error("Raw recovery token was not removed from browser URL");
  }
  await page.getByLabel("Новый пароль").fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("img", { name: "QR-код для приложения-аутентификатора" }).waitFor();
  await assertNoOverflow(page, "platform owner recovery mobile");
  await recoveryScreenshot(page, "platform-owner-recovery-mobile.png");
  await page.getByLabel("Код из приложения").fill(totp(mfaSecret));
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/platform-admin"),
    page.getByRole("button", { name: "Обновить пароль" }).click(),
  ]);
  await page.getByRole("heading", { name: "Обзор платформы" }).waitFor();
  await context.clearCookies();
  await openRecovery(page, recoveryToken);
  await page.getByRole("heading", { name: "Не удалось восстановить доступ" }).waitFor();

  await context.clearCookies();
  await openActivation(page, activationToken);
  await page.getByRole("heading", { name: "Первый вход владельца платформы" }).waitFor();
  try {
    await page.waitForFunction(() => window.location.hash === "", undefined, { timeout: 5_000 });
  } catch {
    throw new Error("Raw activation token was not removed from browser URL");
  }
  await page.getByLabel("Новый пароль").fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByLabel("Код подтверждения").fill(totp(mfaSecret));
  await screenshot(page, "platform-activation-mobile.png");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/platform-admin"),
    page.getByRole("button", { name: "Установить пароль" }).click(),
  ]);
  await page.getByRole("heading", { name: "Обзор платформы" }).waitFor();
  await context.clearCookies();
  await openActivation(page, activationToken);
  await page.getByRole("heading", { name: "Не удалось активировать аккаунт" }).waitFor();

  await page.setViewportSize({ width: 1365, height: 900 });
  await login(page, emails.platform, "/platform-admin");
  await page.getByRole("heading", { name: "Обзор платформы" }).waitFor();
  await page.getByText("Администрирование платформы", { exact: true }).first().waitFor();
  await screenshot(page, "platform-admin-desktop.png");
  await page.getByRole("link", { name: "Организации" }).click();
  await page.getByRole("heading", { name: "Организации" }).waitFor();
  await Promise.all([
    page.waitForURL(/\/platform-admin\/organizations\/[^/]+$/),
    page.getByRole("link", { name: /Синтетическое агентство M2/ }).click(),
  ]);
  await waitForHeading(page, "Синтетическое агентство M2");
  assert.equal(await page.getByText("Сотрудник другой организации", { exact: true }).count(), 0);
  await page.getByRole("link", { name: "Пользователи" }).click();
  await page.getByRole("heading", { name: "Пользователи" }).waitFor();
  await page.getByRole("link", { name: "Аудит" }).click();
  await page.getByRole("heading", { name: "Аудит платформы" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/platform-admin`, { waitUntil: "networkidle" });
  await assertNoOverflow(page, "platform admin mobile");
  await screenshot(page, "platform-admin-mobile.png");

  await context.clearCookies();
  await page.setViewportSize({ width: 1365, height: 900 });
  await login(page, emails.admin, "/agent/cases");
  await page.goto(`${baseUrl}/agent/settings/team`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Команда и доступы" }).waitFor();
  await page.getByText(emails.admin, { exact: true }).waitFor();
  assert.equal(await page.getByText(emails.second, { exact: true }).count(), 0);
  await screenshot(page, "organization-admin-desktop.png");

  const inviteEmail = `m2-invite-${runId}@synthetic.invalid`;
  await page.getByRole("button", { name: "Пригласить сотрудника" }).click();
  await page.getByLabel("Рабочий email").fill(inviteEmail);
  await page.getByRole("button", { name: "Создать ссылку" }).click();
  await page.getByText(/Ссылка показана один раз/).waitFor();
  await page.getByText(inviteEmail, { exact: true }).waitFor();
  const inviteRow = page.locator("article").filter({ hasText: inviteEmail });
  await inviteRow.getByRole("button", { name: "Отозвать" }).click();
  await inviteRow.getByText("Отозвано", { exact: true }).waitFor();

  const managerRow = page.locator("article").filter({ hasText: emails.manager }).first();
  page.once("dialog", async (dialog) => dialog.accept("E2E: проверка смены роли"));
  await managerRow.getByLabel(/Роль Руководитель M2/).selectOption("AGENT");
  await managerRow.getByLabel(/Роль Руководитель M2/).waitFor();
  await page.waitForFunction((email) => {
    const row = [...document.querySelectorAll("article")].find((element) => element.textContent?.includes(email));
    return row?.querySelector("select")?.value === "AGENT";
  }, emails.manager);
  page.once("dialog", async (dialog) => dialog.accept("E2E: восстановление роли"));
  await managerRow.getByLabel(/Роль Руководитель M2/).selectOption("MANAGER");
  await page.waitForFunction((email) => {
    const row = [...document.querySelectorAll("article")].find((element) => element.textContent?.includes(email));
    return row?.querySelector("select")?.value === "MANAGER";
  }, emails.manager);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/agent/settings/team`, { waitUntil: "networkidle" });
  await assertNoOverflow(page, "organization admin mobile");
  await screenshot(page, "organization-admin-mobile.png");

  await context.clearCookies();
  await login(page, emails.manager, "/agent/cases");
  await page.goto(`${baseUrl}/platform-admin`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Нет доступа к администрированию платформы" }).waitFor();
  await page.goto(`${baseUrl}/agent/settings/team`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Недостаточно прав" }).waitFor();

  await context.clearCookies();
  await login(page, emails.agent, "/agent/cases");
  await page.goto(`${baseUrl}/platform-admin`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Нет доступа к администрированию платформы" }).waitFor();

  assert.deepEqual(browserErrors, [], `Unexpected browser errors:\n${browserErrors.join("\n")}`);
  assert.equal(expectedActivationRejection, 1, "Consumed activation token must be rejected exactly once");
  assert.equal(expectedRecoveryRejection, 1, "Consumed recovery token must be rejected exactly once");
  process.stdout.write(`${JSON.stringify({
    platformSuperAdmin: "PASS",
    platformActivation: "PASS",
    platformOwnerRecovery: "PASS",
    organizationAdmin: "PASS",
    managerForbidden: "PASS",
    agentForbidden: "PASS",
    crossTenant: "PASS",
    mobile: "PASS",
    skipped: 0,
  })}\n`);
} finally {
  await context.close();
  await browser.close();
}

async function login(target, email, expectedPath) {
  await target.goto(`${baseUrl}/agent/login`, { waitUntil: "networkidle" });
  await target.locator("#agent-email").fill(email);
  await target.locator("#agent-password").fill(password);
  if (email === emails.platform) {
    await target.locator('form button[type="submit"]').click();
    await target.locator("#platform-mfa-code").fill(totp(mfaSecret));
  }
  await Promise.all([
    target.waitForURL((url) => url.pathname === expectedPath),
    target.locator('form button[type="submit"]').click(),
  ]);
}

async function openActivation(target, rawToken) {
  try {
    await target.goto(
      `${baseUrl}/setup/platform-admin#token=${encodeURIComponent(rawToken)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
  } catch {
    throw new Error("Platform activation page navigation failed");
  }
}

async function openRecovery(target, rawToken) {
  try {
    await target.goto(
      `${baseUrl}/setup/platform-owner-recovery#token=${encodeURIComponent(rawToken)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
  } catch {
    throw new Error("Platform owner recovery page navigation failed");
  }
}

async function assertNoOverflow(target, label) {
  const dimensions = await target.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth + 1, `${label} overflow: ${JSON.stringify(dimensions)}`);
}

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
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

async function screenshot(target, filename) {
  if (!evidenceDir) return;
  await target.screenshot({ path: path.join(evidenceDir, filename), fullPage: true });
}

async function recoveryScreenshot(target, filename) {
  if (!evidenceDir) return;
  await target.evaluate(() => {
    const qr = document.querySelector('[role="img"][aria-label="QR-код для приложения-аутентификатора"]');
    if (qr) {
      qr.replaceChildren();
      const label = document.createElement("span");
      label.textContent = "QR скрыт в evidence";
      label.style.cssText = "font: 600 12px/1.4 system-ui; color: #60716d; text-align: center;";
      qr.append(label);
    }
    const fallbackKey = document.querySelector("code");
    if (fallbackKey) fallbackKey.textContent = "Ключ скрыт в evidence";
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await target.waitForTimeout(250);
  await target.screenshot({ path: path.join(evidenceDir, filename), fullPage: true });
}

async function waitForHeading(target, name) {
  try {
    await target.getByRole("heading", { name }).waitFor({ timeout: 10_000 });
  } catch {
    const text = (await target.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600);
    throw new Error(`Heading "${name}" missing at ${new URL(target.url()).pathname}. Body: ${text}`);
  }
}
