import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const source = readFileSync("tests/e2e/real-organization.mjs", "utf8");
const start = source.indexOf("async heading => {", source.indexOf("width: 195"));
const end = source.indexOf("}), true,", start);
assert.ok(start > 0 && end > start);
const guard = source.slice(start, end + 1);
const html = readFileSync(".next/server/app/setup/staff-recovery.html", "utf8")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ["normal", "missing-fallback", "missing-primary"]) {
    const page = await browser.newPage({ viewport: { width: 195, height: 844 } });
    try {
      await page.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://font-proof.invalid") return route.abort();
        if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
        if (!url.pathname.startsWith("/_next/static/") || url.pathname.includes("..")) return route.abort();
        const file = ".next/" + url.pathname.slice("/_next/".length);
        if (!existsSync(file)) return route.abort();
        if (file.endsWith(".css")) {
          let css = readFileSync(file, "utf8");
          if (mode === "missing-fallback") css = css.replaceAll("src:local(Arial)", "src:local(TdDeliberatelyAbsentFont)");
          return route.fulfill({ contentType: "text/css", body: css });
        }
        if (mode === "missing-primary") return route.abort();
        return route.fulfill({ contentType: "application/octet-stream", body: readFileSync(file) });
      });
      await page.goto("https://font-proof.invalid/", { waitUntil: "load" });
      const accepted = await page.locator("h1").evaluate(async (heading, code) => {
        try { return await (0, eval)(`(${code})`)(heading); }
        catch { return false; }
      }, guard);
      assert.equal(accepted, mode !== "missing-primary", `Actual primary-font acceptance: ${mode}`);
    } finally { await page.close(); }
  }
  console.log("APPLICATION_PRIMARY_FONT_BROWSER_PASS controls=3 skipped=0");
} finally { await browser.close(); }
