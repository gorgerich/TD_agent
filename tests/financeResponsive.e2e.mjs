import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

// Real Finance component and CSS; synthetic props, no API or database proof.
const bundle = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import FinanceClient from './app/agent/(app)/finance/FinanceClient';
    const obligations = ['PARTIALLY_PAID','PARTIALLY_REFUNDED','LEGACY_INCOMPLETE'].map((status, index) => ({
      id: 'synthetic-' + index, caseId: 'case-' + index, amountKopecks: index === 1 ? 9007199254740991 : 17600000,
      currency: 'RUB', payerPartyId: 'payer', createdAt: '2026-10-01T00:00:00Z',
      case: {publicRef: 'M3-SYNTHETIC-FINANCE-RESPONSIVE-' + index, stage: 'AGREEMENT'},
      contractVersion: {id: 'contract-' + index, versionNumber: 1, status: 'SIGNED', signedAt: '2026-10-01T00:00:00Z'},
      ledgerEntries: [], summary: {state: status === 'LEGACY_INCOMPLETE' ? status : 'KNOWN', status,
        paidKopecks: status === 'LEGACY_INCOMPLETE' ? null : 8800000, refundedKopecks: 0,
        balanceKopecks: status === 'LEGACY_INCOMPLETE' ? null : 8800000}
    }));
    createRoot(document.getElementById('root')).render(<FinanceClient membershipId="synthetic" timezone="UTC" initial={{obligations, pendingApprovals: []}}/>);
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "isolated-router", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "isolated" }));
    builder.onLoad({ filter: /.*/, namespace: "isolated" }, () => ({ contents: "export const useRouter = () => ({refresh() {}});" }));
  } }],
});
const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="ru"><head><title>Finance regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><main><div id="root"></div></main><script src="/bundle.js"></script></body></html>'); }
});
let browser;
const output = await mkdtemp(path.join(tmpdir(), "finance-responsive-"));
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 195]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const cards = page.getByRole("list", { name: "Финансовые обязательства" }).locator(":scope > li");
    await cards.last().waitFor();
    assert.equal(await cards.count(), 3);
    await cards.getByText("Частично оплачено", { exact: true }).waitFor();
    await cards.getByText("Частично возвращено", { exact: true }).waitFor();
    await cards.getByText("Недостаточно данных", { exact: true }).waitFor();
    const clipped = await cards.locator("strong, p, span, dt, dd, button").evaluateAll((elements) => elements.flatMap((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      let left = 0, right = document.documentElement.clientWidth;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (["hidden", "clip", "auto", "scroll"].includes(getComputedStyle(parent).overflowX)) {
          const rect = parent.getBoundingClientRect();
          left = Math.max(left, rect.left); right = Math.min(right, rect.right);
        }
      }
      return text.left < left - 1 || text.right > right + 1 || text.left < box.left - 1 || text.right > box.right + 1
        || element.scrollWidth > element.clientWidth + 1 ? [element.textContent] : [];
    }));
    assert.deepEqual(clipped, [], `Finance text clipped at ${width} CSS px`);
    await cards.first().getByRole("button", { name: "Реестр", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.screenshot({ path: path.join(output, `finance-${width}.png`), fullPage: true });
    await page.close();
  }
  console.log(`FINANCE_RESPONSIVE_PASS mobile/195 CSS px; text bounds include clipping ancestors; screenshots ${output}`);
} finally {
  try { await browser?.close(); } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
