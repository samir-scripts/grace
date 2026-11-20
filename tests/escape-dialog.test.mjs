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

test('hold feedback resets on release and closes only when the backend authorizes it', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    await page.goto(url);
    const dialog = page.getByRole('dialog', { name: 'Emergency Exit' });
    const idle = dialog.getByRole('button', { name: 'Hold for 60 seconds to end session' });
    const holdMethod = dialog.getByRole('button', { name: 'Hold', exact: true });
    assert.equal(await holdMethod.getAttribute('aria-pressed', { timeout: 2000 }), 'true');
    await idle.hover();
    await page.mouse.down();
    await page.evaluate(() => window.escapeTest.resolveStart());
    await page.clock.runFor(1100);
    await dialog.getByRole('button', { name: '59s remaining', exact: true }).waitFor();
    await page.mouse.up();
    await idle.waitFor();
    const calls = () => page.evaluate(() => window.escapeTest.calls.slice());
    const canceled = await calls();
    assert.equal(canceled.at(-1), 'focus_escape_cancel_hold');
    await page.clock.runFor(1000);
    assert.deepEqual(await calls(), canceled);

    await idle.focus();
    await page.keyboard.down('Space');
    await page.evaluate(() => window.escapeTest.resolveStart());
    await page.clock.runFor(250);
    await dialog.getByRole('button', { name: '60s remaining', exact: true }).waitFor();
    // The UI clock can reach zero without authorization; only a positive pulse closes it.
    const now = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(now + 60_000);
    await page.clock.runFor(250);
    await dialog.getByRole('button', { name: '0s remaining', exact: true }).waitFor();
    await page.evaluate(() => window.escapeTest.finishHold());
    await page.clock.runFor(250);
    await dialog.waitFor({ state: 'detached' });
    await page.keyboard.up('Space');
  } finally { await page.close(); }
});

test('passphrase keeps labels and requirements visible, reports rejection and clears on close', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    const dialog = page.getByRole('dialog', { name: 'Emergency Exit' });
    const hold = dialog.getByRole('button', { name: 'Hold', exact: true });
    const method = dialog.getByRole('button', { name: 'Passphrase', exact: true });
    const first = dialog.getByLabel('Passphrase', { exact: true });
    const second = dialog.getByLabel('Confirm passphrase', { exact: true });
    const submit = dialog.getByRole('button', { name: 'End session', exact: true });
    const error = dialog.getByRole('alert');
    const status = dialog.getByRole('status');
    const phrase = 'synthetic fixture passphrase for emergency exit';
    const submits = () => page.evaluate(() => window.escapeTest.calls.filter(cmd => cmd === 'focus_escape_submit_passphrase').length);

    await method.click({ timeout: 2000 });
    assert.equal(await hold.getAttribute('aria-pressed'), 'false');
    assert.equal(await method.getAttribute('aria-pressed'), 'true');
    const hint = dialog.getByText('At least 30 characters', { exact: true });
    await hint.waitFor();
    assert.equal(await first.getAttribute('aria-describedby'), await hint.getAttribute('id'));
    assert.equal(await second.getAttribute('aria-describedby'), await hint.getAttribute('id'));
    assert.equal(await first.getAttribute('placeholder'), null);
    assert.equal(await second.getAttribute('placeholder'), null);
    await first.fill(phrase);
    await second.fill('different synthetic phrase for emergency exit');
    await submit.click();
    await error.filter({ hasText: 'Passphrases do not match' }).waitFor();
    assert.equal(await submits(), 0);
    await hint.waitFor();

    await second.fill(phrase);
    await submit.click();
    await status.filter({ hasText: 'Verifying' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: /Verifying/ }).isDisabled(), true);
    await page.evaluate(() => window.escapeTest.finishPassphrase('reject'));
    await error.filter({ hasText: 'Passphrase verification failed' }).waitFor();
    assert.equal(await submits(), 1);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    const opener = page.getByRole('button', { name: 'Open', exact: true });
    await opener.click();
    assert.equal(await hold.getAttribute('aria-pressed'), 'true');
    await method.click();
    assert.equal(await first.inputValue(), '');
    assert.equal(await second.inputValue(), '');
    assert.equal(await error.isVisible(), false);

    await first.fill(phrase);
    await second.fill(phrase);
    await submit.click();
    await status.filter({ hasText: 'Verifying' }).waitFor();
    await page.evaluate(() => window.escapeTest.finishPassphrase('success'));
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await submits(), 2);
    assert.equal(await opener.evaluate(el => el === document.activeElement), true);
  } finally { await page.close(); }
});
