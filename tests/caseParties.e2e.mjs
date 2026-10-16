import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { observeLegacyPromise } from "./e2e/protectedInput.mjs";

// Real component, synthetic authoritative transport. Refresh deliberately delivers stale props.
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {CasePartiesSection} from './app/agent/(app)/cases/[caseId]/CasePartiesSection';
    const root = createRoot(document.getElementById('root'));
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      if (['POST', 'PATCH'].includes(args[1]?.method)) window.mutationAttempts = (window.mutationAttempts || 0) + 1;
      try { return await nativeFetch(...args); }
      finally { if (window.trackOldRead && String(args[0]).includes('/cases/2/parties') && !args[1]?.method) window.oldReadSettled = true; }
    };
    window.renderParties = (parties = [], caseId = window.currentCase || 1) => {
      window.currentCase = caseId;
      root.render(<CasePartiesSection caseId={caseId} parties={parties} canMutate={true} timezone="UTC" />);
    };
    window.renderParties();
  ` },
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "stale-refresh", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: `
      export const useRouter = () => ({refresh() {
        window.refreshes = (window.refreshes || 0) + 1;
        window.renderParties(window.staleParties || []);
      }});
    ` }));
  } }],
});
const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="ru"><head><title>Party regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main style="padding:24px"><div id="root"></div></main><script src="/bundle.js"></script></body></html>'); }
});
let browser;
const output = await mkdtemp(path.join(tmpdir(), "case-parties-ui-"));
let releasePendingRead;
let revision = 0;
const canonical = (name) => ({ id: "party-1", name, phone: "+10000000000", email: null, preferredChannel: "PHONE", consentStatus: "UNKNOWN", consentSource: null, consentAt: null, visibilityPolicy: "CASE_TEAM", roles: ["PAYER"], createdAt: "2026-10-01T00:00:00.000Z", updatedAt: new Date(Date.UTC(2026, 9, 1) + ++revision * 1000).toISOString() });
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390, 195]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", () => errors.push("pageerror"));
    const writes = [];
    let reads = 0;
    let row = canonical("Canonical created");
    let getMode = "failure";
    let writeFailure = true;
    let writeStatus = 503;
    let malformedCommit = false;
    let transportFailure = false;
    let createStatus = 200;
    let releaseRead;
    let delayedRead;
    await page.route("**/api/agent/cases/*/parties**", async (route) => {
      try {
        const request = route.request();
        let status = 200;
        let body;
        if (request.method() === "GET") {
          reads += 1;
          if (getMode === "delayed") await delayedRead;
          if (getMode === "failure") { status = 503; body = { error: "Read unavailable" }; }
          else if (getMode === "malformed") body = { parties: [{ id: row.id }] };
          else if (getMode === "missing") body = { parties: [] };
          else body = { parties: [row] };
        } else {
          writes.push({ method: request.method(), body: request.postData(), key: request.headers()["idempotency-key"], correlation: request.headers()["x-correlation-id"] });
          if (transportFailure) { await route.abort("failed"); return; }
          if (writeFailure) { status = writeStatus; body = { error: "Write unavailable" }; }
          else { status = request.method() === "POST" ? createStatus : 200; body = malformedCommit ? {} : { partyId: row.id, replayed: status === 200 }; }
        }
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      } catch { await route.abort().catch(() => {}); }
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Добавить участника", exact: true }).click();
    let form = page.getByRole("form", { name: "Добавить участника кейса" });
    await form.getByRole("textbox", { name: "Имя", exact: true }).fill("Submitted not authoritative");
    await form.getByRole("textbox", { name: "Телефон", exact: true }).fill("+10000000000");
    await form.getByRole("checkbox", { name: "Плательщик", exact: true }).check();
    await form.getByRole("button", { name: "Сохранить участника", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Write unavailable" }).waitFor();
    assert.equal(await form.getByRole("textbox", { name: "Имя", exact: true }).isDisabled(), true);
    writeFailure = false;
    await form.getByRole("button", { name: "Сохранить участника", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Участник сохранён, но список недоступен" }).waitFor();
    assert.equal(await form.count(), 0, "confirmed create closes before read-back recovery");
    assert.equal(await page.getByText("Участники и их роли ещё не зафиксированы.", { exact: true }).count(), 0, "confirmed save must not claim no participants recorded");
    assert.equal(await page.getByRole("button", { name: "Добавить участника", exact: true }).isDisabled(), true);
    assert.equal(await page.getByText("Submitted not authoritative", { exact: true }).count(), 0);
    assert.deepEqual(writes[0], writes[1], "ambiguous create retry keeps original key, correlation and body");
    await page.screenshot({ path: path.join(output, `recovery-${width}.png`), fullPage: true });
    getMode = "success";
    await page.getByRole("button", { name: "Повторить синхронизацию", exact: true }).click();
    await page.getByText(row.name, { exact: true }).waitFor();
    assert.equal(writes.length, 2, "sync retry sends no create");
    assert.equal(await page.evaluate(() => window.refreshes), 1, "stale refresh was actually invoked");
    await page.evaluate(() => window.renderParties([]));
    await page.getByText(row.name, { exact: true }).waitFor();

    // Newer SSR must win even before it ever acknowledges our saved DTO.
    const external = { ...row, name: "External canonical change", consentStatus: "WITHDRAWN", updatedAt: new Date(Date.parse(row.updatedAt) + 1).toISOString() };
    await page.evaluate((party) => { window.staleParties = [party]; window.renderParties([party]); }, external);
    await page.getByText(external.name, { exact: true }).waitFor();
    await page.getByText("Согласие: Отозвано", { exact: true }).waitFor();
    await page.getByRole("button", { name: `Изменить ${external.name}`, exact: true }).click();
    form = page.getByRole("form", { name: `Изменить участника ${external.name}`, exact: true });
    await form.getByRole("textbox", { name: "Имя", exact: true }).fill("Submitted update not authoritative");
    writeFailure = true;
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Write unavailable" }).waitFor();
    assert.equal(await form.count(), 1, "failed update retains editable form and server error");
    writeFailure = false;
    row = canonical("Canonical updated");
    getMode = "malformed";
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Участник сохранён, но список недоступен" }).waitFor();
    assert.equal(await form.count(), 0);
    assert.equal(await page.getByRole("button", { name: `Изменить ${external.name}`, exact: true }).isDisabled(), true);
    getMode = "missing";
    await page.getByRole("button", { name: "Повторить синхронизацию", exact: true }).click();
    await page.getByRole("alert").waitFor();
    getMode = "success";
    await page.getByRole("button", { name: "Повторить синхронизацию", exact: true }).click();
    await page.getByText(row.name, { exact: true }).waitFor();
    assert.equal(writes.length, 4, "update sync retries never PATCH again");
    assert.deepEqual(writes[2], writes[3], "ambiguous update retry keeps original key, correlation and body");
    assert.equal(await page.getByText("Submitted update not authoritative", { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    // Malformed acknowledgment is ambiguous: only replay the original key/body, never infer by name.
    await page.evaluate(() => { window.staleParties = []; window.renderParties([], 2); });
    await page.getByRole("button", { name: "Добавить участника", exact: true }).click();
    form = page.getByRole("form", { name: "Добавить участника кейса" });
    await form.getByRole("textbox", { name: "Имя", exact: true }).fill("Other case submitted");
    await form.getByRole("textbox", { name: "Телефон", exact: true }).fill("+10000000000");
    await form.getByRole("checkbox", { name: "Плательщик", exact: true }).check();
    malformedCommit = true;
    createStatus = 201;
    getMode = "failure";
    const readsBeforeMalformed = reads;
    await form.getByRole("button", { name: "Сохранить участника", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Сохранение не подтверждено" }).waitFor();
    assert.equal(await form.count(), 1);
    assert.equal(await form.getByRole("textbox", { name: "Имя", exact: true }).isDisabled(), true);
    assert.equal(reads, readsBeforeMalformed, "an empty GET cannot confirm an unacknowledged create");
    assert.equal(await page.getByRole("button", { name: "Повторить синхронизацию", exact: true }).count(), 0);
    malformedCommit = false;
    createStatus = 200;
    await form.getByRole("button", { name: "Сохранить участника", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Участник сохранён, но список недоступен" }).waitFor();
    assert.equal(await form.count(), 0);
    assert.deepEqual(writes[4], writes[5], "malformed acknowledgment replays the identical create command");
    getMode = "success";
    await page.getByRole("button", { name: "Повторить синхронизацию", exact: true }).click();
    await page.getByText(row.name, { exact: true }).waitFor();
    await page.getByRole("button", { name: "Повторить синхронизацию", exact: true }).waitFor({ state: "detached" });
    assert.equal(writes.length, 6);

    // A read already in flight belongs to the old keyed case instance, never the new case.
    await page.getByRole("button", { name: `Изменить ${row.name}`, exact: true }).click();
    form = page.getByRole("form", { name: `Изменить участника ${row.name}`, exact: true });
    getMode = "delayed";
    const refreshesBeforeNavigation = await page.evaluate(() => { window.trackOldRead = true; return window.refreshes; });
    delayedRead = new Promise((resolve) => { releaseRead = resolve; releasePendingRead = resolve; });
    await Promise.all([
      observeLegacyPromise(page.waitForRequest((request) => request.method() === "GET" && request.url().includes("/cases/2/parties"))),
      form.getByRole("button", { name: "Сохранить", exact: true }).click(),
    ]);
    await page.evaluate(() => window.renderParties([], 3));
    await page.getByText("Участников: 0", { exact: true }).waitFor();
    releaseRead();
    await page.waitForFunction(() => window.oldReadSettled === true);
    assert.equal(await page.evaluate(() => window.refreshes), refreshesBeforeNavigation, "disposed old-case work cannot refresh the new route");
    await page.getByRole("button", { name: "Добавить участника", exact: true }).waitFor();
    assert.equal(await page.getByText(row.name, { exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Повторить синхронизацию", exact: true }).count(), 0);
    malformedCommit = false;
    createStatus = 201;
    getMode = "success";
    row = canonical("Canonical 201 created");
    await page.getByRole("button", { name: "Добавить участника", exact: true }).click();
    form = page.getByRole("form", { name: "Добавить участника кейса" });
    await form.getByRole("textbox", { name: "Имя", exact: true }).fill("Not canonical 201");
    await form.getByRole("textbox", { name: "Телефон", exact: true }).fill("+10000000000");
    await form.getByRole("checkbox", { name: "Плательщик", exact: true }).check();
    await form.getByRole("button", { name: "Сохранить участника", exact: true }).click();
    await page.getByText(row.name, { exact: true }).waitFor();
    assert.equal(writes.length, 8);
    assert.equal(await page.getByText("Not canonical 201", { exact: true }).count(), 0);
    await page.getByRole("button", { name: `Изменить ${row.name}`, exact: true }).click();
    form = page.getByRole("form", { name: `Изменить участника ${row.name}`, exact: true });
    await form.getByRole("textbox", { name: "Имя", exact: true }).fill("Unacknowledged update");
    malformedCommit = true;
    const readsBeforeUpdate = reads;
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Сохранение не подтверждено" }).waitFor();
    assert.equal(await form.getByRole("textbox", { name: "Имя", exact: true }).isDisabled(), true);
    assert.equal(await form.getByRole("button", { name: "Отмена", exact: true }).isDisabled(), true);
    assert.equal(reads, readsBeforeUpdate);
    malformedCommit = false;
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await form.waitFor({ state: "detached" });
    await page.getByRole("button", { name: `Изменить ${row.name}`, exact: true }).waitFor({ state: "visible" });
    assert.deepEqual(writes[8], writes[9], "unreadable update acknowledgement replays the exact command");

    await page.evaluate(() => { window.staleParties = []; window.renderParties([], 4); });
    await page.getByRole("button", { name: "Добавить участника", exact: true }).click();
    form = page.getByRole("form", { name: "Добавить участника кейса" });
    await form.getByRole("textbox", { name: "Имя", exact: true }).fill("Lost transport create");
    await form.getByRole("textbox", { name: "Телефон", exact: true }).fill("+10000000000");
    await form.getByRole("checkbox", { name: "Плательщик", exact: true }).check();
    transportFailure = true;
    await form.getByRole("button", { name: "Сохранить участника", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await form.getByRole("textbox", { name: "Имя", exact: true }).isDisabled(), true);
    transportFailure = false;
    createStatus = 200;
    await form.getByRole("button", { name: "Сохранить участника", exact: true }).click();
    await form.waitFor({ state: "detached" });
    await page.getByText(row.name, { exact: true }).waitFor();
    assert.deepEqual(writes[10], writes[11], "lost transport retries the original command without edits");
    assert.equal(writes.length, 12);
    await page.getByRole("button", { name: `Изменить ${row.name}`, exact: true }).click();
    form = page.getByRole("form", { name: `Изменить участника ${row.name}`, exact: true });
    writeFailure = true;
    writeStatus = 409;
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Write unavailable" }).waitFor();
    assert.equal(await form.getByRole("textbox", { name: "Имя", exact: true }).isEnabled(), true, "definitive business conflict permits correction");
    assert.equal(await form.getByRole("button", { name: "Отмена", exact: true }).isEnabled(), true);
    writeFailure = false;
    await form.getByRole("textbox", { name: "Имя", exact: true }).fill("Corrected after rejection");
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await form.waitFor({ state: "detached" });
    assert.notEqual(writes[12].key, writes[13].key, "a definitively rejected command can be replaced");

    await page.getByRole("button", { name: "Добавить участника", exact: true }).click();
    const createForm = page.getByRole("form", { name: "Добавить участника кейса" });
    await createForm.getByRole("textbox", { name: "Имя", exact: true }).fill("Concurrent form");
    await createForm.getByRole("textbox", { name: "Телефон", exact: true }).fill("+10000000000");
    await createForm.getByRole("checkbox", { name: "Плательщик", exact: true }).check();
    await page.getByRole("button", { name: `Изменить ${row.name}`, exact: true }).click();
    form = page.getByRole("form", { name: `Изменить участника ${row.name}`, exact: true });
    writeFailure = true;
    writeStatus = 503;
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Write unavailable" }).waitFor();
    assert.equal(await createForm.getByRole("button", { name: "Сохранить участника", exact: true }).isDisabled(), true);
    const attempts = await createForm.evaluate((element) => {
      const before = window.mutationAttempts;
      element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return [before, window.mutationAttempts];
    });
    assert.equal(attempts[0], attempts[1], "cross-form guard rejects before invoking fetch, independently of network delay");
    assert.equal(writes.length, 15, "an unresolved update cannot be unlocked by submitting the other form");
    assert.equal(await form.getByRole("textbox", { name: "Имя", exact: true }).isDisabled(), true);
    writeFailure = false;
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await form.waitFor({ state: "detached" });
    assert.deepEqual(writes[14], writes[15]);
    await page.getByRole("button", { name: "Закрыть форму", exact: true }).click();

    await page.getByRole("button", { name: `Изменить ${row.name}`, exact: true }).click();
    form = page.getByRole("form", { name: `Изменить участника ${row.name}`, exact: true });
    getMode = "delayed";
    delayedRead = new Promise((resolve) => { releaseRead = resolve; releasePendingRead = resolve; });
    await Promise.all([
      observeLegacyPromise(page.waitForRequest((request) => request.method() === "GET" && request.url().includes("/cases/4/parties"))),
      form.getByRole("button", { name: "Сохранить", exact: true }).click(),
    ]);
    const newest = { ...row, name: "Newest server consent", consentStatus: "WITHDRAWN", updatedAt: new Date(Date.parse(row.updatedAt) + 1000).toISOString() };
    await page.evaluate((party) => { window.staleParties = [party]; window.renderParties([party]); }, newest);
    await page.getByText(newest.name, { exact: true }).waitFor();
    releaseRead();
    await page.getByRole("button", { name: "Повторить синхронизацию", exact: true }).waitFor({ state: "detached" });
    await page.getByText(newest.name, { exact: true }).waitFor();
    assert.equal(await page.getByText(row.name, { exact: true }).count(), 0, "older GET cannot override newer SSR received while it was pending");
    await page.getByText("Согласие: Отозвано", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.addScriptTag({ path: createRequire(import.meta.url).resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => (await window.axe.run()).violations
      .filter((finding) => ["critical", "serious"].includes(finding.impact)).map((finding) => finding.id));
    assert.deepEqual(violations, []);
    await page.screenshot({ path: path.join(output, `saved-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`CASE_PARTIES_BROWSER_PASS desktop/mobile create/update authoritative recovery stale SSR. Screenshots: ${output}`);
} finally {
  releasePendingRead?.();
  try { await browser?.close(); } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
