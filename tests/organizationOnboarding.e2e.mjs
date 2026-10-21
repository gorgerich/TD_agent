import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {OrganizationOnboardingControl} from './app/platform-admin/organizations/OrganizationOnboardingControl';
    createRoot(document.getElementById('root')).render(<OrganizationOnboardingControl organizationId={new URLSearchParams(window.location.search).get('organization') || undefined} />);
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "synthetic-navigation", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "synthetic" }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "synthetic" }));
    builder.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ resolveDir: process.cwd(), loader: "tsx", contents: args.path === "navigation"
      ? "export const useRouter = () => ({refresh() { window.refreshes = (window.refreshes || 0) + 1; }});"
      : "import React from 'react'; export default function Link(props) { return <a {...props} />; }" }));
  } }],
});
const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Organization regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main style="padding:24px"><h1 style="font-size:20px;overflow-wrap:anywhere">Организации</h1><div id="root"></div></main><script src="/bundle.js"></script></body></html>'); }
});
const output = await mkdtemp(path.join(tmpdir(), "organization-onboarding-ui-"));
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const width of [1365, 390, 195]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, locale: "ru-RU" });
    const pageErrors = [];
    page.on("pageerror", () => pageErrors.push("pageerror"));
    const commands = [];
    let outcome = "failure";
    await page.route("**/api/platform-admin/organizations**", async route => {
      const request = route.request();
      assert.equal(request.method(), "POST");
      commands.push({ body: request.postData(), key: request.headers()["idempotency-key"], url: request.url() });
      if (outcome === "failure") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Временный сбой" }) });
      if (outcome === "malformed") return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: outcome === "replay" ? 200 : 201, contentType: "application/json", body: JSON.stringify({
        organizationId: "synthetic:new-org", replayed: outcome === "replay", inviteUrl: outcome === "replay" ? null : `${origin}/agent/login#invite=${"A".repeat(43)}`,
      }) });
    });
    await page.goto(origin);
    await page.getByRole("button", { name: "Создать организацию", exact: true }).click();
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(":focus").getAttribute("name"), "name");
    await page.getByLabel("Название", { exact: true }).fill("Synthetic organization");
    await page.getByLabel("Идентификатор организации").fill("synthetic-new-org");
    await page.getByLabel("Email первого ADMIN").fill("admin@synthetic.invalid");
    await page.getByLabel("Основание", { exact: true }).fill("Synthetic onboarding UI regression");
    await page.getByLabel("Подтверждение:").fill("НАЗНАЧИТЬ АДМИНИСТРАТОРА");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
      JSON.stringify(await page.evaluate(() => ({ viewport: innerWidth, root: document.documentElement.scrollWidth, body: document.body.scrollWidth, elements: [...document.querySelectorAll("body *")].filter(element => element.getBoundingClientRect().right > innerWidth || element.scrollWidth > element.clientWidth + 1).map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right, scroll: element.scrollWidth, client: element.clientWidth })) }))));
    await page.screenshot({ path: path.join(output, `form-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Создать и пригласить ADMIN", exact: true }).click();
    await page.getByText("Временный сбой", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Название", { exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("link", { name: "Открыть организацию" }).count(), 0);
    outcome = "malformed";
    await page.getByRole("button", { name: "Повторить исходный запрос", exact: true }).click();
    await page.getByText("Результат не подтверждён.", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("Название", { exact: true }).isDisabled(), true);
    outcome = "success";
    await page.getByRole("button", { name: "Повторить исходный запрос", exact: true }).click();
    await page.getByLabel("Одноразовое приглашение ADMIN").waitFor();
    assert.equal(commands.length, 3);
    assert.ok(commands[0].key);
    assert.equal(new Set(commands.map(command => command.key)).size, 1);
    assert.equal(new Set(commands.map(command => command.body)).size, 1);
    assert.equal(await page.evaluate(() => window.refreshes), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole("button", { name: "Копировать приглашение", exact: true }).click();
    await page.getByRole("status").filter({ hasText: /скопировано|Копирование недоступно/ }).last().waitFor();
    await page.addScriptTag({ path: createRequire(import.meta.url).resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => (await window.axe.run()).violations.filter(item => ["critical", "serious"].includes(item.impact)).map(item => item.id));
    assert.deepEqual(violations, []);
    await page.screenshot({ path: path.join(output, `success-${width}.png`), fullPage: true, mask: [page.getByLabel("Одноразовое приглашение ADMIN")] });
    await page.getByRole("link", { name: "Открыть организацию", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/platform-admin/organizations/synthetic%3Anew-org");
    await page.goto(`${origin}/?organization=synthetic%3Anew-org`);
    await page.getByRole("button", { name: "Пригласить первого ADMIN", exact: true }).click();
    await page.getByLabel("Email первого ADMIN").fill("replacement@synthetic.invalid");
    await page.getByLabel("Основание", { exact: true }).fill("Synthetic replacement request");
    await page.getByLabel("Подтверждение:").fill("НАЗНАЧИТЬ АДМИНИСТРАТОРА");
    outcome = "replay";
    await page.getByRole("button", { name: "Выдать новое приглашение", exact: true }).click();
    await page.getByText("Команда уже выполнена.", { exact: false }).waitFor();
    assert.equal(await page.getByLabel("Одноразовое приглашение ADMIN").count(), 0);
    assert.match(commands.at(-1).url, /synthetic%3Anew-org\/first-admin-invite$/);
    await page.getByRole("button", { name: "Перевыпустить приглашение", exact: true }).click();
    outcome = "success";
    await page.getByLabel("Email первого ADMIN").fill("replacement@synthetic.invalid");
    await page.getByLabel("Основание", { exact: true }).fill("Synthetic replacement request");
    await page.getByLabel("Подтверждение:").fill("НАЗНАЧИТЬ АДМИНИСТРАТОРА");
    await page.getByRole("button", { name: "Выдать новое приглашение", exact: true }).click();
    await page.getByLabel("Одноразовое приглашение ADMIN").waitFor();
    assert.notEqual(commands.at(-1).key, commands.at(-2).key);
    assert.deepEqual(pageErrors, []);
    await page.close();
  }
  console.log(`ORGANIZATION_ONBOARDING_COMPONENT_PASS synthetic transport; desktop/mobile/equivalent reflow; recovery/replay/keyboard/a11y. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
