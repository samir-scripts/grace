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
    const html = await server.transformIndexHtml(req.url, '<!doctype html><html><head></head><body><div id="motion-root" style="height:100%"></div><script type="module" src="/tests/fixtures/motion-app.ts"></script></body></html>');
    res.setHeader('Content-Type', 'text/html'); res.end(html);
  });
  await server.listen(); url = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await server?.close(); });
async function appearance(page) {
  await page.goto(`${url}/?animations=false`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await page.getByRole('combobox', { name: 'Interface style', exact: true }).waitFor();
}
async function choose(page, name, value) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="combobox"][disabled]'));
}
async function startTimerFixture(page) {
  await page.goto(`${url}/?animations=false&material_deferred`);
  await page.waitForFunction(() => window.__motionTest?.materialPending());
  await page.evaluate(() => window.__motionTest.releaseMaterial());
  await page.waitForFunction(() => ['timer:tick', 'timer:paused', 'settings:changed']
    .every(event => window.__motionTest?.hasRegisteredEvent(event)));
}
test('font and style are independent and failed saves retain prior selection', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await appearance(page);
    await choose(page, 'Font', 'JetBrains Mono');
    await page.waitForFunction(() => getComputedStyle(document.body).fontFamily.includes('JetBrains Mono'));
    await choose(page, 'Interface style', 'Blocky');
    await page.waitForFunction(() => document.documentElement.dataset.uiStyle === 'blocky');
    assert.ok(await page.getByRole('combobox', { name: 'Font', exact: true }).innerText().then(t => t.includes('JetBrains Mono')));
    assert.equal(await page.getByRole('combobox', { name: 'Interface style', exact: true }).evaluate(el => getComputedStyle(el).borderRadius), '0px');
    await page.evaluate(() => window.__motionTest.setNextSaveError('Injected save failure'));
    await choose(page, 'Interface style', 'Glass');
    await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.uiStyle), 'blocky');
    await choose(page, 'Interface style', 'Glass');
    await page.waitForFunction(() => document.documentElement.dataset.uiStyle === 'glass');
    assert.equal(await page.getByRole('combobox', { name: 'Interface style', exact: true }).evaluate(el => getComputedStyle(el).borderRadius), '6px');
  } finally { await page.close(); }
});
test('solid themed hover remains readable and reduced motion suppresses transitions', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 }, reducedMotion: 'reduce' });
  try {
    await appearance(page);
    const button = page.getByRole('button', { name: 'Import Font', exact: true });
    await button.hover();
    const colors = await button.evaluate(el => {
      const c = getComputedStyle(el), root = getComputedStyle(document.documentElement);
      return { bg: c.backgroundColor, fg: c.color, duration: c.transitionDuration, expected: root.getPropertyValue('--color-button').trim() };
    });
    assert.match(colors.bg, /^rgb\(/, 'hover is opaque');
    assert.equal(colors.duration, '0s');
  } finally { await page.close(); }
});
test('blocky ring uses live timer progress at compact and normal sizes', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 478 }, reducedMotion: 'reduce' });
  try {
    await startTimerFixture(page);
    await page.evaluate(() => window.__motionTest.emit('settings:changed', { ui_style: 'blocky', dial_countdown: false }));
    await page.locator('.dial .block-progress').waitFor();
    await page.evaluate(() => window.__motionTest.emit('timer:tick', { elapsed_secs: 750, total_secs: 1500 }));
    await page.waitForFunction(() => Number(document.querySelector('.block-progress').getAttribute('stroke-dashoffset')) === 50);
    await page.evaluate(() => window.__motionTest.emit('settings:changed', { dial_countdown: true }));
    await page.evaluate(() => window.__motionTest.emit('timer:tick', { elapsed_secs: 1500, total_secs: 1500 }));
    await page.waitForFunction(() => Number(document.querySelector('.block-progress').getAttribute('stroke-dashoffset')) === 100);
    await page.evaluate(() => window.__motionTest.emit('timer:paused', { elapsed_secs: 1500 }));
    await page.setViewportSize({ width: 240, height: 240 });
    await page.locator('.mini-controls').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.time').isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).isVisible(), true);
  } finally { await page.close(); }
});

test('imported fonts decode, survive reload and removal restores the default face', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await appearance(page);
    await page.getByRole('button', { name: 'Import Font', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.body).fontFamily.includes('GraceCustom-'));
    await page.reload();
    await page.locator('.app').waitFor();
    await page.waitForFunction(() => getComputedStyle(document.body).fontFamily.includes('GraceCustom-'));
    const importedFamily = await page.evaluate(() => [...document.fonts].find(face => face.family.startsWith('GraceCustom-')).family);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Imported', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.body).fontFamily.startsWith('\"Mona Sans\"'));
    assert.equal(await page.getByRole('button', { name: 'Remove Imported', exact: true }).count(), 0);
    assert.equal(await page.evaluate(family => [...document.fonts].some(face => face.family === family), importedFamily), false);
  } finally { await page.close(); }
});

test('undecodable imports are rolled back without changing the selected font', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await page.goto(`${url}/?animations=false&invalid_font`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.getByRole('button', { name: 'Import Font', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Remove Imported', exact: true }).count(), 0);
    assert.match(await page.getByRole('combobox', { name: 'Font', exact: true }).innerText(), /Mona Sans/);
  } finally { await page.close(); }
});

test('all bundled font packs decode locally without remote font requests', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  const remoteFonts = [];
  page.on('request', request => {
    if (request.resourceType() === 'font' && !request.url().startsWith(url)) remoteFonts.push(request.url());
  });
  try {
    await appearance(page);
    for (const name of ['Inter', 'Roboto', 'JetBrains Mono', 'Mona Sans']) {
      await choose(page, 'Font', name);
      await page.waitForFunction(family => getComputedStyle(document.body).fontFamily.includes(family), name);
      assert.equal(await page.evaluate(family => document.fonts.check(`16px \"${family}\"`), name), true);
    }
    assert.deepEqual(remoteFonts, []);
  } finally { await page.close(); }
});

test('dropdown navigation and typeahead do not mute or change timer volume', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await appearance(page);
    const font = page.getByRole('combobox', { name: 'Font', exact: true });
    await font.focus();
    await font.press('ArrowDown');
    await font.press('m');
    await font.press('Escape');
    await page.getByRole('button', { name: 'Timer', exact: true }).click();
    const mute = page.getByRole('button', { name: 'Mute', exact: true });
    await mute.waitFor();
    await mute.hover();
    assert.equal(await page.getByRole('slider', { name: 'Volume' }).inputValue(), '1');
  } finally { await page.close(); }
});

test('keyboard font commit retains focus after a delayed preference save', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await appearance(page);
    await page.evaluate(() => window.__motionTest.holdNextSave());
    const style = page.getByRole('combobox', { name: 'Interface style', exact: true });
    await style.focus();
    await style.press('ArrowDown');
    await style.press('ArrowDown');
    await style.press('Enter');
    await page.waitForFunction(() => document.querySelector('#ui-style').disabled);
    await page.evaluate(() => window.__motionTest.releaseSave());
    await page.waitForFunction(() => !document.querySelector('#ui-style').disabled);
    assert.equal(await style.evaluate(el => document.activeElement === el), true);
  } finally { await page.close(); }
});

test('a font import from an unmounted section cannot overwrite a newer choice', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await appearance(page);
    await page.evaluate(() => window.__motionTest.holdFontRead());
    await page.getByRole('button', { name: 'Import Font', exact: true }).click();
    await page.waitForFunction(() => window.__motionTest.fontReadPending());
    await page.getByRole('button', { name: 'Timer', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await choose(page, 'Font', 'Roboto');
    await page.evaluate(() => window.__motionTest.releaseFontRead());
    // Wait for the pending face to decode, not an arbitrary delay.
    await page.waitForFunction(() => [...document.fonts].some(face => face.family.startsWith('GraceCustom-') && face.status === 'loaded'));
    assert.match(await page.getByRole('combobox', { name: 'Font', exact: true }).innerText(), /Roboto/);
    assert.ok(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Roboto')));
  } finally { await page.close(); }
});

test('minimize retains the titlebar hover-suppression contract', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' });
  try {
    await page.goto(`${url}/?animations=false`);
    const minimize = page.getByRole('button', { name: 'Minimize', exact: true });
    await minimize.waitFor();
    const normal = await minimize.evaluate(el => getComputedStyle(el).backgroundColor);
    await minimize.click();
    await page.locator('.titlebar.suppress-hover').waitFor();
    assert.equal(await minimize.evaluate(el => getComputedStyle(el).backgroundColor), normal);
  } finally { await page.close(); }
});

for (const mode of ['normal', 'disabled', 'reduced']) {
  test(`control interpolation is deliberate and respects ${mode} motion`, async () => {
    const page = await browser.newPage({ viewport: { width: 840, height: 600 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    try {
      await page.goto(`${url}/?animations=${mode !== 'disabled'}`);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Notifications', exact: true }).click();
      const sw = page.getByRole('switch', { name: 'Desktop Notifications', exact: true });
      await sw.waitFor();
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      const durations = await sw.evaluate(el => ({
        row: getComputedStyle(el).transitionDuration,
        thumb: getComputedStyle(el.querySelector('.toggle'), '::after').transitionDuration,
      }));
      if (mode === 'normal') {
        assert.ok(durations.row.split(', ').every(duration => duration === '0.28s'));
        assert.equal(durations.thumb, '0.3s, 0.28s');
      } else {
        assert.equal(durations.row, '0s');
        assert.equal(durations.thumb, '0s');
      }
      await sw.click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Desktop Notifications"]').getAttribute('aria-checked') === 'true');
      if (mode === 'normal') {
        await page.waitForFunction(() => {
          const transform = getComputedStyle(document.querySelector('[aria-label="Desktop Notifications"] .toggle'), '::after').transform;
          const x = transform === 'none' ? 0 : new DOMMatrix(transform).m41;
          return x > 0 && x < 16;
        });
        await sw.click();
        await page.waitForFunction(() => document.querySelector('[aria-label="Desktop Notifications"]').getAttribute('aria-checked') === 'false');
        await page.waitForFunction(() => {
          const transform = getComputedStyle(document.querySelector('[aria-label="Desktop Notifications"] .toggle'), '::after').transform;
          return transform === 'none' || new DOMMatrix(transform).m41 === 0;
        });
      } else {
        assert.equal(await sw.locator('.toggle').evaluate(el => new DOMMatrix(getComputedStyle(el, '::after').transform).m41), 16);
      }
    } finally { await page.close(); }
  });
}

test('Blocky ring gives full-size digits breathing room without crowding compact controls', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 478 }, reducedMotion: 'reduce' });
  try {
    await startTimerFixture(page);
    await page.evaluate(() => window.__motionTest.emit('timer:tick', { elapsed_secs: 0, total_secs: 1500 }));
    for (const [pack, family] of [['mona-sans', 'Mona Sans'], ['inter', 'Inter'], ['roboto', 'Roboto'], ['jetbrains-mono', 'JetBrains Mono']]) {
      await page.evaluate(font_pack => window.__motionTest.emit('settings:changed', { ui_style: 'blocky', font_pack }), pack);
      await page.locator('.block-progress').waitFor();
      await page.waitForFunction(font => getComputedStyle(document.body).fontFamily.includes(font), family);
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => {
        const dial = document.querySelector('.dial'), path = document.querySelector('.block-progress');
        const rect = dial.getBoundingClientRect(), time = document.querySelector('.time').getBoundingClientRect();
        const matrix = path.getScreenCTM();
        const left = new DOMPoint(5, 12.5).matrixTransform(matrix).x;
        const right = new DOMPoint(31, 12.5).matrixTransform(matrix).x;
        return { width: rect.width, height: rect.height, leftGap: time.left - left, rightGap: right - time.right,
          stroke: Number.parseFloat(getComputedStyle(path).strokeWidth) * Math.hypot(matrix.a, matrix.b) };
      });
      assert.ok(Math.abs(geometry.width - 280) < 0.1, JSON.stringify(geometry));
      assert.ok(Math.abs(geometry.height - 280 * 180 / 230) < 0.1, JSON.stringify(geometry));
      assert.ok(geometry.leftGap >= 16 && geometry.rightGap >= 16, `${family}: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.stroke >= 13);
      assert.equal(await page.locator('.time').textContent(), '25:00');
    }
    await page.setViewportSize({ width: 240, height: 240 });
    await page.locator('.mini-controls').waitFor({ state: 'visible' });
    const fits = () => page.locator('.dial').evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
    });
    assert.equal(await fits(), true);
    const blockyWidth = await page.locator('.dial').evaluate(el => el.getBoundingClientRect().width);
    await page.evaluate(() => window.__motionTest.emit('settings:changed', { ui_style: 'pomotroid' }));
    await page.waitForFunction(() => document.querySelector('.dial').viewBox.baseVal.height === 230);
    const circularWidth = await page.locator('.dial').evaluate(el => el.getBoundingClientRect().width);
    assert.ok(blockyWidth > circularWidth, 'style changes recompute compact fit without resize');
    await page.evaluate(() => window.__motionTest.emit('settings:changed', { ui_style: 'blocky' }));
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await fits(), true);
  } finally { await page.close(); }
});

test('Blocky switches have square thumbs in both states and other styles restore circles', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 }, reducedMotion: 'reduce' });
  try {
    await appearance(page);
    await choose(page, 'Interface style', 'Blocky');
    await page.getByRole('tab', { name: 'Notifications', exact: true }).click();
    const sw = page.getByRole('switch', { name: 'Desktop Notifications', exact: true });
    const corners = () => sw.locator('.toggle').evaluate(el => {
      const style = getComputedStyle(el, '::after');
      return { radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius],
        width: style.width, height: style.height };
    });
    await sw.waitFor();
    assert.deepEqual((await corners()).radii, ['0px', '0px', '0px', '0px']);
    await sw.focus();
    await sw.press('Space');
    await page.waitForFunction(() => document.querySelector('[aria-label="Desktop Notifications"]').getAttribute('aria-checked') === 'true');
    assert.deepEqual(await corners(), { radii: ['0px', '0px', '0px', '0px'], width: '12px', height: '12px' });
    await sw.press('Enter');
    await page.waitForFunction(() => document.querySelector('[aria-label="Desktop Notifications"]').getAttribute('aria-checked') === 'false');
    for (const style of ['pomotroid', 'glass']) {
      await page.evaluate(ui_style => window.__motionTest.emit('settings:changed', { ui_style }), style);
      await page.waitForFunction(value => document.documentElement.dataset.uiStyle === value, style);
      assert.deepEqual((await corners()).radii, ['50%', '50%', '50%', '50%']);
    }
  } finally { await page.close(); }
});

async function startGlass(page, query = '') {
  await page.addInitScript(() => sessionStorage.setItem('appearance-style', 'glass'));
  await page.goto(`${url}/?animations=false${query}`);
  await page.locator('.dial').waitFor();
}

async function materialMode(page, mode) {
  await page.waitForFunction(value => document.documentElement.dataset.windowMaterial === value, mode);
}

async function canvasPaint(page) {
  return page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }));
}

test('saved Glass acknowledges native composition before showing a translucent canvas', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 478 } });
  try {
    await startGlass(page);
    await page.waitForFunction(() => window.__motionTest.getNativeStartupEvents().includes('window:shown'));
    const order = await page.evaluate(() => window.__motionTest.getNativeStartupEvents());
    assert.ok(order.indexOf('material:acknowledged') >= 0 && order.indexOf('material:acknowledged') < order.indexOf('window:shown'), JSON.stringify(order));
    await materialMode(page, 'frosted');
    const paint = await canvasPaint(page);
    assert.equal(paint.html, 'rgba(0, 0, 0, 0)');
    assert.match(paint.body, /^rgba\(/);
    const alpha = Number(paint.body.match(/, ([\d.]+)\)$/)[1]);
    assert.ok(alpha > 0 && alpha < 1, 'native material remains visible through the canvas');
    assert.equal(await page.locator('.time').isVisible(), true);
  } finally { await page.close(); }
});

for (const failure of ['material_unsupported', 'material_error']) {
  test(`Glass retains a solid usable window when ${failure}`, async () => {
    const page = await browser.newPage();
    try {
      await startGlass(page, `&${failure}`);
      await page.waitForFunction(() => window.__motionTest.getNativeStartupEvents().includes('window:shown'));
      await materialMode(page, 'opaque');
      const paint = await canvasPaint(page);
      assert.match(paint.body, /^rgb\(/);
      assert.equal(await page.getByRole('button', { name: 'Settings', exact: true }).isEnabled(), true);
    } finally { await page.close(); }
  });
}

test('pending native initialization remains opaque and delays first native show', async () => {
  const page = await browser.newPage();
  try {
    await startGlass(page, '&material_deferred');
    await page.waitForFunction(() => window.__motionTest.materialPending());
    await materialMode(page, 'opaque');
    assert.match((await canvasPaint(page)).body, /^rgb\(/);
    assert.equal(await page.evaluate(() => window.__motionTest.getNativeStartupEvents().includes('window:shown')), false);
    await page.evaluate(() => window.__motionTest.releaseMaterial());
    await materialMode(page, 'frosted');
    await page.waitForFunction(() => window.__motionTest.getNativeStartupEvents().includes('window:shown'));
  } finally { await page.close(); }
});

test('Glass switching, reset and unrelated preferences preserve the newest material', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await appearance(page);
    await choose(page, 'Interface style', 'Glass');
    await materialMode(page, 'frosted');
    const calls = await page.evaluate(() => window.__motionTest.getMaterialCalls().length);
    await choose(page, 'Font', 'Inter');
    await page.waitForFunction(() => getComputedStyle(document.body).fontFamily.includes('Inter'));
    assert.equal(await page.evaluate(() => window.__motionTest.getMaterialCalls().length), calls);
    for (const label of ['Blocky', 'Pomotroid']) {
      await choose(page, 'Interface style', label);
      await materialMode(page, 'opaque');
      assert.match((await canvasPaint(page)).body, /^rgb\(/);
      await choose(page, 'Interface style', 'Glass');
      await materialMode(page, 'frosted');
    }
    await page.getByRole('tab', { name: 'System', exact: true }).click();
    await page.getByRole('button', { name: 'Reset All Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await materialMode(page, 'opaque');
    await page.waitForFunction(() => document.documentElement.dataset.uiStyle === 'pomotroid');
    assert.match((await canvasPaint(page)).body, /^rgb\(/);
  } finally { await page.close(); }
});

test('late native acknowledgements and older events cannot expose a stale Glass state', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await appearance(page);
    await page.evaluate(() => window.__motionTest.holdNextMaterial());
    await choose(page, 'Interface style', 'Glass');
    await page.waitForFunction(() => window.__motionTest.materialPending());
    await materialMode(page, 'opaque');
    await choose(page, 'Interface style', 'Blocky');
    await page.evaluate(() => window.__motionTest.releaseMaterial());
    await page.waitForFunction(() => window.__motionTest.getMaterialCalls().length >= 3);
    await materialMode(page, 'opaque');
    assert.match((await canvasPaint(page)).body, /^rgb\(/);
    await choose(page, 'Interface style', 'Glass');
    await materialMode(page, 'frosted');
    await page.evaluate(() => window.__motionTest.setNativeMaterialAllowed(false));
    await materialMode(page, 'opaque');
    await page.evaluate(() => window.__motionTest.emit('window:material-changed', { active: true, revision: 0 }));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.windowMaterial), 'opaque');
    await page.evaluate(() => window.__motionTest.setNativeMaterialAllowed(true));
    await materialMode(page, 'frosted');
  } finally { await page.close(); }
});

test('transparency and forced-color preferences disable material and restore it only after acknowledgement', async () => {
  const page = await browser.newPage();
  try {
    await startGlass(page);
    await materialMode(page, 'frosted');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await materialMode(page, 'opaque');
    assert.match((await canvasPaint(page)).body, /^rgb\(/);
    await page.evaluate(() => window.__motionTest.holdNextMaterial());
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] });
    await page.waitForFunction(() => window.__motionTest.materialPending());
    await materialMode(page, 'opaque');
    await page.evaluate(() => window.__motionTest.releaseMaterial());
    await materialMode(page, 'frosted');
    await cdp.detach();
    await page.emulateMedia({ forcedColors: 'active' });
    await materialMode(page, 'opaque');
    await page.emulateMedia({ forcedColors: 'none' });
    await materialMode(page, 'frosted');
  } finally { await page.close(); }
});

test('unmount during native initialization cannot reveal material or show a destroyed view', async () => {
  const page = await browser.newPage();
  try {
    await startGlass(page, '&material_deferred');
    await page.waitForFunction(() => window.__motionTest.materialPending());
    await page.evaluate(() => window.__motionTest.unmountApp());
    await page.evaluate(() => window.__motionTest.releaseMaterial());
    await page.waitForFunction(() => window.__motionTest.getMaterialCalls().at(-1) === false);
    await page.evaluate(() => window.__motionTest.emit('window:material-changed', { active: true, revision: 999 }));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.windowMaterial), 'opaque');
    assert.equal(await page.locator('.app').count(), 0);
    assert.equal(await page.evaluate(() => window.__motionTest.getNativeStartupEvents().includes('window:shown')), false);
  } finally { await page.close(); }
});

for (const native of ['', '&material_unsupported']) {
  test(`Glass sidebar separates its inset selection in ${native ? 'opaque fallback' : 'frosted mode'}`, async () => {
    const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
    try {
      await startGlass(page, native);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
      await page.mouse.move(830, 590);
      const sidebar = await page.locator('.sidebar').evaluate(el => {
        const c = getComputedStyle(el), list = el.querySelector('.nav-list');
        const rows = [...el.querySelectorAll('.nav-item')];
        const active = el.querySelector('.active'), inactive = rows.find(r => r !== active);
        return { padding: c.padding, gap: getComputedStyle(list).gap,
          inset: rows[0].getBoundingClientRect().left - el.getBoundingClientRect().left,
          rowGap: rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom,
          radius: getComputedStyle(active).borderRadius,
          border: getComputedStyle(active).borderLeftWidth,
          inactive: getComputedStyle(inactive).backgroundColor };
      });
      assert.equal(sidebar.padding, '8px');
      assert.equal(sidebar.gap, '4px');
      assert.equal(sidebar.inset, 8);
      assert.equal(sidebar.rowGap, 4);
      assert.equal(sidebar.radius, '8px');
      assert.equal(sidebar.border, '0px');
      assert.equal(sidebar.inactive, 'rgba(0, 0, 0, 0)');
      const shortcuts = page.getByRole('tab', { name: 'Shortcuts', exact: true });
      await shortcuts.focus();
      await shortcuts.press('Enter');
      assert.equal(await shortcuts.getAttribute('aria-selected'), 'true');
      assert.equal(await shortcuts.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      await page.setViewportSize({ width: 559, height: 600 });
      assert.equal(await page.locator('.nav-list').evaluate(el => getComputedStyle(el).flexDirection), 'row');
      assert.equal(await shortcuts.isVisible(), true);
      await page.setViewportSize({ width: 560, height: 600 });
      assert.equal(await page.locator('.nav-list').evaluate(el => getComputedStyle(el).flexDirection), 'column');
    } finally { await page.close(); }
  });
}

test('Glass preserves circular titlebar controls and connected mode segments', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await startGlass(page);
    const icon = page.getByRole('button', { name: 'Settings', exact: true });
    assert.equal(await icon.evaluate(el => getComputedStyle(el).borderRadius), '50%');
    await icon.click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    const segments = await page.locator('.mode-btn').evaluateAll(els => els.map(el => getComputedStyle(el).borderRadius));
    assert.equal(segments.length, 3);
    assert.ok(segments.every(radius => radius === '0px'), JSON.stringify(segments));
  } finally { await page.close(); }
});

test('Glass statistics navigation uses translucent chrome only when frosted', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await startGlass(page);
    await page.getByRole('button', { name: 'Statistics', exact: true }).click();
    await page.locator('.stats-section .tabs').waitFor();
    const backgrounds = () => page.locator('.stats-section .tabs, .stats-section .tab:not(.active)').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
    const frosted = await backgrounds();
    assert.match(frosted[0], /^rgba\(.+, 0\.[0-9]+\)$/);
    assert.ok(frosted.slice(1).every(color => color === 'rgba(0, 0, 0, 0)'));
    await page.evaluate(() => window.__motionTest.setNativeMaterialAllowed(false));
    await materialMode(page, 'opaque');
    assert.ok((await backgrounds()).every(color => /^rgb\(/.test(color)));
  } finally { await page.close(); }
});

test('Glass About text remains readable over a bright desktop with an accent palette', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await startGlass(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'About', exact: true }).click();
    const { readFile } = await import('node:fs/promises');
    const theme = JSON.parse(await readFile(new URL('../static/themes/spandex.json', import.meta.url), 'utf8'));
    await page.evaluate(theme => window.__motionTest.emit('themes:changed', [theme]), theme);
    await page.evaluate(() => { document.documentElement.style.backgroundColor = '#ffffff'; });
    const [sample] = await textComposites(page.locator('.hero .name'));
    const { contrastRatio } = await import('../src/lib/utils/theme.ts');
    assert.ok(contrastRatio(sample.foreground, sample.background) >= 4.5, JSON.stringify(sample));
  } finally { await page.close(); }
});

// Resolve every ancestor layer rather than assuming the body or immediate parent
// is the text's background. A transparent content pane caused the original bug.
async function textComposites(locator) {
  return locator.evaluateAll(elements => elements.map(el => {
    const rgba = paint => {
      const n = paint.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return [...n.slice(0, 3), n[3] ?? 1];
    };
    const blend = (front, back) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3]));
    const hex = channels => '#' + channels.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');
    const ancestors = [];
    for (let node = el; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors) background = blend(rgba(getComputedStyle(node).backgroundColor), background);
    return { text: el.textContent.trim(), foreground: hex(blend(rgba(getComputedStyle(el).color), background)), background: hex(background) };
  }));
}

for (const [file, desktop, transparency] of [['graphite.json', '#000000'], ['pomotroid.json', '#ffffff']]
  .flatMap(([file, desktop]) => [100, 50, 0].map(value => [file, desktop, value]))) {
  test(`Glass content keeps ${file} readable at ${transparency}% over the opposite desktop`, async () => {
    const page = await browser.newPage({ viewport: { width: 840, height: 600 }, reducedMotion: 'reduce' });
    try {
      await page.addInitScript(value => sessionStorage.setItem('glass-transparency', String(value)), transparency);
      await startGlass(page);
      const { readFile } = await import('node:fs/promises');
      const theme = JSON.parse(await readFile(new URL(`../static/themes/${file}`, import.meta.url), 'utf8'));
      await page.evaluate(async ({ theme, desktop }) => {
        const { applyTheme } = await import('/src/lib/stores/theme.ts');
        applyTheme(theme);
        document.documentElement.style.backgroundColor = desktop;
      }, { theme, desktop });
      const { contrastRatio } = await import('../src/lib/utils/theme.ts');
      const check = async selector => {
        const locator = page.locator(selector);
        for (const part of selector.split(',')) assert.ok(await page.locator(part.trim()).count(), `rendered samples for ${part}`);
        for (const sample of await textComposites(locator)) {
          assert.ok(contrastRatio(sample.foreground, sample.background) >= 4.5, JSON.stringify(sample));
        }
      };
      const timerSurfaces = page.locator('.dial-stack, .round-label, .rounds, .timer-outer button, .titlebar .btn-icon, .titlebar .session-btn:not(.locked)');
      for (const paint of await timerSurfaces.evaluateAll(els => els.map(el => ({
        name: el.className, background: getComputedStyle(el).backgroundColor,
        before: getComputedStyle(el, '::before').content,
      })))) {
        assert.equal(paint.background, 'rgba(0, 0, 0, 0)', `${paint.name}: no timer or idle button backing`);
        assert.equal(paint.before, 'none', `${paint.name}: no text highlight backing`);
      }
      assert.equal(await page.locator('.titlebar').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'titlebar shares the window frost');
      for (const name of ['Reset', 'Statistics', 'Settings', 'Restart round', 'Skip round']) {
        const button = page.getByRole('button', { name, exact: true });
        await button.hover();
        assert.notEqual(await button.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', `${name}: visible hover feedback`);
        for (const sample of await textComposites(button)) assert.ok(contrastRatio(sample.foreground, sample.background) >= 4.5, `${name}: readable hover`);
      }
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await check('.profile-editor label, .group-title, .slider-label-row span');
      await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
      await check('.group-label, .customization label, .customization .hint, .transparency-label span');
      await page.getByRole('button', { name: 'Statistics', exact: true }).click();
      await check('.stats-section .card-label, .stats-section .card-value, .stats-section .section-title');
      await page.evaluate(() => window.__motionTest.setNativeMaterialAllowed(false));
      await page.waitForFunction(() => document.documentElement.dataset.windowMaterial === 'opaque');
      await check('.stats-section .card-label, .stats-section .card-value');
    } finally { await page.close(); }
  });
}

test('Glass content follows light, dark and automatic palette switching', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 }, reducedMotion: 'reduce' });
  try {
    await startGlass(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    const { contrastRatio } = await import('../src/lib/utils/theme.ts');
    for (const [mode, os] of [['Light', 'dark'], ['Dark', 'light'], ['Auto', 'light'], ['Auto', 'dark']]) {
      await page.emulateMedia({ colorScheme: os });
      await page.getByRole('button', { name: mode, exact: true }).click();
      const light = mode === 'Light' || (mode === 'Auto' && os === 'light');
      await page.waitForFunction(light => getComputedStyle(document.body).backgroundColor ===
        (light ? 'rgba(245, 240, 232, 0.25)' : 'rgba(47, 56, 75, 0.25)'), light);
      await page.evaluate(light => { document.documentElement.style.backgroundColor = light ? '#000000' : '#ffffff'; }, light);
      const [sample] = await textComposites(page.locator('#glass-transparency-hint'));
      assert.ok(contrastRatio(sample.foreground, sample.background) >= 4.5, `${mode}/${os}: ${JSON.stringify(sample)}`);
    }
  } finally { await page.close(); }
});

test('Glass transparency previews, persists, restores on reload and rolls back failed saves', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await appearance(page);
    assert.equal(await page.getByRole('slider', { name: 'Transparency', exact: true }).count(), 0);
    await choose(page, 'Interface style', 'Glass');
    const slider = page.getByRole('slider', { name: 'Transparency', exact: true });
    assert.equal(await slider.count(), 1);
    assert.equal(await slider.inputValue(), '100');
    await slider.evaluate(el => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.match((await canvasPaint(page)).body, /^rgb\(/);
    await page.evaluate(() => window.__motionTest.holdNextSave());
    await slider.dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('#glass-transparency').disabled);
    await page.evaluate(() => window.__motionTest.emit('settings:changed', { volume: .8 }));
    assert.match((await canvasPaint(page)).body, /^rgb\(/, 'pending preview survives unrelated settings');
    await page.evaluate(() => window.__motionTest.releaseSave());
    await page.waitForFunction(() => !document.querySelector('#glass-transparency').disabled);
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    assert.equal(await slider.inputValue(), '0');
    await slider.evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => window.__motionTest.setNextSaveError('Injected transparency failure'));
    await slider.dispatchEvent('change');
    await page.getByRole('alert').waitFor();
    assert.equal(await slider.inputValue(), '0');
    await slider.focus();
    await slider.press('End');
    await page.waitForFunction(() => !document.querySelector('#glass-transparency').disabled);
    assert.equal(await slider.inputValue(), '100');
    await choose(page, 'Interface style', 'Pomotroid');
    assert.equal(await slider.count(), 0);
  } finally { await page.close(); }
});

test('Glass inactive controls share translucent material instead of solid blocks', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await startGlass(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.mouse.move(830, 590);
    const colors = await page.locator('.themed-select, .mode-btn:not(.active), .picker-trigger, button[role="switch"]').evaluateAll(els => els.map(el => ({ name: el.className, color: getComputedStyle(el).backgroundColor })));
    assert.ok(colors.length >= 6);
    for (const { name, color } of colors) assert.match(color, /^rgba\(.+, 0(?:\.[0-9]+)?\)$/, `${name}: ${color}`);
    await page.evaluate(() => window.__motionTest.setNativeMaterialAllowed(false));
    await materialMode(page, 'opaque');
    const input = page.getByRole('combobox', { name: 'Font', exact: true });
    assert.match(await input.evaluate(el => getComputedStyle(el).backgroundColor), /^rgb\(/);
  } finally { await page.close(); }
});

test('Glass keeps icon-only mode selection visible at zero transparency', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await startGlass(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.evaluate(() => window.__motionTest.emit('themes:changed', [{ name: 'White custom', is_custom: true, colors: {
      '--color-background': '#ffffff', '--color-background-light': '#ffffff',
      '--color-foreground': '#ffffff', '--color-foreground-darker': '#ffffff',
    } }]));
    const slider = page.getByRole('slider', { name: 'Transparency', exact: true });
    await slider.evaluate(el => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.mouse.move(830, 590);
    const surfaces = await page.locator('.mode-btn.active').evaluate(el => ({
      selected: getComputedStyle(el).backgroundColor,
      group: getComputedStyle(el.parentElement).backgroundColor,
    }));
    assert.notEqual(surfaces.selected, surfaces.group, 'selected mode remains visible on the solid canvas');
  } finally { await page.close(); }
});

test('Glass form controls match the restrained theme row corners', async () => {
  const page = await browser.newPage({ viewport: { width: 840, height: 600 } });
  try {
    await startGlass(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    for (const control of [page.getByRole('combobox', { name: 'Font', exact: true }), page.getByRole('button', { name: 'Import Font', exact: true }), page.locator('.picker-trigger').first()]) {
      assert.equal(await control.evaluate(el => getComputedStyle(el).borderRadius), '6px');
    }
    assert.equal(await page.locator('.nav-item.active').evaluate(el => getComputedStyle(el).borderRadius), '8px');
  } finally { await page.close(); }
});
