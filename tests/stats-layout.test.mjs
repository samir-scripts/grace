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
          if (window.innerWidth === 720) {
            const heatmap = section.querySelector('.heatmap-scroll');
            if (heatmap && heatmap.scrollWidth > heatmap.clientWidth + 1) problems.push('default heatmap clipped');
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
