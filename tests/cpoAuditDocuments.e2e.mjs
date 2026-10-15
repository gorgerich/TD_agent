import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";
import { syntheticDocumentPdf } from "./cpoAuditDocuments.fixture.mjs";

// Real React components and pointer interactions; transport is deliberately mocked.
// This does not exercise server authorization, PostgreSQL, or a scanner provider.
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentReviewClient } from './app/agent/(app)/document-review/DocumentReviewClient';
import { RescanDocumentButton } from './app/agent/(app)/documents/RescanDocumentButton';
import DocumentsPage from './app/agent/(app)/documents/page';
import { DocumentsSection } from './app/agent/(app)/cases/[caseId]/DocumentsSection';
const item = (id, status, assignedReviewerMembershipId) => ({
  id, versionNumber: 1, status, scanStatus: 'CLEAN', mimeType: 'application/pdf', size: 700,
  createdAt: '2026-10-01T00:00:00Z', overdue: false, assignedReviewerMembershipId,
  case: { leadId: 1, publicRef: 'CPO-Documents-01' },
  document: { documentType: { code: 'IDENTITY', name: 'Identity document', version: 1 } },
  requirement: { stableKey: 'identity-record', dueAt: null, conditionExplanation: null,
    policy: { scenario: 'CREMATION_V1', version: 1 }, reviewChecklist: ['readable'] }
});
const root = createRoot(document.getElementById('root'));
if (location.pathname.includes('case-documents')) {
  root.render(<DocumentsSection caseId={1} timezone="UTC" legacyCount={0} requirements={[{
    id:'identity',stableKey:'identity-record',policyStatus:'APPROVED',policyVersion:1,scenario:'CREMATION_V1',kind:'REQUIRED',conditionExplanation:null,
    isApplicable:true,applicabilityEvaluatedAt:'2026-10-01T00:00:00Z',dueAt:null,ownerRole:'DOCUMENT_REVIEWER',blockingStage:'EXECUTION',acceptedDocumentTypeCodes:['IDENTITY'],
    derivedSatisfactionStatus:'SATISFIED',verifiedVersionNumber:1,document:{id:'doc',status:'VERIFIED',documentType:{code:'IDENTITY',name:'Identity',version:1},versions:[
      {id:'new-quarantined',versionNumber:2,status:'QUARANTINED',scanStatus:'ERROR',expiresAt:null,rejectionReason:null,createdAt:'2026-10-02T00:00:00Z'},
      {id:'valid-verified',versionNumber:1,status:'VERIFIED',scanStatus:'CLEAN',expiresAt:null,rejectionReason:null,createdAt:'2026-10-01T00:00:00Z'}
    ]}
  }]} />);
} else if (location.pathname.includes('documents')) {
  DocumentsPage({searchParams: Promise.resolve({state: new URLSearchParams(location.search).get('state') || 'all'})}).then(view => root.render(view));
} else root.render(<>
  <DocumentReviewClient membershipId="reviewer" timezone="UTC" initial={[
    item('mine', 'IN_REVIEW', 'reviewer'), item('available', 'UPLOADED', null)
  ]} />
  <div style={{padding:24}}><RescanDocumentButton leadId={1} versionId="failed" /></div>
</>);`;
const bundled = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false,
  format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "isolated-navigation", setup(builder) {
    builder.onResolve({ filter: /^(next\/(navigation|link)|@\/lib\/(auth|prisma|operationalAuth))$/ }, (args) => ({ path: args.path, namespace: "isolated" }));
    builder.onLoad({ filter: /.*/, namespace: "isolated" }, (args) => {
      if (args.path === "next/navigation") return { contents: "export const notFound = () => { throw Error('not found'); }; export const useRouter = () => ({refresh: () => { window.refreshes = (window.refreshes || 0) + 1; }});" };
      if (args.path === "next/link") return { contents: "import React from 'react'; export default function Link(props) { return React.createElement('a',props); }", resolveDir: process.cwd() };
      if (args.path === "@/lib/auth") return { contents: "export const getAgentSession = async () => ({role:'AGENT',organizationId:'isolated',agentId:1});" };
      if (args.path === "@/lib/operationalAuth") return { contents: "export const isCoreOperationalRole = role => ['AGENT','MANAGER','ADMIN'].includes(role);" };
      return { contents: `
        const version = {id:'failed',versionNumber:2,status:'QUARANTINED',scanStatus:'ERROR',expiresAt:null,rejectionReason:null};
        const applicable = {id:'req',stableKey:'identity-record',kind:'REQUIRED',blockingStage:'EXECUTION',dueAt:null,policyVersion:1,isApplicable:true,
          case:{leadId:1,publicRef:'CPO-Documents-01',lead:{name:'Synthetic case'}},
          document:{versions:[version,{...version,id:'valid',versionNumber:1,status:'VERIFIED',scanStatus:'CLEAN'}]}};
        export const prisma = {caseDocumentRequirement:{findMany: async ({where}) => [applicable,{...applicable,id:'conditional',stableKey:'inapplicable-rule',isApplicable:false,document:null}].filter(row => !where.isApplicable || row.isApplicable)}};
      ` };
    });
  } }],
});
const css = (await postcss([tailwind()]).process(await readFile("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") })).css;
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") { res.setHeader("Content-Type", "application/javascript"); res.end(bundled.outputFiles[0].text); }
  else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const output = await mkdtemp(path.join(tmpdir(), "cpo-audit-documents-ui-"));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const requests = [];
    let reviewAttempt = 0;
    let rescanAttempt = 0;
    await page.route("**/api/agent/**", async (route) => {
      const request = route.request();
      if (request.url().endsWith('/documents/valid-verified')) {
        await route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from(syntheticDocumentPdf('Synthetic component fixture'))});
        return;
      }
      requests.push({ path: new URL(request.url()).pathname, headers: request.headers(), body: request.postData() });
      const rescan = request.url().endsWith("/rescan");
      const attempt = rescan ? ++rescanAttempt : ++reviewAttempt;
      const response = attempt === 1
        ? { status: 503, body: { error: rescan ? "Scanner unavailable" : "Review temporarily unavailable" } }
        : { status: 200, body: { versionId: rescan ? "retry-version" : "mine", replayed: true } };
      await route.fulfill({ status: response.status, contentType: "application/json", body: JSON.stringify(response.body) });
    });
    await page.goto(url);
    await page.getByRole("heading", { name: "Проверка документов" }).waitFor();
    await page.getByRole("button", { name: "Свободные", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Взять в работу" }).count(), 1);
    await page.getByRole("button", { name: "Мои", exact: true }).click();
    await page.getByRole("checkbox").check();
    await page.getByLabel("Срок действия до (UTC, необязательно)").fill("2000-01-01");
    await page.getByRole("button", { name: "Проверено", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Срок действия должен быть в будущем" }).waitFor();
    assert.equal(requests.length, 0, "invalid expiry never sends a decision");
    await page.getByLabel("Срок действия до (UTC, необязательно)").fill("");
    await page.getByRole("button", { name: "Проверено", exact: true }).click();
    await page.getByRole("button", { name: "Повторить синхронизацию" }).click();
    await page.getByRole("status").waitFor({ state: "detached" });
    assert.equal(requests[0].headers["idempotency-key"], requests[1].headers["idempotency-key"]);
    assert.equal(requests[0].body, requests[1].body);
    await page.getByRole("button", { name: "Повторить сканирование" }).click();
    await page.getByRole("alert").filter({ hasText: "Scanner unavailable" }).waitFor();
    await page.getByRole("button", { name: "Повторить сканирование" }).click();
    await page.getByRole("alert").waitFor({ state: "detached" });
    assert.equal(requests[2].headers["idempotency-key"], requests[3].headers["idempotency-key"]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow");
    await page.screenshot({ path: path.join(output, `${viewport.width}.png`), fullPage: true });
    await page.goto(`${url}/documents`);
    await page.getByRole("heading", { name: "Документы", exact: true }).waitFor();
    assert.equal(await page.getByText("1/1", { exact: true }).count(), 1, "denominator excludes non-applicable rules");
    assert.equal(await page.getByText("inapplicable-rule").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Повторить сканирование" }).count(), 1);
    await page.screenshot({ path: path.join(output, `documents-${viewport.width}.png`), fullPage: true });
    await page.getByRole("link", { name: "Требуют действия", exact: true }).click();
    await page.getByText("По этому фильтру требований нет", { exact: true }).waitFor();
    assert.equal(await page.getByText("inapplicable-rule").count(), 0);
    await page.goto(`${url}/case-documents`);
    await page.getByText('Действует v1. Новая v2:', {exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Открыть v2',exact:true}).count(),0);
    let downloaded;
    page.context().once('page', (opened) => { downloaded = opened.waitForEvent('download'); });
    const [popup, response] = await Promise.all([
      page.waitForEvent('popup'),
      page.waitForResponse((result) => result.url().endsWith('/documents/valid-verified')),
      page.getByRole('button',{name:'Открыть v1',exact:true}).click(),
    ]);
    assert.equal(response.status(),200);
    const file = await downloaded;
    assert.equal(await file.failure(),null);
    assert.deepEqual(await readFile(await file.path()),Buffer.from(syntheticDocumentPdf('Synthetic component fixture')));
    await popup.close();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.screenshot({path:path.join(output,`case-documents-${viewport.width}.png`),fullPage:true});
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`Document component browser checks passed: desktop/mobile. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
