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

  // Wait for asynchronous render-before-resize to dispatch IPC
  await page.waitForFunction(() => window.__motionTest.getWindowResizeCalls().some((c) => c.view === 'settings'));
  const calls = await page.evaluate(() => window.__motionTest.getWindowResizeCalls());
  const settingsCall = calls.find((c) => c.view === 'settings');
  assert.ok(settingsCall, 'window_set_view_size called with settings');
  assert.equal(settingsCall.animate, true, 'Window resize requested with animate: true');

  // Check .view-enter animation on main
  const hasViewEnter = await page.locator('main.view-enter').count();
  assert.ok(hasViewEnter > 0, 'main has .view-enter class');

  await context.close();
});

test('destination waits for resize completion before entering', async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 478 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  try {
    await page.goto(`${serverUrl}/?animations=true`);
    await page.waitForSelector('.dial');
    await page.evaluate(() => { window.__motionTest.clearResizeCalls(); window.__motionTest.holdNextResize(); });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForFunction(() => window.__motionTest.getWindowResizeCalls().some((call) => call.view === 'settings'));
    assert.equal(await page.locator('.settings-view').count(), 0, 'settings does not reflow during resize');
    await page.setViewportSize({ width: 840, height: 520 });
    await page.evaluate(() => window.__motionTest.releaseResize());
    await page.waitForSelector('.settings-view');
    assert.equal(await page.locator('.settings-view').evaluate((el) => getComputedStyle(el).flexDirection), 'row');
  } finally { await context.close(); }
});

test('a stale resize completion cannot replace the latest view', async () => {
  const context = await browser.newContext({ viewport: { width: 360, height: 478 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  try {
    await page.goto(`${serverUrl}/?animations=true`);
    await page.waitForSelector('.dial');
    await page.evaluate(() => { window.__motionTest.clearResizeCalls(); window.__motionTest.holdNextResize(); });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForFunction(() => window.__motionTest.getWindowResizeCalls().some((call) => call.view === 'settings'));
    await page.getByRole('button', { name: 'Statistics' }).click();
    await page.waitForSelector('.stats-section');
    await page.evaluate(() => window.__motionTest.releaseResize());
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.settings-view').count(), 0);
    assert.equal(await page.locator('.stats-section').count(), 1);
  } finally { await context.close(); }
});

test('disabled motion requests immediate window resize', async () => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 520 },
    locale: 'en',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/?animations=false`);
  await page.getByRole('button', { name: 'Settings' }).waitFor();

  await page.evaluate(() => {
    window.__motionTest.clearResizeCalls();
    // A disabled-motion resize must not depend on a compositor frame.
    window.requestAnimationFrame = () => 1;
    document.querySelector('button[aria-label="Settings"]').click();
  });
  // Wait for asynchronous render-before-resize to dispatch IPC
  await page.waitForFunction(() => window.__motionTest.getWindowResizeCalls().some((c) => c.view === 'settings'));
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

test('live system motion changes cancel resizing and apply to later navigation', async () => {
  const context = await browser.newContext({ viewport: { width: 840, height: 520 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  try {
    await page.goto(`${serverUrl}/?animations=true`);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForFunction(() => window.__motionTest.getWindowResizeCalls().some((call) => call.view === 'settings' && call.animate));
    await page.evaluate(() => window.__motionTest.clearResizeCalls());
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.__motionTest.getWindowResizeCalls().some((call) => call.view === 'settings' && !call.animate));
    await page.waitForFunction(() => window.__motionTest.getAppearanceMotionCalls().at(-1) === false);
    await page.getByRole('button', { name: 'Statistics' }).click();
    await page.waitForFunction(() => window.__motionTest.getWindowResizeCalls().some((call) => call.view === 'stats' && !call.animate));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => window.__motionTest.getAppearanceMotionCalls().at(-1) === true);
    await page.getByRole('button', { name: 'Timer' }).click();
    await page.waitForFunction(() => window.__motionTest.getWindowResizeCalls().some((call) => call.view === 'timer' && call.animate));
  } finally {
    await context.close();
  }
});

test('rendered theme roles remain opaque and readable across light, dark and custom palettes', async () => {
  const context = await browser.newContext({ viewport: { width: 840, height: 520 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(`${serverUrl}/`);
  await page.waitForSelector('.app', { state: 'visible' });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('switch', { name: 'Animations', exact: true }).waitFor();
  const palettes = [
    JSON.parse(fs.readFileSync(path.join(projectRoot, 'static/themes/solarized-light.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(projectRoot, 'static/themes/solarized-dark.json'), 'utf8')),
    { name: 'Custom', colors: { '--color-background': '#abc', '--color-foreground': '#aaa', '--color-accent': '#b32' } },
  ];
  for (const palette of palettes) {
    const results = await page.evaluate(async theme => {
      const { applyTheme } = await import('/src/lib/stores/theme.ts');
      applyTheme(theme);
      const root = getComputedStyle(document.documentElement);
      const parse = value => {
        const probe = document.createElement('span');
        probe.style.color = value;
        document.body.append(probe);
        const rgba = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
        probe.remove();
        return rgba;
      };
      const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const surfaces = ['background', 'background-light', 'hover', 'selected'].map(name => parse(root.getPropertyValue(`--color-${name}`)));
      const inks = ['foreground', 'foreground-darker', 'status-error', 'status-success', 'status-warning'].map(name => parse(root.getPropertyValue(`--color-${name}`)));
      const border = parse(root.getPropertyValue('--color-border'));
      const separator = parse(root.getPropertyValue('--color-separator'));
      const button = parse(root.getPropertyValue('--color-button'));
      const buttonText = parse(root.getPropertyValue('--color-button-text'));
      const row = document.querySelector('button[role="switch"][aria-label="Animations"]');
      const label = row.querySelector('.label');
      const actualText = parse(getComputedStyle(label).color);
      const actualSurface = parse(getComputedStyle(row).backgroundColor);
      return { colors: [...surfaces, ...inks, actualText, actualSurface], ratios: [...inks.flatMap(ink => surfaces.map(surface => contrast(ink, surface))), contrast(actualText, actualSurface)], opacity: getComputedStyle(label).opacity, actualText, actualSurface, separatorRatio: contrast(separator, surfaces[0]), borderRatio: contrast(border, surfaces[0]), buttonRatio: contrast(button, buttonText) };
    }, palette);
    assert.equal(results.opacity, '1', `${palette.name}: label opacity`);
    assert.ok(results.separatorRatio < results.borderRatio * .7, `${palette.name}: separator is softer than control border`);
    assert.ok(results.buttonRatio >= 4.5, `${palette.name}: button contrast ${results.buttonRatio}`);
    assert.ok(results.colors.every(color => color.length === 3 || color[3] === 1), `${palette.name}: colors are opaque`);
    assert.ok(results.ratios.every(ratio => ratio >= 4.5), `${palette.name}: minimum contrast ${Math.min(...results.ratios)} actual ${JSON.stringify([results.actualText, results.actualSurface])}`);
  }
  await context.close();
});

test('capture desktop layout evidence', { skip: !process.env.GRACE_CAPTURE_LAYOUTS }, async () => {
  const output = path.join(projectRoot, 'plans/evidence/grace-ui-2026-11-10');
  fs.mkdirSync(output, { recursive: true });
  for (const [name, width, height] of [['timer', 360, 478], ['compact', 240, 240], ['enlarged', 840, 700], ['settings', 840, 520], ['stats', 840, 520]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${serverUrl}/`);
    await page.waitForSelector('.app', { state: 'visible' });
    if (name === 'settings') await page.getByRole('button', { name: 'Settings' }).click();
    if (name === 'stats') await page.getByRole('button', { name: 'Statistics' }).click();
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    await context.close();
  }
});


test('capture theme appearance evidence', { skip: !process.env.GRACE_CAPTURE_THEMES }, async () => {
  const output = path.join(projectRoot, 'plans/evidence/grace-ui-2026-11-10');
  fs.mkdirSync(output, { recursive: true });
  for (const [filename, palette, section] of [
    ['solarized-light-sessions', 'solarized-light', 'sessions'],
    ['solarized-light-appearance', 'solarized-light', 'appearance'],
    ['solarized-dark-sessions', 'solarized-dark', 'sessions'],
    ['solarized-dark-appearance', 'solarized-dark', 'appearance'],
    ['custom-sessions', 'custom', 'sessions'],
  ]) {
    const theme = palette === 'custom'
      ? { name: 'Custom', colors: { '--color-background': '#abc', '--color-foreground': '#aaa', '--color-accent': '#b32' } }
      : JSON.parse(fs.readFileSync(path.join(projectRoot, `static/themes/${palette}.json`), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 840, height: 520 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`${serverUrl}/`);
    await page.getByRole('button', { name: 'Settings' }).click();
    if (section === 'appearance') await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.evaluate(async theme => (await import('/src/lib/stores/theme.ts')).applyTheme(theme), theme);
    await page.mouse.move(0, 519);
    await page.screenshot({ path: path.join(output, `${filename}.png`) });
    await context.close();
  }
});

test('session slider shows its colored fill through the input and aligns with the thumb', async () => {
  const context = await browser.newContext({ viewport: { width: 840, height: 520 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto(`${serverUrl}/`);
    await page.getByRole('button', { name: 'Settings' }).click();
    const slider = page.locator('.slider-container input[type="range"]').first();
    await slider.waitFor();
    const background = await slider.evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(background, 'rgba(0, 0, 0, 0)', 'input must expose the colored fill below it');
    for (const fraction of [0, 0.5, 1]) {
      const geometry = await slider.evaluate(async (el, fraction) => {
        const min = Number(el.min), max = Number(el.max);
        el.value = String(min + (max - min) * fraction);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const input = el.getBoundingClientRect();
        const fill = el.parentElement.querySelector('.slider-bar');
        const rect = fill.getBoundingClientRect();
        return { actual: rect.right - input.left, expected: 7 + (Number(el.value) - min) / (max - min) * (input.width - 14), fill: getComputedStyle(fill).backgroundColor };
      }, fraction);
      assert.notEqual(geometry.fill, 'rgba(0, 0, 0, 0)', 'fill must have a visible color');
      assert.ok(Math.abs(geometry.actual - geometry.expected) < 1, `fill ends at thumb center (${fraction}): ${JSON.stringify(geometry)}`);
    }
  } finally { await context.close(); }
});

test('long session name stays clear of titlebar controls in compact and normal windows', async () => {
  for (const platform of ['Macintosh', 'Linux']) {
    for (const width of [240, 360]) {
      const context = await browser.newContext({ viewport: { width, height: 478 }, userAgent: `Mozilla/5.0 (${platform})`, reducedMotion: 'reduce' });
      const page = await context.newPage();
      try {
        await page.goto(`${serverUrl}/`);
        await page.locator('.session-name').evaluate(el => { el.textContent = 'An exceptionally long session name for geometry testing'; });
        const result = await page.evaluate(() => {
          const selector = document.querySelector('.session-btn').getBoundingClientRect();
          const controls = [...document.querySelectorAll('.titlebar .btn-icon')].map(el => {
            const rect = el.getBoundingClientRect();
            return { left: rect.left, right: rect.right, label: el.getAttribute('aria-label') };
          });
          return { left: selector.left, right: selector.right, controls };
        });
        for (const control of result.controls) {
          assert.ok(result.right <= control.left || result.left >= control.right, `${platform} ${width}: selector overlaps ${control.label}`);
        }
        await page.locator('.session-btn').click();
        assert.equal(await page.getByRole('listbox').isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('listbox').count(), 0);
        await page.getByRole('button', { name: 'Statistics' }).click();
        assert.equal(await page.getByRole('button', { name: 'This Week' }).isVisible(), true);
      } finally { await context.close(); }
    }
  }
});

test('appearance mode exposes selection and responds to keyboard activation', async () => {
  const context = await browser.newContext({ viewport: { width: 840, height: 520 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto(`${serverUrl}/`);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    const mode = page.getByRole('group', { name: 'Mode' });
    const auto = mode.getByRole('button', { name: 'Auto' });
    const light = mode.getByRole('button', { name: 'Light' });
    const dark = mode.getByRole('button', { name: 'Dark' });
    assert.equal(await dark.getAttribute('aria-pressed'), 'true');
    assert.equal(await light.getAttribute('aria-pressed'), 'false');
    await light.focus();
    await page.keyboard.press('Space');
    await light.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('button[aria-label="Light"]').getAttribute('aria-pressed') === 'true');
    assert.equal(await dark.getAttribute('aria-pressed'), 'false');
    await auto.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('button[aria-label="Auto"]').getAttribute('aria-pressed') === 'true');
    assert.equal(await light.getAttribute('aria-pressed'), 'false');
  } finally { await context.close(); }
});

test('updating an installed companion preserves participants and is disabled while locked', async () => {
  const context = await browser.newContext({ viewport: { width: 840, height: 520 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto(`${serverUrl}/?browser_fixture=1`);
    await page.getByRole('button', { name: 'Settings' }).click();
    const update = page.getByRole('button', { name: 'Update Extension' });
    await update.click();
    await page.waitForFunction(() => window.__motionTest.getBrowserSetupCalls().length === 2);
    assert.deepEqual(await page.evaluate(() => window.__motionTest.getBrowserSetupCalls()), ['focus_native_host_register', 'focus_browser_extension_install']);
    assert.equal(await page.getByText('fixture-profile').count(), 1);
    await page.evaluate(async () => {
      const store = await import('/src/lib/stores/focus.ts');
      store.focusSnapshot.update(snapshot => ({ ...snapshot, is_locked: true }));
    });
    await page.waitForFunction(() => document.querySelector('button[title="Extensions cannot be changed while a focus session is active."]')?.disabled);
    assert.equal(await update.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Remove Extension' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Install Extension' }).isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.__motionTest.getBrowserSetupCalls()), ['focus_native_host_register', 'focus_browser_extension_install']);
  } finally { await context.close(); }
});
