import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { createLegacyAsyncScope, fillProtected, legacySecretScreenshotOptions } from "./e2e/protectedInput.mjs";

// Real components/CSS, synthetic intercepted transport only. This is not an
// authenticated server, TOTP cryptography test, deployed UAT or release proof.
const TOKEN = "S".repeat(43);
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const PASSWORD = "Synthetic staff browser password!";
const CODE = "123456";
const INVALID = "Ссылка недействительна, истекла или уже была использована.";
const CONFIRMATION = "ВОССТАНОВИТЬ ДОСТУП СОТРУДНИКА";
const MEMBERSHIP_LABEL = "Организация с длинным названием: FINANCE";
let stage = "bootstrap", output, browser, server, current;
const screenshots = [];

function ensure(condition, message = "Component regression") { assert.ok(condition, message); }
function secretScreenshot(page) {
  const base = legacySecretScreenshotOptions(page);
  return { ...base, animations: "disabled", caret: "hide", fullPage: true,
    style: `${base.style} [data-sensitive] { visibility: hidden !important; }`,
    mask: [...base.mask, page.locator("[data-sensitive]")] };
}
async function saveImage(page, name, bytes) {
  const image = bytes ?? await page.screenshot(secretScreenshot(page));
  await writeFile(path.join(output, name), image, { mode: 0o600 });
  screenshots.push({ file: name, sha256: createHash("sha256").update(image).digest("hex"), masked: true });
}
async function maskChallenge(page, name) {
  const before = await page.screenshot(secretScreenshot(page));
  const rawBefore = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });
  await page.evaluate(() => {
    window.__secretRestore = [];
    for (const element of document.querySelectorAll('input[type="password"], input[autocomplete="one-time-code"], [data-sensitive] textarea, [data-sensitive] code')) {
      const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
      const value = field ? element.value : element.textContent;
      window.__secretRestore.push({ element, field, value });
      if (field) element.value = "X".repeat(value.length);
      else element.textContent = "X".repeat(value.length);
    }
    for (const svg of document.querySelectorAll('[data-sensitive] svg')) {
      window.__secretRestore.push({ element: svg, svg: true, value: svg.innerHTML });
      svg.innerHTML = '<rect width="128" height="128" fill="black"/>';
    }
  });
  try {
    ensure((await page.screenshot(secretScreenshot(page))).equals(before), "Masked pixels must not depend on secrets");
    ensure(!(await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" })).equals(rawBefore), "Mask negative control must actually change visible pixels");
  } finally {
    await page.evaluate(() => {
      for (const item of window.__secretRestore) {
        if (item.svg) item.element.innerHTML = item.value;
        else if (item.field) item.element.value = item.value;
        else item.element.textContent = item.value;
      }
      delete window.__secretRestore;
    });
  }
  // Raw screenshots stay in memory; only the masked proof is written.
  await saveImage(page, name, before);
}

async function reflow(page) {
  const clipped = await page.locator("h1,h2,p,label,button,code,input,textarea,select,[role=img]").evaluateAll((elements) => elements.flatMap((element, index) => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(element).visibility === "hidden") return [];
    if (box.left < -1 || box.right > document.documentElement.clientWidth + 1) return [index];
    if (element.matches("input,textarea,select,[role=img]")) return [];
    let left = Math.max(0, box.left), right = Math.min(document.documentElement.clientWidth, box.right);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(parent).overflowX)) {
        const clip = parent.getBoundingClientRect(); left = Math.max(left, clip.left); right = Math.min(right, clip.right);
      }
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || node.parentElement?.closest("input,textarea,select")) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.left < left - 1 || rect.right > right + 1 || rect.top < box.top - 1 || rect.bottom > box.bottom + 1) return [index];
    }
    return [];
  }));
  assert.deepEqual(clipped, [], "Visible text/controls must fit their boxes and clipping ancestors");
  ensure(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No body overflow");
  if (await page.getByRole("heading", { level: 1 }).count()) {
    const firstWordLines = await page.getByRole("heading", { level: 1 }).evaluate((heading) => {
      const node = heading.firstChild;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, node.textContent.trimStart().split(/\s/)[0].length);
      const original = heading.style.fontFamily;
      try {
        return [original, "Arial, sans-serif", "Liberation Sans, sans-serif", "system-ui, sans-serif"].map((family) => {
          heading.style.fontFamily = family;
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        });
      } finally { heading.style.fontFamily = original; }
    });
    assert.deepEqual(firstWordLines, [1, 1, 1, 1], "Recovery heading must keep its first word whole with system fallback fonts");
  }
}

async function selectedMembershipReadable(page) {
  const clipped = await page.getByRole("combobox").evaluate((select) => {
    const canvas = document.createElement("canvas"); const context = canvas.getContext("2d");
    context.font = getComputedStyle(select).font;
    return context.measureText(select.selectedOptions[0].textContent).width > select.clientWidth - 40;
  });
  if (clipped) ensure(await page.locator("p").getByText(MEMBERSHIP_LABEL, { exact: true }).isVisible(), "A clipped native select needs a visible complete selection label");
}

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

async function fixture(width, kind, initial = "hold") {
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const state = { verify: initial, recover: "ok", issue: "hold", revoke: "ok", gate: deferred(), calls: [], errors: [], logs: [], statusBudgets: new Map(), abortBudget: 0, navigations: 0 };
  const scope = createLegacyAsyncScope(() => context.close());
  page.on("console", (message) => {
    state.logs.push(message.text());
    if (message.type() !== "error") return;
    const status = /Failed to load resource: the server responded with a status of (400|422|429|503)/.exec(message.text());
    if (status && (state.statusBudgets.get(Number(status[1])) ?? 0) > 0) {
      state.statusBudgets.set(Number(status[1]), state.statusBudgets.get(Number(status[1])) - 1);
    } else if (/Failed to load resource: net::ERR_FAILED/.test(message.text()) && state.abortBudget > 0) state.abortBudget--;
    else state.errors.push("unexpected-console-error");
  });
  page.on("pageerror", (error) => { state.logs.push(error.message); state.errors.push("pageerror"); });
  await page.route("**/*", scope.guard(async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    ensure(url.origin === origin, "External browser requests forbidden");
    for (const value of [TOKEN, SECRET, PASSWORD, CODE]) ensure(!request.url().includes(value) && !(request.headers().referer ?? "").includes(value), "Secrets must not enter network URLs/referrers");
    if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
    ensure(request.method() === "POST" || request.method() === "DELETE", "Only explicit synthetic commands");
    ensure(["/api/agent/auth/staff-recovery", "/api/platform-admin/staff-recovery"].includes(url.pathname));
    const body = request.postDataJSON();
    const action = url.pathname.startsWith("/api/platform-admin/") ? request.method() === "DELETE" ? "revoke" : "issue" : body.action === "VERIFY" ? "verify" : "recover";
    state.calls.push({ action, body, key: request.headers()["idempotency-key"], correlation: request.headers()["x-correlation-id"] });
    if (action === "verify" || action === "recover") {
      ensure(body.token === TOKEN); ensure(new URL(page.url()).hash === "", "Fragment removed before first API request");
    }
    if (action === "recover") ensure(body.password === PASSWORD && body.confirmation === PASSWORD
      && body.mfaCode === (state.recover === "wrong-code" ? "000000" : CODE), "Actual form must submit the complete synthetic confirmation");
    let mode = state[action];
    if (mode === "hold") { await state.gate.promise; mode = state[action]; }
    if (mode === "abort") { state.abortBudget++; await route.abort("failed"); return; }
    const status = mode === "invalid" || mode === "expired" || mode === "wrong-code" ? 400 : mode === "rate" ? 429 : mode === "failure" ? 503 : mode === "password" ? 422 : action === "issue" && mode === "ok" ? 201 : 200;
    if (action === "recover" && mode === "expired") state.verify = "expired";
    if (status >= 400) state.statusBudgets.set(status, (state.statusBudgets.get(status) ?? 0) + 1);
    let result;
    if (status === 400) result = { error: INVALID };
    else if (status !== 200 && status !== 201) result = { error: "Synthetic service rejection" };
    else if (mode === "malformed") result = {};
    else if (action === "verify") result = { valid: true, mfaSecret: SECRET, mfaUri: `otpauth://totp/Synthetic?secret=${SECRET}`, resetMfa: true };
    else if (action === "recover") result = { ok: true, redirectTo: mode === "unsafe-redirect" ? "https://attacker.invalid" : "/agent/finance" };
    else if (action === "issue") result = { id: "synthetic-recovery", expiresAt: "2026-10-20T12:15:00Z", replayed: mode === "replay", ...(mode === "replay" ? {} : { url: `${origin}/setup/staff-recovery#token=${TOKEN}` }) };
    else result = { ok: true };
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
  }));
  async function navigate(fragment = TOKEN) {
    state.navigations++;
    await page.goto(`${origin}/${kind}?instance=${state.navigations}${fragment ? `#token=${fragment}` : ""}`);
  }
  async function finish() {
    scope.check();
    for (const log of state.logs) for (const value of [TOKEN, SECRET, PASSWORD, CODE]) ensure(!log.includes(value), "Browser log canary leaked");
    assert.deepEqual(state.errors, [], "No unexpected browser errors");
    ensure(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), "Recovery secrets stay out of browser storage");
  }
  async function close() { state.gate.resolve(); await context.close(); await scope.settle(); }
  const result = { page, state, navigate, finish, close };
  current = result;
  return result;
}

async function client(width) {
  const f = await fixture(width, "recover"); const { page, state } = f;
  try {
    stage = `client-loading-${width}`;
    await f.navigate();
    await page.getByRole("status").getByText("Проверяем ссылку...", { exact: true }).waitFor();
    await page.waitForFunction(() => location.hash === "" && location.search === "");
    ensure(await page.locator("form").count() === 0);
    await reflow(page); await saveImage(page, `client-loading-${width}.png`);
    state.verify = "failure"; state.gate.resolve();
    await page.getByRole("alert").getByText("Проверка недоступна. Повторите позже.", { exact: true }).waitFor();
    for (const mode of ["rate", "abort", "malformed", "ok"]) {
      stage = `client-verify-${mode}-${width}`; state.verify = mode;
      const calls = state.calls.length;
      await page.getByRole("button", { name: "Повторить проверку", exact: true }).click();
      if (mode === "ok") await page.getByLabel("Новый пароль", { exact: true }).waitFor();
      else await page.getByRole("button", { name: "Повторить проверку", exact: true }).waitFor();
      ensure(state.calls.length === calls + 1);
    }
    stage = `client-setup-${width}`;
    ensure(await page.getByRole("img", { name: "QR-код для приложения-аутентификатора" }).locator("svg").count() === 1);
    ensure(await page.locator('[data-sensitive="staff-recovery-mfa"] code').textContent() === SECRET);
    const password = page.getByLabel("Новый пароль", { exact: true });
    const confirmation = page.getByLabel("Повторите пароль", { exact: true });
    const code = page.getByLabel("Код из приложения", { exact: true });
    await fillProtected(password, PASSWORD); await fillProtected(confirmation, `${PASSWORD}x`); await fillProtected(code, "12ab34");
    ensure(await code.inputValue() === "1234");
    await fillProtected(code, CODE);
    ensure(await code.inputValue() === CODE);
    const submit = page.getByRole("button", { name: "Восстановить доступ", exact: true });
    ensure(await submit.isDisabled());
    const beforeMismatch = state.calls.length;
    await page.locator("form").evaluate((form) => form.requestSubmit());
    await page.getByRole("alert").getByText("Пароли не совпадают.", { exact: true }).waitFor();
    ensure(state.calls.length === beforeMismatch, "Mismatched password must not reach transport");
    await fillProtected(confirmation, PASSWORD);
    await reflow(page); await maskChallenge(page, `client-setup-${width}.png`);
    for (const mode of ["password", "rate", "failure", "abort", "malformed"]) {
      stage = `client-consume-${mode}-${width}`; state.recover = mode;
      await submit.click();
      await page.getByRole("alert").waitFor();
      await page.waitForFunction(() => !document.querySelector("fieldset").disabled);
      ensure(await password.inputValue() === PASSWORD && await confirmation.inputValue() === PASSWORD && await code.inputValue() === CODE, "Retry retains only the pending synthetic form");
      await reflow(page);
    }
    const attempts = state.calls.filter((call) => call.action === "recover");
    ensure(attempts.length === 5); for (const call of attempts) assert.deepEqual(call.body, attempts[0].body);
    stage = `client-wrong-code-recheck-unavailable-${width}`;
    state.recover = "wrong-code"; state.verify = "failure";
    await fillProtected(code, "000000");
    await submit.click();
    await page.getByRole("alert").getByText("Проверка недоступна. Повторите позже.", { exact: true }).waitFor();
    ensure(await password.inputValue() === PASSWORD && await confirmation.inputValue() === PASSWORD,
      "Temporary eligibility failure must not discard the in-memory pending recovery");
    stage = `client-wrong-code-still-valid-${width}`;
    state.verify = "ok";
    await submit.click();
    await page.getByRole("alert").getByText("Не удалось восстановить доступ. Проверьте код из приложения и повторите.", { exact: true }).waitFor();
    ensure(await code.inputValue() === "");
    ensure(await password.inputValue() === PASSWORD && await confirmation.inputValue() === PASSWORD);
    await fillProtected(code, CODE);
    stage = `client-consume-held-${width}`;
    state.recover = "hold"; state.gate = deferred();
    await submit.click();
    await page.waitForFunction(() => document.querySelector("fieldset").disabled);
    await page.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    ensure(state.calls.filter((call) => call.action === "recover").length === 8, "In-flight submit has exactly one transport command");
    state.recover = "ok"; state.gate.resolve();
    await page.getByRole("status").getByText("Доступ восстановлен. Старые сессии отозваны.", { exact: true }).waitFor();
    ensure(new URL(page.url()).pathname === "/agent/finance");
    ensure(await page.evaluate(() => window.__router.replace.length === 1 && window.__router.refresh === 1));
    ensure(await page.locator("input, [data-sensitive]").count() === 0);
    await reflow(page); await saveImage(page, `client-success-${width}.png`);
    for (const fragment of ["", "bad-fragment"]) {
      stage = `client-invalid-fragment-${width}`;
      const calls = state.calls.length; await f.navigate(fragment);
      await page.getByRole("alert").getByText(INVALID, { exact: true }).waitFor();
      ensure(state.calls.length === calls, "Invalid/missing fragment never reaches transport");
      await reflow(page);
    }
    stage = `client-expired-verify-${width}`;
    state.verify = "expired"; await f.navigate();
    await page.getByRole("alert").getByText(INVALID, { exact: true }).waitFor();
    ensure(await page.locator("form, [data-sensitive]").count() === 0);
    await reflow(page); await saveImage(page, `client-expired-${width}.png`);
    stage = `client-expired-consume-${width}`;
    state.verify = "ok"; state.recover = "expired"; await f.navigate();
    await page.getByLabel("Новый пароль", { exact: true }).waitFor();
    await fillProtected(page.getByLabel("Новый пароль", { exact: true }), PASSWORD);
    await fillProtected(page.getByLabel("Повторите пароль", { exact: true }), PASSWORD);
    await fillProtected(page.getByLabel("Код из приложения", { exact: true }), CODE);
    await page.getByRole("button", { name: "Восстановить доступ", exact: true }).click();
    await page.getByRole("alert").getByText(INVALID, { exact: true }).waitFor();
    ensure(await page.locator("form, [data-sensitive]").count() === 0);
    ensure(new URL(page.url()).pathname === "/recover");
    if (width === 195) {
      stage = "client-redirect-allowlist-195";
      state.verify = "ok"; state.recover = "unsafe-redirect"; await f.navigate();
      await page.getByLabel("Новый пароль", { exact: true }).waitFor();
      await fillProtected(page.getByLabel("Новый пароль", { exact: true }), PASSWORD);
      await fillProtected(page.getByLabel("Повторите пароль", { exact: true }), PASSWORD);
      await fillProtected(page.getByLabel("Код из приложения", { exact: true }), CODE);
      await page.getByRole("button", { name: "Восстановить доступ", exact: true }).click();
      await page.getByRole("status").getByText("Доступ восстановлен. Старые сессии отозваны.", { exact: true }).waitFor();
      ensure(new URL(page.url()).pathname === "/agent/cases", "External redirect is refused by actual component");
    }
    await f.finish();
  } catch (error) { await saveImage(page, `failure-${stage}.png`).catch(() => {}); throw error; }
  finally { await f.close(); current = undefined; }
}

async function issuer(width) {
  const f = await fixture(width, "issuer", "ok"); const { page, state } = f;
  try {
    stage = `issuer-ready-${width}`;
    await f.navigate("");
    const issue = page.getByRole("button", { name: "Выдать / повторить запрос", exact: true });
    await issue.waitFor(); ensure(await issue.isDisabled());
    await page.getByLabel("Причина", { exact: true }).fill("Synthetic identity verification");
    const confirm = page.getByLabel(`Подтверждение: ${CONFIRMATION}`, { exact: true });
    await confirm.fill("incorrect"); ensure(await issue.isDisabled());
    await confirm.fill(CONFIRMATION);
    await reflow(page); await selectedMembershipReadable(page);
    stage = `issuer-held-${width}`;
    await issue.click();
    await page.waitForFunction(() => document.querySelector("fieldset").disabled);
    await page.locator("form").evaluate((form) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    ensure(state.calls.length === 1);
    state.issue = "failure"; state.gate.resolve();
    await page.getByRole("status").waitFor();
    for (const mode of ["abort", "rate", "malformed", "replay"]) {
      stage = `issuer-retry-${mode}-${width}`; state.issue = mode;
      await issue.click(); await page.getByRole("status").waitFor();
      await page.waitForFunction(() => !document.querySelector("fieldset").disabled);
      ensure(await page.getByLabel("Одноразовая ссылка", { exact: true }).count() === 0, "An unconfirmed/replayed response never supplies a link");
      await reflow(page);
    }
    const attempts = state.calls.filter((call) => call.action === "issue");
    ensure(attempts.length === 5);
    ensure(typeof attempts[0].key === "string" && attempts[0].key.length > 0 && attempts[0].correlation === attempts[0].key);
    for (const call of attempts) assert.deepEqual(call, attempts[0], "Ambiguous retry uses the same key/correlation/body");
    await page.getByRole("status").getByText("Выдача уже сохранена. Ссылка повторно не выдаётся. Для замены создайте новую выдачу.", { exact: true }).waitFor();
    stage = `issuer-explicit-new-${width}`;
    await page.getByRole("button", { name: "Начать новую выдачу", exact: true }).click();
    state.issue = "ok"; await issue.click();
    const link = page.getByLabel("Одноразовая ссылка", { exact: true }); await link.waitFor();
    ensure((await link.inputValue()).endsWith(`#token=${TOKEN}`)); ensure(await link.getAttribute("readonly") !== null);
    const created = state.calls.filter((call) => call.action === "issue").at(-1);
    ensure(created.key !== attempts[0].key && created.key === created.correlation);
    await reflow(page); await maskChallenge(page, `issuer-link-${width}.png`);
    // Revoke remains bound to the link's original tenant even if selection changes.
    await page.getByRole("combobox").selectOption("member-b");
    const revoke = page.getByRole("button", { name: "Отозвать ссылку", exact: true });
    state.revoke = "failure"; await revoke.click();
    await page.getByRole("status").waitFor(); await page.waitForFunction(() => !document.querySelector("fieldset").disabled);
    ensure(await link.isVisible());
    stage = `issuer-revoke-malformed-${width}`;
    state.revoke = "malformed"; await revoke.click();
    await page.getByRole("status").getByText("Результат отзыва не подтверждён. Повторите запрос.", { exact: true }).waitFor();
    ensure(await link.isVisible(), "Malformed revoke ACK must not claim revocation or discard the only displayed link");
    stage = `issuer-revoke-success-${width}`;
    state.revoke = "ok"; await revoke.click();
    await page.getByRole("status").getByText("Ссылка отозвана.", { exact: true }).waitFor();
    ensure(await link.count() === 0);
    for (const call of state.calls.filter((call) => call.action === "revoke")) {
      ensure(call.body.membershipId === "member-a" && call.body.organizationId === "org-a" && call.body.recoveryId === "synthetic-recovery");
    }
    await reflow(page); await saveImage(page, `issuer-revoked-${width}.png`);
    await f.finish();
  } catch (error) { await saveImage(page, `failure-${stage}.png`).catch(() => {}); throw error; }
  finally { await f.close(); current = undefined; }
}

async function main() {
  output = await mkdtemp(path.join(tmpdir(), "staff-recovery-components-")); await chmod(output, 0o700);
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {StaffRecoveryClient} from './app/setup/staff-recovery/StaffRecoveryClient';
      import {StaffRecoveryControl} from './app/platform-admin/users/[userId]/StaffRecoveryControl';
      window.__router = {replace: [], refresh: 0};
      const memberships = [{id:'member-a', organizationId:'org-a', label:${JSON.stringify(MEMBERSHIP_LABEL)}}, {id:'member-b', organizationId:'org-b', label:'Организация Б: AGENT'}];
      createRoot(document.getElementById('root')).render(location.pathname === '/issuer' ? <main style={{padding:16}}><StaffRecoveryControl memberships={memberships}/></main> : <StaffRecoveryClient/>);
    ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "synthetic-router", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "synthetic" }));
      builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: `export const useRouter=()=>({replace(path){window.__router.replace.push(path);history.replaceState(null,'',path);},refresh(){window.__router.refresh++;}});` }));
    } }],
  });
  const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
  server = createServer((req, res) => {
    const pathname = new URL(req.url, "http://127.0.0.1").pathname;
    if (pathname === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
    else if (pathname === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
    else if (["/recover", "/issuer"].includes(pathname)) {
      res.setHeader("Content-Type", "text/html"); res.setHeader("Referrer-Policy", "no-referrer");
      res.end('<!doctype html><html lang="ru"><head><title>Synthetic staff recovery regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    } else { res.statusCode = pathname === "/favicon.ico" ? 204 : 404; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390, 195]) { await client(width); await issuer(width); }
  stage = "evidence";
  await writeFile(path.join(output, "manifest.json"), JSON.stringify({ scope: "SYNTHETIC_REAL_COMPONENT_TRANSPORT_ONLY", widths: [1440, 390, 195], screenshots }, null, 2) + "\n", { mode: 0o600 });
}

async function run() {
  try { await main(); }
  finally {
    try { await current?.close(); } finally {
      try { await browser?.close(); } finally {
        if (server?.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
      }
    }
  }
}

try {
  await run();
  process.stdout.write(`STAFF_RECOVERY_COMPONENT_BROWSER_PASS desktop/mobile/195; synthetic transport only; masked evidence ${output}\n`);
}
catch (error) {
  let line = "";
  try { line = [...String(error?.stack ?? "").matchAll(/staffRecovery\.e2e\.mjs:(\d+):\d+/g)].find((match) => Number(match[1]) !== 25)?.[1] ?? ""; } catch { /* Never print raw diagnostics. */ }
  process.stderr.write(`STAFF_RECOVERY_COMPONENT_BROWSER_FAILED stage=${stage}${line ? ` line=${line}` : ""}${output ? ` evidence=${output}` : ""}\n`);
  process.exitCode = 1;
}
