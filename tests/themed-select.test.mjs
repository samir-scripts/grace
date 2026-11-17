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
  server = await createServer({ configFile: false, appType: 'custom', root, plugins: [svelte({ configFile: false })], resolve: { alias: { $lib: path.join(root, 'src/lib'), $paraglide: path.join(root, 'src/paraglide') } }, server: { port: 0, host: '127.0.0.1' } });
  server.middlewares.use(async (req, res, next) => {
    const route = req.url?.split('?')[0];
    if (route !== '/' && route !== '/browser' && route !== '/sessions') return next();
    res.setHeader('Content-Type', 'text/html');
    const entry = route === '/browser' ? 'themed-select-browser.ts' : route === '/sessions' ? 'themed-select-sessions.ts' : 'themed-select-app.ts';
    res.end(await server.transformIndexHtml(req.url, `<!doctype html><html><body><div id="root"></div><script type="module" src="/tests/fixtures/${entry}"></script></body></html>`));
  });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

test('keyboard navigation skips disabled options, cancels, commits and keeps focus', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    const choice = page.getByRole('combobox', { name: 'Choice' });
    await choice.focus();
    await choice.press('ArrowDown');
    await choice.press('ArrowDown');
    assert.match(await choice.getAttribute('aria-activedescendant'), /option-2$/);
    await choice.press('Escape');
    assert.equal(await page.locator('output').textContent(), 'a');
    await choice.press('c');
    await choice.press('Enter');
    assert.equal(await page.locator('output').textContent(), 'c');
    assert.equal(await choice.evaluate((el) => document.activeElement === el), true);
    await choice.press('ArrowDown');
    await choice.press('End');
    await choice.press('Tab');
    assert.equal(await page.locator('output').textContent(), 'd');
  } finally { await page.close(); }
});

test('portal flips into viewport, outside click cancels, empty and disabled controls are safe', async () => {
  const page = await browser.newPage({ viewport: { width: 400, height: 450 } });
  try {
    await page.goto(url);
    const choice = page.getByRole('combobox', { name: 'Choice' });
    await choice.click();
    const popup = page.getByRole('listbox', { name: 'Choice' });
    const rect = await popup.boundingBox();
    assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= 450);
    await page.mouse.click(390, 10);
    assert.equal(await choice.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('output').textContent(), 'a');
    assert.equal(await page.getByRole('combobox', { name: 'Locked' }).isDisabled(), true);
    await page.getByRole('combobox', { name: 'Empty' }).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  } finally { await page.close(); }
});

test('browser assignment supports keyboard cancellation, installed options and locking', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${url}/browser`);
    const choice = page.getByRole('combobox').first();
    await choice.waitFor();
    await choice.focus();
    await choice.press('ArrowDown');
    await choice.press('m');
    await choice.press('Escape');
    assert.deepEqual(await page.evaluate(() => window.__assignments), []);
    await choice.press('ArrowDown');
    assert.equal(await page.getByRole('option', { name: 'Microsoft Edge' }).count(), 0);
    await choice.press('m');
    await choice.press('Enter');
    await page.waitForFunction(() => window.__assignments.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__assignments[0]), { profileId: 'one', browser: 'firefox', isRequired: true });
    await page.goto(`${url}/browser?locked`);
    assert.equal(await page.getByRole('combobox').first().isDisabled(), true);
  } finally { await page.close(); }
});

test('dirty session selection keeps the edited profile until discard is confirmed', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${url}/sessions`);
    const choice = page.locator('#session-dropdown');
    await page.locator('#prof-name').fill('Changed');
    await choice.click();
    await page.getByRole('option', { name: 'Beta' }).click();
    await page.getByRole('dialog').waitFor();
    assert.match(await choice.textContent(), /Alpha/);
    await page.locator('.modal-actions .btn-secondary').click();
    assert.equal(await page.locator('#prof-name').inputValue(), 'Changed');
    assert.match(await choice.textContent(), /Alpha/);
    await choice.click();
    await page.getByRole('option', { name: 'Beta' }).click();
    await page.locator('.modal-actions .btn-discard').click();
    assert.equal(await page.locator('#prof-name').inputValue(), 'Beta');
    assert.match(await choice.textContent(), /Beta/);
  } finally { await page.close(); }
});
