import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server, browser, url;
before(async () => {
  server = await createServer({ configFile: false, appType: 'custom', root, plugins: [svelte({ configFile: false })], resolve: { alias: { $paraglide: path.join(root, 'src/paraglide'), $lib: path.join(root, 'src/lib') } }, server: { port: 0, host: '127.0.0.1' } });
  server.middlewares.use(async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await server.transformIndexHtml(req.url, '<div id="root"></div><script type="module" src="/tests/fixtures/escape-dialog-app.ts"></script>'));
  });
  await server.listen(); url = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
test('releasing before the start response cancels the stale attempt', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    const hold = page.locator('.hold-btn');
    await hold.hover(); await page.mouse.down(); await page.mouse.up();
    await page.evaluate(() => window.escapeTest.resolveStart());
    await page.waitForFunction(() => window.escapeTest.calls.includes('focus_escape_cancel_hold'), null, { timeout: 2000 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.escapeTest.calls.includes('focus_escape_pulse_hold')), false);
  } finally { await page.close(); }
});
test('modal traps focus, scopes Space to hold, and restores focus on close', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    await page.locator('.btn-close').waitFor();
    assert.equal(await page.locator('.btn-close').evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('.hold-btn').evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.btn-close').evaluate((el) => el === document.activeElement), true);
    await page.locator('.mode-tab').nth(1).focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#pass-first').count(), 1);
    assert.equal(await page.evaluate(() => window.escapeTest.calls.includes('focus_escape_start_hold')), false);
    await page.locator('#pass-first').fill('secret');
    await page.keyboard.press('Escape');
    await page.locator('#opener').click();
    await page.locator('.mode-tab').nth(1).click();
    assert.equal(await page.locator('#pass-first').inputValue(), '');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#opener').evaluate((el) => el === document.activeElement), true);
  } finally { await page.close(); }
});
