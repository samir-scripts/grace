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


test('statistics layouts keep their content readable at desktop sizes', async () => {
  for (const [width, height] of [[720, 480], [840, 520], [360, 478], [240, 240], [1200, 800]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    try {
      await page.goto(`${serverUrl}/?animations=false`);
      await page.getByRole('button', { name: 'Statistics' }).click();
      for (const tab of ['Today', 'This Week', 'All Time']) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        if (tab === 'All Time') await page.waitForSelector('.totals');
        const labels = await page.locator('.hour-label, .day-label, .count-label, .month-label, .dow-label')
          .evaluateAll((elements) => elements.map((el) =>
            Number.parseFloat(getComputedStyle(el).fontSize) *
            el.ownerSVGElement.getBoundingClientRect().width / el.ownerSVGElement.viewBox.baseVal.width
          ));
        assert.ok(labels.every((size) => size >= 10.9), `${tab} chart labels are smaller than 11px: ${labels}`);
        const issues = await page.locator('.stats-section').evaluate((section) => {
          const problems = [];
          const bounds = (el) => el.getBoundingClientRect();
          for (const selector of ['.tabs', '.cards', '.summary', '.totals']) {
            const container = section.querySelector(selector);
            if (!container) continue;
            const children = [...container.children].filter((el) => bounds(el).width > 2);
            for (const el of children) {
              const r = bounds(el), p = bounds(container);
              if (r.left < p.left - 1 || r.right > p.right + 1) problems.push(`${selector} child outside container`);
              if (el.scrollWidth > el.clientWidth + 1) problems.push(`${selector} child text overflows`);
            }
            for (let i = 1; i < children.length; i++) {
              const a = bounds(children[i - 1]), b = bounds(children[i]);
              if (a.right > b.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1) problems.push(`${selector} children overlap`);
            }
          }
          for (const selector of ['.chart-wrap', '.heatmap-scroll']) {
            const chart = section.querySelector(selector);
            if (chart && chart.scrollWidth > chart.clientWidth + 1 && getComputedStyle(chart).overflowX !== 'auto') problems.push(`${selector} cannot scroll horizontally`);
          }
          const content = section.querySelector('.content');
          const view = content?.querySelector('.view');
          if (window.innerWidth === 720 && content && content.scrollHeight > content.clientHeight + 1) problems.push('default content needs vertical scrolling');
          if (content && view && view.scrollHeight > content.clientHeight + 1 && content.scrollHeight <= content.clientHeight + 1) problems.push('content cannot scroll vertically');
          return problems;
        });
        assert.deepEqual(issues, [], `${width}x${height} ${tab}: ${issues.join(', ')}`);
      }
    } finally { await context.close(); }
  }
});

test('yearly heatmap labels do not overlap or clip across locales and font packs', async () => {
  const context = await browser.newContext({ viewport: { width: 720, height: 480 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await page.goto(`${serverUrl}/?animations=false`);
    await page.getByRole('button', { name: 'Statistics' }).click();
    await page.getByRole('button', { name: 'All Time', exact: true }).click();
    await page.waitForSelector('.heatmap-svg .month-label');
    for (const language of ['en', 'de', 'es', 'fr', 'ja', 'pt', 'tr', 'zh']) {
      for (const font_pack of ['mona-sans', 'inter', 'roboto', 'jetbrains-mono']) {
        await page.evaluate(async ({ language, font_pack }) => {
          await window.__motionTest.emit('settings:changed', { language, font_pack });
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, { language, font_pack });
        const problems = await page.locator('.heatmap-svg').evaluate(svg => {
          const view = svg.viewBox.baseVal, problems = [];
          const months = [...svg.querySelectorAll('.month-label')].map(el => ({ label: el.textContent, box: el.getBBox() }));
          const days = [...svg.querySelectorAll('.dow-label')].map(el => ({ label: el.textContent, box: el.getBBox() }));
          for (const { label, box } of [...months, ...days]) {
            if (box.x < view.x - 0.1 || box.x + box.width > view.x + view.width + 0.1 || box.y < view.y - 0.1)
              problems.push(`clipped ${label}`);
          }
          for (let i = 1; i < months.length; i++)
            if (months[i - 1].box.x + months[i - 1].box.width > months[i].box.x + 0.1)
              problems.push(`overlap ${months[i - 1].label}/${months[i].label}`);
          return problems;
        });
        assert.deepEqual(problems, [], `${language}/${font_pack}: ${problems.join(', ')}`);
      }
    }
  } finally { await context.close(); }
});

test('statistics expose selected period and keyboard-accessible annual dates', async () => {
  const page = await browser.newPage({ viewport: { width: 720, height: 480 }, reducedMotion: 'reduce' });
  try {
    await page.goto(`${serverUrl}/?animations=false`);
    await page.getByRole('button', { name: 'Statistics' }).click();
    const allTime = page.getByRole('button', { name: 'All Time', exact: true });
    await allTime.click();
    assert.equal(await allTime.getAttribute('aria-pressed'), 'true');
    const heatmap = page.locator('.heatmap-scroll');
    await page.waitForSelector('.totals');
    await heatmap.focus();
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.heatmap-scroll').getBoundingClientRect();
      const selected = document.querySelector('.cell-selected').getBoundingClientRect();
      return selected.left >= viewport.left && selected.right <= viewport.right;
    });
    const announcement = page.locator('.heatmap-scroll + [aria-live]');
    const before = await announcement.textContent();
    await page.keyboard.press('ArrowLeft');
    assert.notEqual(await announcement.textContent(), before);
    assert.equal(await heatmap.locator('[tabindex]').count(), 0);
  } finally {
    await page.close();
  }
});

test('statistics show a retry for a load failure and display data after retry', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await page.goto(`${serverUrl}/?animations=false&stats_error`);
    await page.getByRole('button', { name: 'Statistics' }).click();
    const error = page.getByRole('alert').filter({ hasText: 'Could not load statistics.' });
    await error.waitFor();
    assert.equal(await page.locator('.card-value').count(), 0);
    await page.evaluate(() => window.__motionTest.setStatsFailure(false));
    await error.getByRole('button', { name: 'Retry' }).click();
    await page.locator('.card-value').first().waitFor();
    assert.equal(await error.count(), 0);
  } finally {
    await page.close();
  }
});

test('annual statistics retry independently after a heatmap load failure', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await page.goto(`${serverUrl}/?animations=false&stats_error`);
    await page.getByRole('button', { name: 'Statistics' }).click();
    await page.getByRole('button', { name: 'All Time', exact: true }).click();
    const error = page.getByRole('alert').filter({ hasText: 'Could not load statistics.' });
    await error.waitFor();
    assert.equal(await page.locator('.totals').count(), 0);
    await page.evaluate(() => window.__motionTest.setStatsFailure(false));
    await error.getByRole('button', { name: 'Retry' }).click();
    await page.locator('.totals').waitFor();
    assert.equal(await error.count(), 0);
  } finally {
    await page.close();
  }
});
