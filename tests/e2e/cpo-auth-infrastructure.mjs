import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fillProtected } from "./protectedInput.mjs";

async function main() {
const base = new URL(process.env.E2E_BASE_URL ?? "");
const database = new URL(process.env.DATABASE_URL_UNPOOLED ?? "");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname) && base.protocol === "http:");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/td_agent_test");
assert.equal(process.env.M3_CPO_REPAIR_FIXTURE, "1");
const fixture = JSON.parse(process.env.M3_CPO_REPAIR_FIXTURE_JSON ?? "null");
assert.equal(fixture?.source, "synthetic-cpo-repair-v1");
assert.equal(fixture.local, true);
assert.equal(fixture.origin, base.origin);
assert.notEqual(fixture.fingerprint, "0257665af2dd90a4");
assert.equal(fixture.fingerprint, createHash("sha256").update(`${database.hostname}:${database.port || "5432"}${database.pathname}`).digest("hex").slice(0, 16));
assert.equal(fixture.schema, database.searchParams.get("schema") ?? "public");
const key = process.env.APP_ENCRYPTION_KEY, password = process.env.M3_UAT_PASSWORD, mfa = process.env.M3_UAT_MFA_SECRET;
assert.ok(key?.trim() && password?.length >= 32 && /^[A-Z2-7]{32}$/.test(mfa ?? ""));
const { chromium } = await import("playwright");
const require = createRequire(import.meta.url), axePath = require.resolve("axe-core/axe.min.js");
const seed = [...createHmac("sha256", mfa).update(`cpo-repair-owner:${fixture.runId}`).digest()]
  .map((byte) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[byte & 31]).join("");
function totp() {
  const bits = [...seed].map((char) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char).toString(2).padStart(5, "0")).join("");
  const secret = Buffer.from(bits.match(/.{8}/g).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", secret).update(counter).digest(), offset = digest.at(-1) & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
const socket = createServer(); await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port; await new Promise((resolve) => socket.close(resolve));
const origin = `http://${base.hostname}:${port}`;
let server, browser;
async function stop() {
  const child = server;
  server = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
    const deadline = setTimeout(() => { clearTimeout(kill); reject(new Error("AUTH_FAILURE_SERVER_CLEANUP_FAILED")); }, 10000);
    child.once("exit", () => { clearTimeout(kill); clearTimeout(deadline); resolve(); });
    child.kill();
  });
}
async function start(encryptionKey) {
  let failed = false;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    env: { ...process.env, DATABASE_URL: database.href, DATABASE_URL_UNPOOLED: database.href,
      APP_ENCRYPTION_KEY: encryptionKey, M3_DOCUMENT_STORAGE: "isolated-filesystem", M3_DOCUMENT_SCANNER: "synthetic-preview",
      VERCEL_ENV: "preview", PREVIEW_DB_ISOLATION: "PASS", VERCEL_GIT_COMMIT_REF: "mission/m3-fulfilment-money-trust" }, stdio: "ignore" });
  server.once("error", () => { failed = true; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (failed || server.exitCode !== null || server.signalCode !== null) throw new Error("AUTH_FAILURE_TEST_SERVER_UNAVAILABLE");
    try { if ((await fetch(`${origin}/agent/login`)).ok) return; } catch { /* Starting owned test process. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("AUTH_FAILURE_TEST_SERVER_UNAVAILABLE");
}
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
  await page.goto(`${base.origin}/agent/login`);
  await page.locator("#agent-email").fill(fixture.ownerEmail);
  await fillProtected(page.locator("#agent-password"), password);
  let pending = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/agent/auth/login" && r.request().method() === "POST");
  await page.locator('form button[type="submit"]').click();
  assert.equal((await pending).status(), 200);
  await fillProtected(page.locator("#platform-mfa-code"), totp());
  pending = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/agent/auth/login" && r.request().method() === "POST");
  await page.locator('form button[type="submit"]').click();
  assert.equal((await pending).status(), 200);
  await page.waitForURL((url) => url.pathname === "/platform-admin");
  await page.getByRole("heading", { name: "Обзор платформы", exact: true }).waitFor();
  assert.equal((await context.cookies()).some((cookie) => cookie.name === "tihiydom_agent_session" && cookie.secure), true);
  await start("");
  await page.goto(`${origin}/platform-admin`);
  const unavailable = page.getByRole("heading", { name: "Сервис временно недоступен", exact: true });
  await unavailable.waitFor();
  assert.equal(new URL(page.url()).pathname, "/platform-admin");
  const api = await page.evaluate(async () => {
    const response = await fetch("/api/agent/leads");
    return { status: response.status, retry: response.headers.get("retry-after"), body: await response.json() };
  });
  assert.equal(api.status, 503); assert.ok(api.retry);
  assert.ok(!JSON.stringify(api.body).includes(password) && !JSON.stringify(api.body).includes(key));
  await page.addScriptTag({ path: axePath });
  const findings = await page.evaluate(async () => (await window.axe.run(document)).violations.filter((v) => ["critical", "serious"].includes(v.impact)).length);
  assert.equal(findings, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const retry = page.getByRole("button", { name: "Повторить загрузку", exact: true });
  await retry.focus();
  assert.equal(await retry.evaluate((element) => element === document.activeElement), true);
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), retry.press("Enter")]);
  await unavailable.waitFor();
  const directory = await mkdtemp(path.join(tmpdir(), "cpo-auth-unavailable-ui-"));
  await chmod(directory, 0o700);
  const screenshot = path.join(directory, "mobile-unavailable.png");
  await page.screenshot({ path: screenshot, fullPage: true }); await chmod(screenshot, 0o600);
  await page.setViewportSize({ width: 195, height: 422 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  assert.equal(await page.getByRole("button", { name: "Повторить загрузку", exact: true }).isVisible(), true);
  await page.addScriptTag({ path: axePath });
  assert.equal(await page.evaluate(async () => (await window.axe.run(document)).violations.filter((v) => ["critical", "serious"].includes(v.impact)).length), 0);
  const zoomScreenshot = path.join(directory, "zoom-equivalent-unavailable.png");
  await page.screenshot({ path: zoomScreenshot, fullPage: true }); await chmod(zoomScreenshot, 0o600);
  await page.setViewportSize({ width: 390, height: 844 });
  await stop(); await start(key);
  await page.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await page.getByRole("heading", { name: "Обзор платформы", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/platform-admin");
  console.log(JSON.stringify({ scope: "LOCAL_CI_INJECTED_CONFIGURATION_FAILURE", missingKeyUnavailableUi: "PASS", api: 503,
    keyboardRetry: "PASS", restoredConfigurationRecovery: "PASS", mobileOverflow: 0, zoomEquivalentViewport: "195x422",
    criticalSeriousAccessibility: 0, screenshot, zoomScreenshot, skipped: 0 }));
} catch {
  process.stderr.write("CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED; no secrets printed\n"); process.exitCode = 1;
} finally { try { if (browser) await browser.close(); } finally { await stop(); } }
}
main().catch(() => {
  process.stderr.write("CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED; no secrets printed\n"); process.exitCode = 1;
});
