import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let viteServer;
let serverUrl;
let browser;

before(async () => {
  viteServer = await createServer({
    configFile: false,
    appType: 'custom',
    root: projectRoot,
    publicDir: path.resolve(projectRoot, 'static'),
    plugins: [svelte({ configFile: false })],
    resolve: {
      alias: {
        $lib: path.resolve(projectRoot, 'src/lib'),
        $paraglide: path.resolve(projectRoot, 'src/paraglide'),
      },
    },
    server: {
      port: 0,
      host: '127.0.0.1',
    },
  });

  viteServer.middlewares.use(async (req, res, next) => {
    if (req.url?.startsWith('/')) {
      const pathname = req.url.split('?')[0];
      if (pathname === '/' || pathname === '/index.html') {
        const appHtmlPath = path.resolve(projectRoot, 'src/app.html');
        let rawHtml = fs.readFileSync(appHtmlPath, 'utf8');
        rawHtml = rawHtml.replace('%sveltekit.head%', '');
        rawHtml = rawHtml.replace(
          '%sveltekit.body%',
          '<div id="motion-root"></div><script type="module" src="/tests/fixtures/motion-app.ts"></script>'
        );
        const transformed = await viteServer.transformIndexHtml(req.url, rawHtml);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(transformed);
        return;
      }
    }
    next();
  });

  await viteServer.listen();
  const address = viteServer.httpServer.address();
  serverUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (viteServer) await viteServer.close();
});

test('motion preference disables visual interpolation and survives reload', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[BROWSER ERROR]', err));
  await page.goto(`${serverUrl}/`);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  const animSwitch = page.getByRole('switch', { name: 'Animations', exact: true });
  await animSwitch.waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(await animSwitch.getAttribute('aria-checked'), 'true');

  // Toggle off using Spacebar
  await animSwitch.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => {
    const sw = document.querySelector('button[role="switch"][aria-label="Animations"]');
    return sw && sw.getAttribute('aria-checked') === 'false';
  });
  assert.equal(await animSwitch.getAttribute('aria-checked'), 'false');
  // Navigate to Statistics -> This Week
  await page.getByRole('button', { name: 'Statistics' }).click({ force: true });
  await page.getByRole('button', { name: 'This Week' }).click({ force: true });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  // Assert 0 active CSS animations / transitions
  const activeAnimations = await page.evaluate(() => {
    return document.getAnimations().filter((a) => a.playState === 'running' || a.playState === 'paused').length;
  });
  assert.equal(activeAnimations, 0, 'No active animations when preference is false');
  // Visible chart bars
  const bars = await page.locator('.bar').count();
  assert.ok(bars > 0, 'Chart bars rendered');

  // Reload: switch remains false
  await page.reload();
  await page.waitForSelector('.app', { state: 'visible' });
  await page.getByRole('button', { name: 'Settings' }).click({ force: true });
  await page.getByRole('tab', { name: 'Appearance' }).click();
  const reloadedSwitch = page.getByRole('switch', { name: 'Animations', exact: true });
  await reloadedSwitch.waitFor({ state: 'visible' });

  // Toggle back on with Enter
  await reloadedSwitch.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const sw = document.querySelector('button[role="switch"][aria-label="Animations"]');
    return sw && sw.getAttribute('aria-checked') === 'true';
  });
  await context.close();
});

test('saved disabled preference prevents startup motion', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();

  // Start with hold_settings=true and animations=false
  await page.goto(`${serverUrl}/?hold_settings=true&animations=false`);

  // Assert HTML initial attribute suppresses animations before settings load
  const initialDataAttr = await page.evaluate(() => document.documentElement.dataset.animationsEnabled);
  assert.equal(initialDataAttr, 'false', 'app.html has data-animations-enabled="false"');

  // Release settings
  await page.evaluate(() => window.__motionTest.releaseSettings(false));
  await page.waitForSelector('.app', { state: 'visible' });

  // Still false
  const loadedDataAttr = await page.evaluate(() => document.documentElement.dataset.animationsEnabled);
  assert.equal(loadedDataAttr, 'false');

  await context.close();
});

test('reduced motion wins without rewriting preference', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=true`);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Appearance' }).click();

  const animSwitch = page.getByRole('switch', { name: 'Animations', exact: true });
  await animSwitch.waitFor({ state: 'visible' });
  // Stored preference is still true
  assert.equal(await animSwitch.getAttribute('aria-checked'), 'true');

  // Switch to Statistics: verify zero running CSS animations due to prefers-reduced-motion
  await page.getByRole('button', { name: 'Statistics' }).click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const animCount = await page.evaluate(() => {
    return document.getAnimations().filter((a) => a.playState === 'running' || a.playState === 'paused').length;
  });
  assert.equal(animCount, 0, 'OS reduced-motion suppresses all CSS animations');

  await context.close();
});

test('motion change finishes in-flight visuals and preserves timer progress', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=true`);

  // Verify dial progress arc on Timer
  await page.waitForSelector('.dial .progress', { state: 'visible' });
  await page.waitForFunction(() => {
    const el = document.querySelector('.dial .progress');
    const val = Number(el?.getAttribute('stroke-dashoffset'));
    return Math.abs(val - 691.15 * 0.25) < 2.0;
  });
  const offset30 = Number(await page.locator('.dial .progress').getAttribute('stroke-dashoffset'));
  assert.ok(Math.abs(offset30 - 691.15 * 0.25) < 2.0, `Expected ~172.78, got ${offset30}`);

  // Disable motion via event
  await page.evaluate(async () => {
    await window.__motionTest.emit('settings:changed', { animations_enabled: false });
  });

  // Deliver tick 60/120: progress should snap immediately to 691.15 * 0.5 ≈ 345.575
  await page.evaluate(async () => {
    await window.__motionTest.emit('timer:tick', { elapsed_secs: 60, total_secs: 120 });
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const offset60 = Number(await page.locator('.dial .progress').getAttribute('stroke-dashoffset'));
  assert.ok(Math.abs(offset60 - 691.15 * 0.5) < 2.0, `Expected ~345.57, got ${offset60}`);

  await context.close();
});

test('failed preference save keeps the prior setting and offers retry', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=true`);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Appearance' }).click();

  const animSwitch = page.getByRole('switch', { name: 'Animations', exact: true });
  await animSwitch.waitFor({ state: 'visible' });
  assert.equal(await animSwitch.getAttribute('aria-checked'), 'true');

  // Inject failure for next save
  await page.evaluate(() => {
    window.__motionTest.setNextSaveError('Network error');
  });

  await animSwitch.click();

  // Alert is visible, switch remains true
  const alert = page.getByRole('alert');
  await alert.waitFor({ state: 'visible' });
  assert.equal(await animSwitch.getAttribute('aria-checked'), 'true');

  // Successful retry
  await animSwitch.click();
  await page.waitForFunction(() => {
    const sw = document.querySelector('button[role="switch"]');
    return sw && sw.getAttribute('aria-checked') === 'false';
  });
  assert.equal(await animSwitch.getAttribute('aria-checked'), 'false');

  await context.close();
});

test('motion disabled leaves emergency hold feedback functional', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=false`);

  // Simulate locked focus session
  await page.evaluate(async () => {
    await window.__motionTest.setFocusSnapshot({
      status: 'active',
      current_phase: 'work',
      active_profile: null,
      current_work_round: 1,
      total_work_rounds: 4,
      is_locked: true,
      blocking_active: true,
      unblock_during_breaks: false,
      enforcement: {
        state: 'active',
        applications_active: true,
        websites_active: true,
        error_code: null,
      },
    });
  });

  // Open emergency dialog
  await page.locator('.session-btn.locked').click();
  await page.waitForSelector('.hold-btn', { state: 'visible' });

  // Press down on hold button
  await page.locator('.hold-btn').dispatchEvent('mousedown');
  await page.waitForTimeout(1100);

  // Assert progress width increased despite no CSS transitions
  const progressText = await page.locator('.progress-label').textContent();
  assert.notEqual(progressText?.trim(), '0%');

  // Release
  await page.locator('.hold-btn').dispatchEvent('mouseup');
  await page.waitForTimeout(100);

  // Progress reset to 0%
  const resetText = await page.locator('.progress-label').textContent();
  assert.equal(resetText?.trim(), '0%');

  await context.close();
});

test('main navigation matches statistics entrance and requests fluid window resize', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=true`);

  // Navigate Timer -> Settings
  await page.getByRole('button', { name: 'Settings' }).click();

  // Check IPC call to window_set_view_size
  const calls = await page.evaluate(() => window.__motionTest.getWindowResizeCalls());
  const settingsCall = calls.find((c) => c.view === 'settings');
  assert.ok(settingsCall, 'window_set_view_size called with settings');
  assert.equal(settingsCall.animate, true, 'Window resize requested with animate: true');

  // Check .view-enter animation on main
  const hasViewEnter = await page.locator('main.view-enter').count();
  assert.ok(hasViewEnter > 0, 'main has .view-enter class');

  await context.close();
});

test('disabled motion requests immediate window resize', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=false`);

  await page.evaluate(() => window.__motionTest.clearResizeCalls());
  await page.getByRole('button', { name: 'Settings' }).click();

  const calls = await page.evaluate(() => window.__motionTest.getWindowResizeCalls());
  const settingsCall = calls.find((c) => c.view === 'settings');
  assert.ok(settingsCall, 'window_set_view_size called with settings');
  assert.equal(settingsCall.animate, false, 'Window resize requested with animate: false');

  await context.close();
});

test('statistics tabs retain one entrance and their data', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=true`);

  await page.getByRole('button', { name: 'Statistics' }).click();
  await page.waitForSelector('.stats-section', { state: 'visible' });

  // Today view initially visible
  await page.waitForSelector('.card-value', { state: 'visible' });
  const initialCardVal = await page.locator('.card-value').first().textContent();
  assert.equal(initialCardVal?.trim(), '3');

  // Switch to This Week
  await page.getByRole('button', { name: 'This Week' }).click();
  await page.waitForSelector('.count-label', { state: 'visible' });

  // Switch to All Time
  await page.getByRole('button', { name: 'All Time' }).click();
  await page.waitForSelector('.totals', { state: 'visible' });

  await context.close();
});

test('rapid navigation keeps only the final view and current timer', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=true`);

  // Rapidly click Settings, Statistics, Timer
  await page.getByRole('button', { name: 'Settings' }).click({ force: true });
  await page.getByRole('button', { name: 'Statistics' }).click({ force: true });
  await page.getByRole('button', { name: 'Timer' }).click({ force: true });

  await page.waitForTimeout(300);

  // Exactly one main and Timer is visible
  const mains = await page.locator('main').count();
  assert.equal(mains, 1, 'Exactly one main element mounted');
  const timerVisible = await page.locator('.dial').isVisible();
  assert.ok(timerVisible, 'Timer view visible');

  await context.close();
});

test('focusing button preserves non-activation shortcuts', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/`);

  // Focus the Settings button
  const settingsBtn = page.getByRole('button', { name: 'Settings' });
  await settingsBtn.focus();

  // Press 'm' to mute
  await page.keyboard.press('m');
  // Verify mute did not activate settings navigation
  const inSettings = await page.locator('.settings-view').count();
  assert.equal(inSettings, 0, 'Pressing m did not click focused button');

  await context.close();
});

test('statistics tab views do not contain nested outer animations', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=true`);

  await page.getByRole('button', { name: 'Statistics' }).click({ force: true });
  await page.waitForSelector('.stats-section', { state: 'visible' });
  await page.getByRole('button', { name: 'This Week' }).click({ force: true });
  await page.waitForSelector('.stats-section .view');

  // Check that the child .view does not have an outer animation
  const viewAnimation = await page.evaluate(() => {
    const viewEl = document.querySelector('.stats-section .view');
    return viewEl ? window.getComputedStyle(viewEl).animationName : 'none';
  });
  assert.equal(viewAnimation, 'none', 'WeeklyView does not have nested app-fade-in animation');

  await context.close();
});

test('live motion disable updates window view size immediately', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=true`);

  await page.getByRole('button', { name: 'Settings' }).click({ force: true });
  await page.waitForSelector('.settings-view', { state: 'visible' });
  await page.evaluate(() => window.__motionTest.clearResizeCalls());

  // Live disable
  await page.evaluate(async () => {
    await window.__motionTest.emit('settings:changed', { animations_enabled: false });
  });

  await page.waitForFunction(() => {
    const calls = window.__motionTest.getWindowResizeCalls();
    return calls.some((c) => c.view === 'settings' && c.animate === false);
  });

  const calls = await page.evaluate(() => window.__motionTest.getWindowResizeCalls());
  const cancelCall = calls.find((c) => c.view === 'settings' && c.animate === false);
  assert.ok(cancelCall, 'setWindowViewSize called with animate: false on live motion disable');

  await context.close();
});
