import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
const canaries = ['synthetic-dynamic-client-link-canary', 'synthetic-invite-url-canary', 'synthetic-bypass-header-canary'];
const main = () => {
    const source = readFileSync(new URL("./m3-fulfilment.mjs", import.meta.url), "utf8");
    const ast = ts.createSourceFile("m3-fulfilment.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let callback = "";
    const visit = (node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && node.expression.name.text === "route" && node.arguments[0]?.getText(ast) === '"**/api/agent/cases/*/payments"') {
            callback = node.arguments[1].getText(ast);
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.ok(callback);
    const script = `
    import assert from 'node:assert/strict';
    import { createServer } from 'node:http';
    import { chromium } from 'playwright';
    import { createLegacyAsyncScope, observeLegacyPromise, legacySecretScreenshotOptions, sanitizedLegacyFailure } from './tests/e2e/protectedInput.mjs';
    const server = createServer((req, res) => {
      if (req.url.includes('/payments')) req.socket.destroy();
      else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Synthetic</title><body>synthetic</body>'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser, context;
    let aborts = 0, closedContexts = 0, closedBrowsers = 0;
    const closeResources = async () => {
      try { if (context) { await context.close(); closedContexts++; } }
      finally { if (browser) { await browser.close(); closedBrowsers++; } }
    };
    const asyncScope = createLegacyAsyncScope(closeResources);
    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({ extraHTTPHeaders: { 'x-vercel-protection-bypass': ${JSON.stringify(canaries[2])} } });
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:' + server.address().port);
      await page.setContent('<style>body { font:12px monospace } code,[role="img"] { display:block;width:300px;height:30px;overflow-wrap:anywhere }</style><code>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA</code><div role="img" aria-label="QR-код для приложения-аутентификатора">AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA</div><input autocomplete="one-time-code" value="123456"><input autocomplete="new-password" value="synthetic-first-password">');
      const maskedBefore = await page.screenshot(legacySecretScreenshotOptions(page));
      const rawBefore = await page.screenshot();
      await page.evaluate(() => {
        document.querySelector('code').textContent = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
        document.querySelector('[role="img"]').textContent = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
        document.querySelector('[autocomplete="one-time-code"]').value = '654321';
        document.querySelector('[autocomplete="new-password"]').value = 'synthetic-other-password';
      });
      assert.equal((await page.screenshot(legacySecretScreenshotOptions(page))).equals(maskedBefore), true);
      assert.equal((await page.screenshot()).equals(rawBefore), false);
      process.stdout.write('MASKED_EVIDENCE_PASS\\n');
      const pending = observeLegacyPromise(page.waitForResponse(() => true));
      try { await page.locator('#nonexistent-submit').click({ timeout: 1 }); await pending; }
      catch { await page.close(); }
      await new Promise(resolve => setImmediate(resolve));
      process.stdout.write('ABANDONED_WAITER_PASS\\n');
      const target = await context.newPage();
      await target.goto('http://127.0.0.1:' + server.address().port);
      const handler = new Function('asyncScope', 'assert', 'injectedProjectionFailures', 'options',
        'let originalRequest, originalResult; return (' + ${JSON.stringify(callback)} + ');')(asyncScope, assert, new Set(), { exerciseProjectionRetry: true });
      await target.route('**/api/agent/cases/*/payments', route => handler(new Proxy(route, { get(object, key) {
        if (key === 'abort') return (...args) => { aborts++; return object.abort(...args); };
        const value = object[key]; return typeof value === 'function' ? value.bind(object) : value;
      } })));
      await target.evaluate(() => { void fetch('/api/agent/cases/1/payments', { method: 'POST' }).catch(() => {}); });
      await observeLegacyPromise(target.waitForEvent('close'));
      asyncScope.check();
    } catch (error) {
      process.stderr.write(sanitizedLegacyFailure(error)); process.exitCode = 1;
    } finally {
      try { await closeResources(); } finally {
        try { await asyncScope.settle(); } catch (error) { process.stderr.write(sanitizedLegacyFailure(error)); process.exitCode = 1; }
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      }
      assert.equal(aborts, 1);
      assert.ok(closedContexts > 0 && closedBrowsers > 0);
      process.stdout.write('OWNED_RESOURCES_CLOSED\\n');
    }
  `;
    const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "MASKED_EVIDENCE_PASS\nABANDONED_WAITER_PASS\nOWNED_RESOURCES_CLOSED\n");
    assert.match(result.stderr, /^(?:E2E_LEGACY_FAILED(?: protectedInput\.mjs:\d+:\d+)?\n)+$/);
    for (const canary of canaries)
        assert.equal((result.stdout + result.stderr).includes(canary), false);
};
try {
    main();
    process.stdout.write('LEGACY_BROWSER_SECRET_POLICY_PASS\n');
}
catch {
    process.stderr.write('LEGACY_BROWSER_SECRET_POLICY_FAILED\n');
    process.exitCode = 1;
}
