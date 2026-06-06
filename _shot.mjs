import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3001";
const OUT = "/tmp/td_shots";
mkdirSync(OUT, { recursive: true });

const routes = [
  ["cases", "/agent/cases"],
  ["dashboard", "/agent/dashboard"],
  ["meetings", "/agent/meetings"],
  ["estimates", "/agent/estimates"],
  ["tasks", "/agent/tasks"],
  ["documents", "/agent/documents"],
  ["settings", "/agent/settings"],
  ["login", "/agent/login"],
];

const viewports = [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
];

const browser = await chromium.launch();
for (const [vpName, vp] of viewports) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const [name, route] of routes) {
    try {
      await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/${name}-${vpName}.png`, fullPage: true });
      console.log(`ok  ${name}-${vpName}`);
    } catch (e) {
      console.log(`ERR ${name}-${vpName}: ${e.message.split("\n")[0]}`);
    }
  }
  await ctx.close();
}
await browser.close();
console.log("done");
