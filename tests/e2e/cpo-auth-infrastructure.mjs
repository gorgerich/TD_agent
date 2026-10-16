import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { mkdtemp, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fillProtected, observeLegacyPromise } from "./protectedInput.mjs";
import { createLocalClientHeaders } from "./localClientIdentity.mjs";

const STAGES = new Set([
  "PREFLIGHT_BASE_URL", "PREFLIGHT_DATABASE_URL", "PREFLIGHT_LOCAL_TARGET", "PREFLIGHT_FIXTURE_OPT_IN",
  "PREFLIGHT_FIXTURE_JSON", "PREFLIGHT_FIXTURE_PROVENANCE", "PREFLIGHT_TARGET_FINGERPRINT", "PREFLIGHT_SCHEMA", "PREFLIGHT_PROTECTED_INPUTS",
  "BROWSER_IMPORT", "BROWSER_LAUNCH", "INITIAL_LOGIN_NAVIGATION", "PASSWORD_INPUT", "PASSWORD_RESPONSE", "MFA_INPUT", "MFA_RESPONSE",
  "AUTHENTICATED_PAGE", "SECURE_COOKIE", "BROKEN_SERVER_START", "UNAVAILABLE_UI", "UNAVAILABLE_API", "UNAVAILABLE_ACCESSIBILITY",
  "KEYBOARD_RETRY", "ZOOM_ACCESSIBILITY", "RECOVERY_SERVER_START", "RECOVERY_UI", "BROWSER_CLEANUP", "SERVER_CLEANUP",
]);
const STATUSES = new Set([200, 201, 204, 301, 302, 303, 307, 308, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]);
export function sanitizedAuthInfrastructureFailure(error, stage, status) {
  let location = "";
  try {
    const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
    for (const line of stack.split("\n").slice(1)) {
      const match = line.match(/(?:\/|\\)(cpo-auth-infrastructure\.mjs|protectedInput\.mjs):(\d{1,7}):(\d{1,7})\)?$/);
      if (match) { location = ` ${match[1]}:${match[2]}:${match[3]}`; break; }
    }
  } catch { /* Untrusted error objects must never expose their original diagnostics. */ }
  return `CPO_AUTH_INFRASTRUCTURE_BROWSER_FAILED stage=${STAGES.has(stage) ? stage : "UNKNOWN"}${STATUSES.has(status) ? ` status=${status}` : ""}${location}; no secrets printed\n`;
}

/** @param {(stage: string) => void} mark */
export function authInfrastructurePreflight(env, mark = () => {}) {
mark("PREFLIGHT_BASE_URL");
const base = new URL(env.E2E_BASE_URL ?? "");
mark("PREFLIGHT_DATABASE_URL");
const database = new URL(env.DATABASE_URL_UNPOOLED ?? "");
mark("PREFLIGHT_LOCAL_TARGET");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname) && base.protocol === "http:");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/td_agent_test");
mark("PREFLIGHT_FIXTURE_OPT_IN");
assert.equal(env.M3_CPO_REPAIR_FIXTURE, "1");
mark("PREFLIGHT_FIXTURE_JSON");
const fixture = JSON.parse(env.M3_CPO_REPAIR_FIXTURE_JSON ?? "null");
mark("PREFLIGHT_FIXTURE_PROVENANCE");
assert.equal(fixture?.source, "synthetic-cpo-repair-v1");
assert.equal(fixture.local, true);
assert.equal(fixture.origin, base.origin);
mark("PREFLIGHT_TARGET_FINGERPRINT");
assert.notEqual(fixture.fingerprint, "0257665af2dd90a4");
assert.equal(fixture.fingerprint, createHash("sha256").update(`${database.hostname}:${database.port || "5432"}${database.pathname}`).digest("hex").slice(0, 16));
mark("PREFLIGHT_SCHEMA");
assert.equal(fixture.schema, database.searchParams.get("schema") ?? "public");
mark("PREFLIGHT_PROTECTED_INPUTS");
const key = env.APP_ENCRYPTION_KEY, password = env.M3_UAT_PASSWORD, mfa = env.M3_UAT_MFA_SECRET;
assert.ok(key?.trim() && password?.length >= 32 && /^[A-Z2-7]{32}$/.test(mfa ?? ""));
return { base, database, fixture, key, password, mfa };
}

const diagnostic = { stage: "PREFLIGHT_BASE_URL", status: undefined };
function mark(stage) { diagnostic.stage = stage; diagnostic.status = undefined; }
function fail(error) {
  process.stderr.write(sanitizedAuthInfrastructureFailure(error, diagnostic.stage, diagnostic.status)); process.exitCode = 1;
}
async function main() {
const { base, database, fixture, key, password, mfa } = authInfrastructurePreflight(process.env, mark);
mark("BROWSER_IMPORT");
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
  mark("BROWSER_LAUNCH");
  browser = await chromium.launch({ headless: true });
  const nextLocalClientHeaders = createLocalClientHeaders(base.origin);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: nextLocalClientHeaders() }), page = await context.newPage();
  mark("INITIAL_LOGIN_NAVIGATION");
  await page.goto(`${base.origin}/agent/login`);
  mark("PASSWORD_INPUT");
  await page.locator("#agent-email").fill(fixture.ownerEmail);
  await fillProtected(page.locator("#agent-password"), password);
  let pending = observeLegacyPromise(page.waitForResponse((r) => new URL(r.url()).pathname === "/api/agent/auth/login" && r.request().method() === "POST"));
  mark("PASSWORD_RESPONSE");
  await page.locator('form button[type="submit"]').click();
  diagnostic.status = (await pending).status();
  assert.equal(diagnostic.status, 200);
  mark("MFA_INPUT");
  await fillProtected(page.locator("#platform-mfa-code"), totp());
  pending = observeLegacyPromise(page.waitForResponse((r) => new URL(r.url()).pathname === "/api/agent/auth/login" && r.request().method() === "POST"));
  mark("MFA_RESPONSE");
  await page.locator('form button[type="submit"]').click();
  diagnostic.status = (await pending).status();
  assert.equal(diagnostic.status, 200);
  mark("AUTHENTICATED_PAGE");
  await observeLegacyPromise(page.waitForURL((url) => url.pathname === "/platform-admin"));
  await page.getByRole("heading", { name: "Обзор платформы", exact: true }).waitFor();
  mark("SECURE_COOKIE");
  assert.equal((await context.cookies()).some((cookie) => cookie.name === "tihiydom_agent_session" && cookie.secure), true);
  mark("BROKEN_SERVER_START");
  await start("");
  mark("UNAVAILABLE_UI");
  await page.goto(`${origin}/platform-admin`);
  const unavailable = page.getByRole("heading", { name: "Сервис временно недоступен", exact: true });
  await unavailable.waitFor();
  assert.equal(new URL(page.url()).pathname, "/platform-admin");
  mark("UNAVAILABLE_API");
  const api = await page.evaluate(async () => {
    const response = await fetch("/api/agent/leads");
    return { status: response.status, retry: response.headers.get("retry-after"), body: await response.json() };
  });
  diagnostic.status = api.status;
  assert.equal(api.status, 503); assert.ok(api.retry);
  assert.ok(!JSON.stringify(api.body).includes(password) && !JSON.stringify(api.body).includes(key));
  mark("UNAVAILABLE_ACCESSIBILITY");
  await page.addScriptTag({ path: axePath });
  const findings = await page.evaluate(async () => (await window.axe.run(document)).violations.filter((v) => ["critical", "serious"].includes(v.impact)).length);
  assert.equal(findings, 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  mark("KEYBOARD_RETRY");
  const retry = page.getByRole("button", { name: "Повторить загрузку", exact: true });
  await retry.focus();
  assert.equal(await retry.evaluate((element) => element === document.activeElement), true);
  await Promise.all([observeLegacyPromise(page.waitForNavigation({ waitUntil: "domcontentloaded" })), retry.press("Enter")]);
  await unavailable.waitFor();
  const directory = await mkdtemp(path.join(tmpdir(), "cpo-auth-unavailable-ui-"));
  await chmod(directory, 0o700);
  const screenshot = path.join(directory, "mobile-unavailable.png");
  await page.screenshot({ path: screenshot, fullPage: true }); await chmod(screenshot, 0o600);
  mark("ZOOM_ACCESSIBILITY");
  await page.setViewportSize({ width: 195, height: 422 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  assert.equal(await page.getByRole("button", { name: "Повторить загрузку", exact: true }).isVisible(), true);
  await page.addScriptTag({ path: axePath });
  assert.equal(await page.evaluate(async () => (await window.axe.run(document)).violations.filter((v) => ["critical", "serious"].includes(v.impact)).length), 0);
  const zoomScreenshot = path.join(directory, "zoom-equivalent-unavailable.png");
  await page.screenshot({ path: zoomScreenshot, fullPage: true }); await chmod(zoomScreenshot, 0o600);
  await page.setViewportSize({ width: 390, height: 844 });
  mark("RECOVERY_SERVER_START");
  await stop(); await start(key);
  mark("RECOVERY_UI");
  await page.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await page.getByRole("heading", { name: "Обзор платформы", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/platform-admin");
  console.log(JSON.stringify({ scope: "LOCAL_CI_INJECTED_CONFIGURATION_FAILURE", missingKeyUnavailableUi: "PASS", api: 503,
    keyboardRetry: "PASS", restoredConfigurationRecovery: "PASS", mobileOverflow: 0, zoomEquivalentViewport: "195x422",
    criticalSeriousAccessibility: 0, screenshot, zoomScreenshot, skipped: 0 }));
} catch (error) { fail(error); }
finally {
  mark("BROWSER_CLEANUP");
  try { if (browser) await browser.close(); } catch (error) { fail(error); }
  mark("SERVER_CLEANUP");
  try { await stop(); } catch (error) { fail(error); }
}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(fail);
