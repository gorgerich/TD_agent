import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fillProtected, observeLegacyPromise, legacySecretScreenshotOptions } from "./protectedInput.mjs";
import { createLocalClientHeaders } from "./localClientIdentity.mjs";

export async function verifyRealOrganizationOnboarding({ browser, platformPage, baseUrl, runId, password, totp, screenshot }) {
  const origin = new URL(baseUrl);
  assert.equal(process.env.M2_UAT_FIXTURE, "1");
  assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname)
    || /^td-agent-[a-z0-9]+-rics-projects-9baa2793\.vercel\.app$/.test(origin.hostname));
  assert.notEqual(origin.hostname, "td-agent.vercel.app");
  const contexts = [];
  const nextLocalClientHeaders = createLocalClientHeaders(baseUrl);
  const serverFailures = [];
  const members = [];
  const expectedEmails = new Map();
  let organizationId;
  const headers = { "idempotency-key": `${runId}:real-org`, "x-correlation-id": `${runId}:real-org` };
  async function request(context, method, url, options = {}) {
    const target = new URL(url);
    assert.equal(target.origin, origin.origin);
    const page = context.pages()[0] ?? await context.newPage();
    let result;
    try {
      if (new URL(page.url()).origin !== origin.origin) await page.goto(`${baseUrl}/agent/login`, { waitUntil: "domcontentloaded" });
      result = await page.evaluate(async ({ path, method, data, headers }) => {
        const response = await fetch(path, { method, credentials: "same-origin", redirect: "error", cache: "no-store",
          headers: { ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        return { status: response.status, body: await response.json() };
      }, { path: target.pathname, method, data: options.data, headers: options.headers ?? {} });
    } catch { throw new Error("ONBOARDING_BROWSER_REQUEST_FAILED"); }
    return { status: () => result.status, json: async () => result.body };
  }
  async function freshContext() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ru-RU",
      extraHTTPHeaders: { ...nextLocalClientHeaders(),
        ...(process.env.E2E_PROTECTION_BYPASS?.trim() ? { "x-vercel-protection-bypass": process.env.E2E_PROTECTION_BYPASS.trim() } : {}) },
    });
    contexts.push(context);
    context.on("response", response => { if (response.status() >= 500) serverFailures.push(response.status()); });
    return context;
  }
  async function register(context, email, token, useBrowser = false) {
    if (!useBrowser) {
      const response = await request(context, "POST", `${baseUrl}/api/agent/auth/register`, {
        data: { name: "Synthetic onboarding staff", email, password, inviteToken: token },
      });
      assert.equal(response.status(), 200);
      return;
    }
    const page = await context.newPage();
    try { await page.goto(`${baseUrl}/agent/login#invite=${encodeURIComponent(token)}`, { waitUntil: "domcontentloaded" }); }
    catch { throw new Error("ONBOARDING_INVITATION_NAVIGATION_FAILED"); }
    await page.locator("#agent-name").fill("Synthetic organization administrator");
    assert.equal(new URL(page.url()).hash, "");
    await page.locator("#agent-email").fill(email);
    await fillProtected(page.locator("#agent-password"), password);
    const response = observeLegacyPromise(page.waitForResponse(response => new URL(response.url()).pathname === "/api/agent/auth/register"));
    await page.locator('form button[type="submit"]').click();
    assert.equal((await response).status(), 200);
    await page.waitForURL(url => url.pathname === "/agent/cases");
  }
  async function login(context, email, nextPassword, expected, secret) {
    await context.clearCookies();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/agent/login`, { waitUntil: "networkidle" });
    await page.locator("#agent-email").fill(email);
    await fillProtected(page.locator("#agent-password"), nextPassword);
    if (secret) {
      await page.locator('form button[type="submit"]').click();
      await fillProtected(page.locator("#platform-mfa-code"), totp(secret));
    }
    await Promise.all([observeLegacyPromise(page.waitForURL(url => url.pathname === expected)), page.locator('form button[type="submit"]').click()]);
    return page;
  }
  try {
    const adminEmail = `onboarding-admin-${runId}@synthetic.invalid`;
    expectedEmails.set("ADMIN", adminEmail);
    const createdResponse = await request(platformPage.context(), "POST", `${baseUrl}/api/platform-admin/organizations`, {
      headers, data: { name: `Synthetic onboarding ${runId}`, slug: `onboarding-${runId}`, timezone: "Europe/Moscow",
        email: adminEmail, reason: "Synthetic authenticated onboarding regression", confirmation: "НАЗНАЧИТЬ АДМИНИСТРАТОРА" },
    });
    if (createdResponse.status() !== 201) {
      console.log(JSON.stringify({ stage: "ONBOARDING_ORGANIZATION_CREATE", status: createdResponse.status() }));
    }
    assert.equal(createdResponse.status(), 201);
    const created = await createdResponse.json();
    assert.equal(created.replayed, false);
    organizationId = created.organizationId;
    assert.equal(typeof organizationId, "string");
    const adminContext = await freshContext();
    await register(adminContext, adminEmail, new URLSearchParams(new URL(created.inviteUrl).hash.slice(1)).get("invite"), true);
    await login(adminContext, adminEmail, password, "/agent/cases");
    assert.equal((await request(adminContext, "GET", `${baseUrl}/api/platform-admin/dashboard`)).status(), 403);
    const organization = await (await request(platformPage.context(), "GET", `${baseUrl}/api/platform-admin/organizations/${encodeURIComponent(organizationId)}`)).json();
    assert.equal(organization.memberships.length, 1);
    assert.equal(organization.memberships[0].role, "ADMIN");
    assert.equal(organization.memberships[0].user.email, adminEmail);
    members.push({ id: organization.memberships[0].id, userId: organization.memberships[0].user.id, role: "ADMIN" });
    let finance;
    for (const role of ["AGENT", "MANAGER", "DOCUMENT_REVIEWER", "FINANCE"]) {
      const email = `onboarding-${role.toLowerCase()}-${runId}@synthetic.invalid`;
      expectedEmails.set(role, email);
      const invitation = await request(adminContext, "POST", `${baseUrl}/api/agent/invitations`, {
        headers: { ...headers, "idempotency-key": `${runId}:onboarding:${role}` }, data: { email, role },
      });
      assert.equal(invitation.status(), 201);
      const bearer = (await invitation.json()).token;
      const memberContext = await freshContext();
      await register(memberContext, email, bearer);
      const target = role === "FINANCE" ? "/setup/platform-admin-mfa" : role === "DOCUMENT_REVIEWER" ? "/agent/document-review" : "/agent/cases";
      const page = await login(memberContext, email, password, target);
      assert.equal((await request(memberContext, "GET", `${baseUrl}/api/platform-admin/dashboard`)).status(), 403);
      const dimensions = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(dimensions[0] <= dimensions[1] + 1, "Onboarded role must not horizontally overflow");
      if (role === "FINANCE") {
        const secret = await page.locator("code").textContent();
        assert.match(secret, /^[A-Z2-7]{32}$/);
        await fillProtected(page.getByLabel("Код подтверждения"), totp(secret));
        await Promise.all([observeLegacyPromise(page.waitForURL(url => url.pathname === "/agent/finance")), page.getByRole("button", { name: "Включить защиту" }).click()]);
        assert.equal((await request(memberContext, "GET", `${baseUrl}/api/agent/finance`)).status(), 200,
          "The session must read Finance before recovery, so later rejection cannot be a false positive");
        const staleContext = await freshContext();
        await staleContext.addCookies(await memberContext.cookies());
        assert.equal((await request(staleContext, "GET", `${baseUrl}/api/agent/finance`)).status(), 200,
          "Copied session must authenticate through the same transport before recovery invalidates it");
        finance = { email, page, context: memberContext, staleContext };
      }
      if (screenshot) await screenshot(page, `onboarding-${role.toLowerCase()}-mobile.png`, legacySecretScreenshotOptions(page));
    }
    const complete = await (await request(platformPage.context(), "GET", `${baseUrl}/api/platform-admin/organizations/${encodeURIComponent(organizationId)}`)).json();
    assert.equal(complete.memberships.length, 5);
    for (const [role, email] of expectedEmails) {
      const member = complete.memberships.find(member => member.user.email === email);
      assert.ok(member, "Each invited identity must belong to the created organization");
      assert.equal(member.role, role);
      assert.equal(member.status, "ACTIVE");
      assert.equal(member.user.platformRole, "USER");
      assert.equal(member.agent.status, "ACTIVE");
    }
    const financeMember = complete.memberships.find(member => member.role === "FINANCE");
    for (const member of complete.memberships.filter(member => member.role !== "ADMIN")) members.push({ id: member.id, userId: member.user.id, role: member.role });
    const recovery = await request(platformPage.context(), "POST", `${baseUrl}/api/platform-admin/staff-recovery`, {
      headers: { ...headers, "idempotency-key": `${runId}:staff-recovery` },
      data: { organizationId, membershipId: financeMember.id, confirmation: "ВОССТАНОВИТЬ ДОСТУП СОТРУДНИКА", reason: "Synthetic lost Finance MFA recovery" },
    });
    assert.equal(recovery.status(), 201);
    const issued = await recovery.json();
    assert.equal(issued.resetMfa, true);
    const recoveryContext = await freshContext();
    const recoveryPage = await recoveryContext.newPage();
    const checked = observeLegacyPromise(recoveryPage.waitForResponse(response => new URL(response.url()).pathname === "/api/agent/auth/staff-recovery"));
    try { await recoveryPage.goto(issued.url, { waitUntil: "domcontentloaded" }); }
    catch { throw new Error("STAFF_RECOVERY_NAVIGATION_FAILED"); }
    const setupResponse = await checked;
    assert.equal(setupResponse.status(), 200);
    const setup = await setupResponse.json();
    await recoveryPage.getByLabel("Новый пароль", { exact: true }).waitFor();
    assert.equal(new URL(recoveryPage.url()).hash, "");
    await recoveryPage.setViewportSize({ width: 195, height: 844 });
    assert.equal(await recoveryPage.getByRole("heading", { level: 1 }).evaluate(async heading => {
      const computed = getComputedStyle(heading);
      const normalize = family => family.trim().replace(/^["']|["']$/g, "");
      const family = normalize(computed.fontFamily.split(",")[0]);
      if (!/Golos/i.test(family)) return false;
      const faces = await document.fonts.load(computed.font, heading.textContent);
      await document.fonts.ready;
      return faces.some(face => normalize(face.family) === family && face.status === "loaded");
    }), true, "Load the actual Golos face before measuring; a fallback-only pass is not font acceptance");
    assert.equal(await recoveryPage.getByRole("heading", { level: 1 }).evaluate(heading => {
      const range = document.createRange();
      range.setStart(heading.firstChild, 0);
      range.setEnd(heading.firstChild, heading.textContent.trimStart().split(/\s/)[0].length);
      return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
    }), 1, "Authenticated recovery heading must stay whole in the actual application font at195px");
    assert.equal(await recoveryPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
      "Authenticated recovery must not horizontally overflow at195px");
    if (screenshot) await screenshot(recoveryPage, "staff-recovery-authenticated-195.png", legacySecretScreenshotOptions(recoveryPage));
    await recoveryPage.setViewportSize({ width: 390, height: 844 });
    const nextPassword = `${randomBytes(32).toString("base64url")}!Aa9`;
    await fillProtected(recoveryPage.getByLabel("Новый пароль", { exact: true }), nextPassword);
    await fillProtected(recoveryPage.getByLabel("Повторите пароль"), nextPassword);
    await fillProtected(recoveryPage.getByLabel("Код из приложения"), totp(setup.mfaSecret));
    if (screenshot) await screenshot(recoveryPage, "staff-recovery-authenticated-mobile.png", legacySecretScreenshotOptions(recoveryPage));
    await Promise.all([observeLegacyPromise(recoveryPage.waitForURL(url => url.pathname === "/agent/finance")), recoveryPage.getByRole("button", { name: "Восстановить доступ", exact: true }).click()]);
    assert.equal((await request(finance.staleContext, "GET", `${baseUrl}/api/agent/finance`)).status(), 401);
    const oldLogin = await request(finance.context, "POST", `${baseUrl}/api/agent/auth/login`, { data: { email: finance.email, password } });
    assert.equal(oldLogin.status(), 401);
    await login(recoveryContext, finance.email, nextPassword, "/agent/finance", setup.mfaSecret);
    const token = new URLSearchParams(new URL(issued.url).hash.slice(1)).get("token");
    const replay = await request(recoveryContext, "POST", `${baseUrl}/api/agent/auth/staff-recovery`, { data: { action: "VERIFY", token } });
    assert.equal(replay.status(), 400);
    assert.equal(serverFailures.length, 0, "No unexpected server failure is allowed during onboarding or recovery");
    console.log(JSON.stringify({ status: "AUTHENTICATED_ORGANIZATION_ONBOARDING_AND_FINANCE_RECOVERY_PASS", organizationId, members, simulatedTransport: false }));
  } finally {
    if (organizationId) {
      const suspended = await request(platformPage.context(), "PATCH", `${baseUrl}/api/platform-admin/organizations/${encodeURIComponent(organizationId)}`, {
        data: { status: "SUSPENDED", confirmation: "ПРИОСТАНОВИТЬ ОРГАНИЗАЦИЮ" },
      });
      assert.equal(suspended.status(), 200, "Synthetic onboarding organization must be contained");
    }
    for (const context of contexts) await context.close();
  }
}
