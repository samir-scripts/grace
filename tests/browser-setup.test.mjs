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
  server = await createServer({ configFile: false, appType: 'custom', root, publicDir: path.join(root, 'static'), plugins: [svelte({ configFile: false })], resolve: { alias: { $lib: path.join(root, 'src/lib'), $paraglide: path.join(root, 'src/paraglide') } }, server: { port: 0, host: '127.0.0.1' } });
  server.middlewares.use(async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/') return next();
    const html = await server.transformIndexHtml(req.url, '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/tests/fixtures/browser-setup-app.ts"></script></body></html>');
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  });
  await server.listen(); url = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });

for (const mode of ['success', 'null', 'reject', 'error']) {
  test(`browser icon ${mode} keeps a usable card`, async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${url}/?icon=${mode}`);
      const card = page.locator('.browser-card').first();
      await card.waitFor();
      if (mode === 'success') {
        await card.locator('img').waitFor();
        assert.equal(await card.locator('img').getAttribute('alt'), '');
      } else {
        await card.locator('.browser-icon-wrapper svg').waitFor();
        assert.equal(await card.locator('img').count(), 0);
      }
      assert.equal(await page.locator('.browser-card').count(), 3);
    } finally { await page.close(); }
  });
}

test('default, installed, and active states are independent and refresh on disconnect', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    const chrome = page.locator('.browser-card').nth(0), firefox = page.locator('.browser-card').nth(1), zen = page.locator('.browser-card').nth(2);
    await chrome.locator('.badge.active').waitFor();
    assert.equal(await chrome.locator('.default-badge').count(), 1);
    assert.equal(await chrome.locator('.badge.installed').count(), 1);
    assert.equal(await firefox.locator('.badge.active').count(), 0);
    assert.equal(await firefox.locator('.badge.installed').count(), 1);
    assert.equal(await zen.locator('.default-badge, .badge.active').count(), 0);
    await page.evaluate(() => window.__browserSetupTest.disconnect());
    await page.locator('.btn-refresh').click();
    await page.waitForFunction(() => !document.querySelector('.browser-card .badge.active'));
    assert.equal(await chrome.locator('.default-badge').count(), 1);
    assert.equal(await chrome.locator('.badge.installed').count(), 1);
  } finally { await page.close(); }
});

test('resolved themes give distinct readable badges and German text fits', async () => {
  const page = await browser.newPage({ viewport: { width: 330, height: 700 } });
  try {
    await page.goto(url);
    const installed = page.locator('.browser-card .badge.installed').first();
    const active = page.locator('.browser-card .badge.active').first();
    await active.waitFor();
    for (const theme of ['dark', 'light']) {
      await page.evaluate((mode) => window.__browserSetupTest.theme(mode), theme);
      const roles = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const colors = ['installed', 'active'].map((role) => {
          const badge = document.querySelector(`.browser-card .badge.${role}`);
          const style = getComputedStyle(badge);
          const probe = document.createElement('span');
          probe.style.backgroundColor = root.getPropertyValue(`--color-browser-${role}-bg`);
          document.body.append(probe);
          const expected = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { foreground: style.color, background: style.backgroundColor, expected };
        });
        const luminance = (rgb) => {
          const values = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((n) => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
          return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
        };
        return colors.map((color) => ({ ...color, contrast: (Math.max(luminance(color.foreground), luminance(color.background)) + .05) / (Math.min(luminance(color.foreground), luminance(color.background)) + .05) }));
      });
      for (const role of roles) {
        assert.equal(role.background, role.expected);
        assert.ok(role.contrast >= 4.5, `badge contrast ${role.contrast}`);
      }
      assert.notEqual(roles[0].background, roles[1].background);
    }
    await page.evaluate(() => window.__browserSetupTest.locale('de'));
    await page.getByRole('heading', { name: 'Browser-Erweiterungen' }).waitFor();
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok(await installed.isVisible());
  } finally { await page.close(); }
});
