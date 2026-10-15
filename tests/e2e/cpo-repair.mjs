import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { fillProtected, sanitizedCpoFailure, observeLegacyPromise, createLegacyAsyncScope } from "./protectedInput.mjs";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

let browser;
const contexts = [];
async function closeResources() {
  let failed = false;
  for (const context of contexts) {
    try { await context.close(); } catch { failed = true; }
  }
  try { await browser?.close(); } catch { failed = true; }
  if (failed) throw new Error("E2E_CPO_CLEANUP_FAILED");
}
const asyncScope = createLegacyAsyncScope(closeResources);

async function run() {

const runId = process.env.M3_UAT_RUN_ID;
const password = process.env.M3_UAT_PASSWORD;
const mfa = process.env.M3_UAT_MFA_SECRET;
const baseUrl = process.env.E2E_BASE_URL;
if (process.env.M3_CPO_REPAIR_FIXTURE !== "1" || !runId || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(runId)
  || !baseUrl || !password || password.length < 32 || !/^[A-Z2-7]{32}$/.test(mfa ?? "")) throw new Error("Explicit approved CPO fixture and protected M3 login inputs required");
const fixture = JSON.parse(process.env.M3_CPO_REPAIR_FIXTURE_JSON ?? "null");
const origin = new URL(baseUrl).origin;
const targetUrl = new URL(baseUrl);
assert.ok(!targetUrl.username && !targetUrl.password && !targetUrl.search && !targetUrl.hash && targetUrl.pathname === "/", "Use a bare approved origin");
assert.ok(["localhost", "127.0.0.1"].includes(targetUrl.hostname) || (targetUrl.protocol === "https:" && targetUrl.hostname.endsWith(".vercel.app")), "Only local or isolated Preview origin allowed");
assert.equal(fixture?.source, "synthetic-cpo-repair-v1");
assert.equal(fixture.runId, runId);
assert.equal(fixture.origin, origin);
assert.match(fixture.fingerprint, /^[a-f0-9]{16}$/);
assert.notEqual(fixture.fingerprint, "0257665af2dd90a4", "Known production target is unconditionally forbidden");
assert.equal(fixture.fingerprint, process.env.EXPECTED_DATABASE_FINGERPRINT);
assert.notEqual(fixture.fingerprint, process.env.M3_PRODUCTION_DATABASE_FINGERPRINT);
const loopback = ["localhost", "127.0.0.1"].includes(targetUrl.hostname);
assert.equal(fixture.local, loopback, "Browser origin and fixture target must share local/remote provenance");
if (!(loopback && fixture.local === true && fixture.database === "td_agent_test" && fixture.schema === "public")) assert.match(fixture.schema, /^m3_cpo_repair_[a-z0-9_]+$/);
assert.equal(fixture.schema, process.env.M3_CPO_REPAIR_SCHEMA);
if (!loopback) {
  assert.equal(fixture.fingerprint, "545a187f9e9d66b0", "Remote target must be the approved isolated fingerprint");
  assert.match(process.env.M3_PRODUCTION_DATABASE_FINGERPRINT ?? "", /^[a-f0-9]{16}$/);
}
assert.equal(fixture.organizationA, `m3-uat:${runId}:a`);
assert.equal(fixture.organizationB, `m3-uat:${runId}:b`);
assert.equal(fixture.candidateMembershipId, `m3-uat-membership:${runId}:foreign`);
assert.equal(fixture.ownerEmail, `m3-cpo-owner-${runId}@synthetic.invalid`);
assert.deepEqual(fixture.bootstrap, { organizationStatus: "ACTIVE", adminCount: 0, pendingAdminCount: 0, previousBootstrapCount: 0 });
for (const key of ["safe", "published"]) {
  assert.equal(fixture.cases[key].id, `m3-cpo-case:${runId}:${key}`);
  assert.ok(Number.isSafeInteger(fixture.cases[key].leadId) && fixture.cases[key].leadId > 0);
  assert.equal(fixture.cases[key].stage, "QUOTING");
  assert.equal(fixture.cases[key].scenarioId, "CREMATION_V1");
}
const ownerMfa = [...createHmac("sha256", mfa).update(`cpo-repair-owner:${runId}`).digest()]
  .map((byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte & 31]).join("");
const identities = Object.fromEntries(["agent", "foreign", "manager", "reviewer", "finance-a"].map((role) => [role, `m3-${role}-${runId}@synthetic.invalid`]));
const { chromium } = await import("playwright");
const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
browser = await chromium.launch({ headless: true });
const failures = [];
const firstAdminUi = [];
const mockedLogoutFailures = new Set();
let observedMockLogoutFailures = 0;
const firstAdminPath = `/api/platform-admin/organizations/${encodeURIComponent(fixture.organizationB)}/first-admin`;
const bootstrapBody = { membershipId: fixture.candidateMembershipId, reason: "Synthetic CPO browser bootstrap", confirmation: "НАЗНАЧИТЬ АДМИНИСТРАТОРА" };
const correctionBody = { ceremonyType: "погребение", scenarioCorrection: { confirmed: true, reason: "Synthetic CPO browser correction" } };

async function session() {
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow",
    ...(process.env.E2E_PROTECTION_BYPASS ? { extraHTTPHeaders: { "x-vercel-protection-bypass": process.env.E2E_PROTECTION_BYPASS } } : {}) });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", () => failures.push("Browser page error"));
  page.on("response", (response) => {
    if (response.status() === 503 && new URL(response.url()).pathname === "/api/agent/auth/logout" && mockedLogoutFailures.delete(response.request())) {
      observedMockLogoutFailures++;
      return;
    }
    if (response.status() >= 500) failures.push(`Unexpected HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  return { context, page };
}

async function login(page, email, secret, landing) {
  await page.goto(`${origin}/agent/login`);
  await page.locator("#agent-email").fill(email);
  await fillProtected(page.locator("#agent-password"), password);
  let pending = observeLegacyPromise(page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agent/auth/login" && response.request().method() === "POST"));
  await page.locator('form button[type="submit"]').click();
  let response = await pending;
  const body = await response.json();
  if (secret) {
    assert.equal(body.mfaRequired, true, "MFA challenge required for protected identity");
    await fillProtected(page.locator("#platform-mfa-code"), totp(secret));
    pending = observeLegacyPromise(page.waitForResponse((next) => new URL(next.url()).pathname === "/api/agent/auth/login" && next.request().method() === "POST"));
    await page.locator('form button[type="submit"]').click();
    response = await pending;
  }
  assert.equal(response.status(), 200, "Authenticated fixture login must succeed");
  await observeLegacyPromise(page.waitForURL((url) => url.pathname === landing));
}

async function command(context, pathname, method, data) {
  const key = randomUUID();
  const page = context.pages()[0];
  assert.equal(new URL(page.url()).origin, origin, "Command must execute in the approved browser origin");
  const status = await page.evaluate(async ({ pathname, method, data, key }) => {
    const response = await fetch(pathname, { method, credentials: "same-origin", redirect: "manual",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key, "X-Correlation-Id": key }, body: JSON.stringify(data) });
    return response.status;
  }, { pathname, method, data, key });
  return { status: () => status };
}

async function intake(page, leadId, confirmed) {
  await page.goto(`${origin}/agent/cases/${leadId}`);
  await page.getByRole("tab", { name: /Семья/ }).click();
  await page.getByRole("button", { name: "погребение", exact: true }).click();
  if (confirmed) {
    await page.getByLabel("Подтверждаю исправление сценария").check();
    await page.getByLabel("Причина исправления сценария").fill(correctionBody.scenarioCorrection.reason);
  }
  const response = observeLegacyPromise(page.waitForResponse((next) => new URL(next.url()).pathname === `/api/agent/cases/${leadId}/intake` && next.request().method() === "PATCH"));
  await page.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  return response;
}

async function assertCeremony(page, leadId, ceremony) {
  await page.goto(`${origin}/agent/cases/${leadId}`);
  await page.getByRole("tab", { name: /Семья/ }).click();
  assert.equal(await page.getByRole("button", { name: ceremony, exact: true }).getAttribute("data-active"), "true");
}

async function assertDocuments(page, burial) {
  await page.getByRole("tab", { name: /Документы/ }).click();
  const documents = page.locator('[aria-label="Сценарные документы"]');
  await documents.getByRole("heading", { name: "Документ, удостоверяющий личность", exact: true }).first().waitFor();
  await documents.getByRole("heading", { name: "Документ о смерти", exact: true }).first().waitFor();
  const cremation = documents.locator("li").filter({ has: page.getByRole("heading", { name: "Основание для кремации", exact: true }) });
  assert.equal(await cremation.count(), 1, "Historical requirement must remain visible");
  if (burial) {
    await cremation.getByText("Заменено при смене сценария", { exact: true }).waitFor();
    assert.equal(await cremation.locator('input[type="file"]').count(), 0);
  }
  for (const title of ["Право на родственный участок", "Подтверждение родства"]) {
    const actual = await documents.getByRole("heading", { name: title, exact: true }).count();
    if (actual !== (burial ? 1 : 0)) process.stderr.write(`${JSON.stringify({ code: "CPO_REQUIREMENT_COUNT_MISMATCH", title, burial, actual, expected: burial ? 1 : 0 })}\n`);
    assert.equal(actual, burial ? 1 : 0);
  }
}

async function bootstrapNavigationDiagnostic(page, response, expectedPath) {
  const readOrganization = async (organizationId) => {
    try {
      return await page.evaluate(async ({ pathname, candidateId }) => {
        const result = await fetch(pathname, { credentials: "same-origin", redirect: "manual" });
        const organization = await result.json().catch(() => null);
        const memberships = Array.isArray(organization?.memberships) ? organization.memberships : null;
        return { status: result.status, statusActive: organization?.status === "ACTIVE",
          adminCount: memberships ? memberships.filter((member) => member.role === "ADMIN").length : null,
          ownCandidatePresent: memberships?.some((member) => member.id === candidateId) ?? false };
      }, { pathname: `/api/platform-admin/organizations/${organizationId}`, candidateId: fixture.candidateMembershipId });
    } catch { return { status: null, statusActive: false, adminCount: null, ownCandidatePresent: false }; }
  };
  const apiEncoded = await readOrganization(encodeURIComponent(fixture.organizationB));
  const apiBareColon = apiEncoded.status === 404 ? await readOrganization(fixture.organizationB) : null;
  const current = new URL(page.url());
  const expectedPage = current.origin === origin && decodeURIComponent(current.pathname) === decodeURIComponent(expectedPath);
  const passwordPresent = await page.locator('input[type="password"], #agent-password, #platform-mfa-code').count() > 0;
  const invitePresent = await page.getByText(/Ссылка показана один раз|#invite=/).count() > 0
    || await page.locator('a[href*="invite="], input[value*="invite="]').count() > 0;
  const diagnostic = { code: "CPO_BOOTSTRAP_NAVIGATION_FAILED", status: response?.status() ?? null,
    expectedPath: expectedPage, loginPath: current.pathname === "/agent/login", titleNotFound: /404|not found/i.test(await page.title()),
    organizationHeading: await page.getByRole("heading", { name: "Изолированный tenant M3", exact: true }).count() > 0,
    bootstrapHeading: await page.getByRole("heading", { name: "Первый администратор", exact: true }).count() > 0,
    notFoundHeading: await page.getByRole("heading", { name: /404|not found|не найден/i }).count() > 0,
    deniedHeading: await page.getByRole("heading", { name: /Нет доступа|Недостаточно прав/ }).count() > 0,
    passwordPresent, invitePresent, apiEncoded, apiBareColon, screenshotSaved: false };
  if (expectedPage && !passwordPresent && !invitePresent) {
    try {
      const directory = await mkdtemp(path.join(tmpdir(), "cpo-safe-navigation-"));
      await chmod(directory, 0o700);
      const screenshot = path.join(directory, "platform-organization-before-grant.png");
      await page.screenshot({ path: screenshot, fullPage: true });
      await chmod(screenshot, 0o600);
      diagnostic.screenshotSaved = true;
      process.stderr.write(`${JSON.stringify({ code: "CPO_SAFE_NAVIGATION_SCREENSHOT", path: screenshot })}\n`);
    } catch { /* Screenshot failure must not expose browser diagnostics. */ }
  }
  process.stderr.write(`${JSON.stringify(diagnostic)}\n`);
}

async function assertFirstAdminViewports(page) {
  const directory = await mkdtemp(path.join(tmpdir(), "cpo-first-admin-ui-"));
  await chmod(directory, 0o700);
  const heading = page.getByRole("heading", { name: "Первый администратор", exact: true });
  const form = page.locator("section").filter({ has: heading }).locator("form");
  const submit = form.getByRole("button", { name: "Назначить первого ADMIN", exact: true });
  for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }, { width: 195, height: 422 }]) {
    await page.setViewportSize(viewport);
    await heading.waitFor();
    assert.equal(new URL(page.url()).origin, origin);
    assert.equal(decodeURIComponent(new URL(page.url()).pathname), `/platform-admin/organizations/${fixture.organizationB}`);
    assert.equal(await page.locator('input[type="password"], #platform-mfa-code, a[href*="invite="], input[value*="invite="]').count(), 0);
    assert.equal(await page.getByText(/Ссылка показана один раз|#invite=/).count(), 0);
    const screenshot = path.join(directory, `first-admin-${viewport.width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    await chmod(screenshot, 0o600);
    process.stderr.write(`${JSON.stringify({ code: "CPO_FIRST_ADMIN_SAFE_SCREENSHOT", width: viewport.width, screenshot })}\n`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false,
      `First-admin page must not overflow at ${viewport.width}px`);
    const nav = page.getByRole("navigation", { name: "Администрирование платформы", exact: true });
    assert.equal(await nav.getByRole("link").count(), 4);
    for (const label of ["Обзор", "Организации", "Пользователи", "Аудит"]) {
      const link = nav.getByRole("link", { name: label, exact: true });
      assert.equal(await link.isVisible(), true);
      assert.equal(await link.locator("span").evaluate((element) => element.scrollWidth > element.clientWidth + 1
        || element.scrollHeight > element.clientHeight + 1), false, `Navigation label must not be truncated at ${viewport.width}px`);
    }
    for (const control of await form.locator("select, textarea, input, button").all()) {
      await control.scrollIntoViewIfNeeded();
      assert.equal(await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1 && rect.width > 0 && rect.height >= 44;
      }), true, `First-admin controls must fit and retain touch targets at ${viewport.width}px`);
    }
    assert.equal(await submit.isEnabled(), true);
    assert.equal(await submit.evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const text = range.getBoundingClientRect(), box = element.getBoundingClientRect();
      return text.left >= box.left && text.right <= box.right + 1 && text.top >= box.top && text.bottom <= box.bottom + 1;
    }), true, `Submit label must not be clipped at ${viewport.width}px`);
    await page.addScriptTag({ path: axePath });
    const violations = await page.evaluate(async () => (await window.axe.run(document)).violations
      .filter((violation) => ["critical", "serious"].includes(violation.impact))
      .map((violation) => ({ id: violation.id, impact: violation.impact, targets: violation.nodes.map((node) => node.target) })));
    if (violations.length) process.stderr.write(`${JSON.stringify({ code: "CPO_FIRST_ADMIN_ACCESSIBILITY_FAILED", width: viewport.width, violations })}\n`);
    assert.equal(violations.length, 0, `First-admin accessibility at ${viewport.width}px`);
    firstAdminUi.push({ width: viewport.width, criticalSeriousAccessibility: 0, overflow: false, navLabelsTruncated: false, screenshot });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await submit.scrollIntoViewIfNeeded();
}

async function main() {
  const anonymous = await session();
  await anonymous.page.goto(`${origin}/agent/login`);
  assert.equal((await command(anonymous.context, firstAdminPath, "POST", bootstrapBody)).status(), 401);
  assert.equal((await command(anonymous.context, `/api/agent/cases/${fixture.cases.safe.leadId}/intake`, "PATCH", correctionBody)).status(), 401);

  const owner = await session();
  await login(owner.page, fixture.ownerEmail, ownerMfa, "/platform-admin");
  assert.equal((await owner.context.cookies()).some((cookie) => cookie.name === "tihiydom_agent_session"), true);
  for (const identifier of [encodeURIComponent(fixture.organizationB), fixture.organizationB]) {
    const organizationPath = `/platform-admin/organizations/${identifier}`;
    const navigation = await owner.page.goto(`${origin}${organizationPath}`);
    try {
      assert.equal(navigation?.status(), 200, "Both encoded and bare-colon detail pages must render before any grant");
      await owner.page.getByRole("heading", { name: "Первый администратор", exact: true }).waitFor();
      await owner.page.getByRole("heading", { name: "Изолированный tenant M3", exact: true }).waitFor();
    } catch {
      await bootstrapNavigationDiagnostic(owner.page, navigation, organizationPath);
      throw new Error("CPO_BOOTSTRAP_NAVIGATION_FAILED");
    }
  }
  assert.equal((await command(owner.context, firstAdminPath, "POST", { ...bootstrapBody, confirmation: "wrong" })).status(), 400);
  await owner.page.getByLabel("Сотрудник", { exact: true }).selectOption(fixture.candidateMembershipId);
  await owner.page.getByLabel("Причина назначения").fill(bootstrapBody.reason);
  const assign = owner.page.getByRole("button", { name: "Назначить первого ADMIN", exact: true });
  assert.equal(await assign.isDisabled(), true);
  await owner.page.getByLabel("Подтверждение: НАЗНАЧИТЬ АДМИНИСТРАТОРА", { exact: true }).fill("wrong");
  assert.equal(await assign.isDisabled(), true);
  await owner.page.getByLabel("Подтверждение: НАЗНАЧИТЬ АДМИНИСТРАТОРА", { exact: true }).fill(bootstrapBody.confirmation);
  await assertFirstAdminViewports(owner.page);
  let firstKey;
  let firstPayload;
  // Forward the real commit, discard only its response, then exercise the UI's replay.
  await owner.page.route(`${origin}${firstAdminPath}`, asyncScope.guard(async (route) => {
    firstKey = route.request().headers()["idempotency-key"];
    firstPayload = route.request().postData();
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    await route.abort("failed");
  }), { times: 1 });
  await assign.click();
  await owner.page.getByRole("status").filter({ hasText: "Нет связи" }).waitFor();
  const replayPending = observeLegacyPromise(owner.page.waitForResponse((response) => new URL(response.url()).pathname === firstAdminPath && response.request().method() === "POST"));
  await assign.click();
  const replay = await replayPending;
  assert.equal(replay.status(), 200);
  assert.ok(firstKey);
  assert.equal(replay.request().headers()["idempotency-key"], firstKey);
  assert.equal(replay.request().postData(), firstPayload);
  await owner.page.reload();
  assert.equal(await owner.page.getByRole("heading", { name: "Первый администратор", exact: true }).count(), 0);
  const member = owner.page.locator("section").filter({ has: owner.page.getByRole("heading", { name: "Сотрудники", exact: true }) });
  await member.getByText(identities.foreign, { exact: true }).waitFor();
  assert.equal(await member.getByText("ADMIN", { exact: true }).count(), 1);
  assert.equal((await command(owner.context, firstAdminPath, "POST", bootstrapBody)).status(), 409);

  const admin = await session();
  await login(admin.page, identities.foreign, null, "/agent/cases");
  assert.equal((await command(admin.context, firstAdminPath, "POST", bootstrapBody)).status(), 403);
  assert.equal((await command(admin.context, `/api/agent/cases/${fixture.cases.safe.leadId}/intake`, "PATCH", correctionBody)).status(), 403);
  await admin.page.goto(`${origin}/agent/settings/team`);
  await admin.page.getByRole("heading", { name: "Команда и доступы", exact: true }).waitFor();
  for (const [role, label] of [["FINANCE", "Финансы"], ["DOCUMENT_REVIEWER", "Проверяющий документы"], ["MANAGER", "Руководитель"]]) {
    if (!await admin.page.getByLabel("Рабочий email").isVisible()) await admin.page.getByRole("button", { name: "Пригласить сотрудника", exact: true }).click();
    const email = `m3-cpo-invite-${role.toLowerCase()}-${runId}@synthetic.invalid`;
    await admin.page.getByLabel("Рабочий email").fill(email);
    const inviteForm = admin.page.locator("form").filter({ has: admin.page.getByLabel("Рабочий email") });
    await inviteForm.getByText("Роль", { exact: true }).waitFor();
    await inviteForm.getByRole("combobox").selectOption(role);
    const pending = observeLegacyPromise(admin.page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agent/invitations" && response.request().method() === "POST"));
    await admin.page.getByRole("button", { name: "Создать ссылку", exact: true }).click();
    assert.equal((await pending).status(), 201);
    const row = admin.page.locator("article").filter({ hasText: email });
    await row.getByText(label, { exact: true }).waitFor();
    await admin.page.getByText(/Ссылка показана один раз/).waitFor();
  }

  const agent = await session();
  await login(agent.page, identities.agent, null, "/agent/cases");
  assert.equal((await command(agent.context, firstAdminPath, "POST", bootstrapBody)).status(), 403);
  await assertCeremony(agent.page, fixture.cases.safe.leadId, "кремация");
  await assertDocuments(agent.page, false);
  assert.equal((await intake(agent.page, fixture.cases.safe.leadId, false)).status(), 422);
  await agent.page.getByRole("alert").filter({ hasText: "Подтвердите исправление сценария" }).waitFor();
  await assertCeremony(agent.page, fixture.cases.safe.leadId, "кремация");
  assert.equal((await intake(agent.page, fixture.cases.safe.leadId, true)).status(), 200);
  await assertCeremony(agent.page, fixture.cases.safe.leadId, "погребение");
  await assertDocuments(agent.page, true);
  const blocked = await intake(agent.page, fixture.cases.published.leadId, true);
  assert.equal(blocked.status(), 422);
  assert.match((await blocked.json()).error, /опубликованной сметой/);
  await agent.page.getByRole("alert").filter({ hasText: "история не изменена" }).waitFor();
  await assertCeremony(agent.page, fixture.cases.published.leadId, "кремация");
  await assertDocuments(agent.page, false);

  for (const [role, secret, landing] of [["manager", null, "/agent/cases"], ["reviewer", null, "/agent/document-review"], ["finance-a", mfa, "/agent/finance"]]) {
    const reader = await session();
    await login(reader.page, identities[role], secret, landing);
    assert.equal((await command(reader.context, firstAdminPath, "POST", bootstrapBody)).status(), 403);
    assert.equal((await command(reader.context, `/api/agent/cases/${fixture.cases.safe.leadId}/intake`, "PATCH", correctionBody)).status(), role === "manager" ? 404 : 403);
    assert.equal((await command(reader.context, "/api/agent/invitations", "POST", { email: `m3-cpo-denied-${runId}@synthetic.invalid`, role: "MANAGER" })).status(), 403);
    if (role === "manager") {
      await reader.page.goto(`${origin}/agent/cases/${fixture.cases.safe.leadId}`);
      await reader.page.getByRole("tab", { name: /Семья/ }).click();
      assert.equal(await reader.page.getByRole("button", { name: "погребение", exact: true }).isDisabled(), true);
      assert.equal(await reader.page.getByRole("button", { name: "Сохранить изменения", exact: true }).count(), 0);
      assert.equal(await reader.page.getByLabel("Подтверждаю исправление сценария").count(), 0);
    }
  }
  // These two injected failures prove mobile UI feedback only, not backend session security.
  await owner.page.setViewportSize({ width: 390, height: 844 });
  await owner.page.goto(`${origin}/platform-admin`);
  await owner.page.getByRole("heading", { name: "Обзор платформы", exact: true }).waitFor();
  const shell = owner.page.locator("aside");
  const revokeUrl = `${origin}/api/platform-admin/sessions/revoke`;
  let revokeCalls = 0;
  const revokeFailure = asyncScope.guard(async (route) => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    revokeCalls++;
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Synthetic mocked stale session" }) });
  });
  await owner.page.route(revokeUrl, revokeFailure);
  try {
    await shell.getByRole("button", { name: "Завершить другие сеансы", exact: true }).click();
    await shell.getByRole("alert").filter({ hasText: "Состояние сеанса изменилось. Войдите снова." }).waitFor();
    const loginLink = shell.getByRole("link", { name: "Войти снова", exact: true });
    assert.equal(await loginLink.isVisible(), true);
    assert.equal(await loginLink.getAttribute("href"), "/agent/login");
    assert.equal(await shell.getByText("Другие сеансы завершены.", { exact: true }).count(), 0);
    assert.equal(new URL(owner.page.url()).pathname, "/platform-admin");
    assert.equal(revokeCalls, 1);
  } finally { await owner.page.unroute(revokeUrl, revokeFailure); }

  const logoutUrl = `${origin}/api/agent/auth/logout`;
  let logoutCalls = 0;
  const logoutFailure = asyncScope.guard(async (route) => {
    if (route.request().method() !== "POST") { await route.fallback(); return; }
    logoutCalls++;
    mockedLogoutFailures.add(route.request());
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic mocked logout outage" }) });
  });
  await owner.page.route(logoutUrl, logoutFailure);
  try {
    await shell.getByRole("button", { name: "Выйти", exact: true }).click();
    await shell.getByRole("alert").filter({ hasText: "Не удалось подтвердить выход. Повторите попытку." }).waitFor();
    assert.equal(new URL(owner.page.url()).pathname, "/platform-admin");
    assert.equal(logoutCalls, 1);
    assert.equal(observedMockLogoutFailures, 1);
    assert.equal(mockedLogoutFailures.size, 0);
  } finally { await owner.page.unroute(logoutUrl, logoutFailure); }

  const actualLogout = observeLegacyPromise(owner.page.waitForResponse((response) => response.url() === logoutUrl && response.request().method() === "POST"));
  await Promise.all([
    observeLegacyPromise(owner.page.waitForURL((url) => url.pathname === "/agent/login")),
    shell.getByRole("button", { name: "Выйти", exact: true }).click(),
  ]);
  assert.equal((await actualLogout).status(), 200);
  assert.equal((await owner.context.cookies()).some((cookie) => cookie.name === "tihiydom_agent_session"), false);
  await owner.page.goto(`${origin}/platform-admin`);
  await observeLegacyPromise(owner.page.waitForURL((url) => url.pathname === "/agent/login"));
  assert.deepEqual(failures, []);
  await asyncScope.settle();
  process.stdout.write(`${JSON.stringify({ firstAdmin: "PASS", lostResponseReplay: "PASS", invites: 3, scenarioCorrection: "PASS", publicationGuard: "PASS", permissions: "PASS",
    sessionFailureFeedback: "PASS_MOCKED_UI_ONLY_409_503", logout: "PASS_REAL_COOKIE_CLEAR_AND_PROTECTED_REDIRECT", firstAdminUi, skipped: 0 })}\n`);
}

await main();

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const bytes = [];
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

}

try {
  await run();
} catch (error) {
  process.stderr.write(sanitizedCpoFailure(error));
  process.exitCode = 1;
} finally {
  try {
    try { await closeResources(); } finally { await asyncScope.settle(); }
  } catch (error) {
    process.stderr.write(sanitizedCpoFailure(error));
    process.exitCode = 1;
  }
}
