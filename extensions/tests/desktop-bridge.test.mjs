import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('installed extension applies and releases policies from the Rust desktop bridge', { timeout: 90000, skip: process.env.POMOTROID_DISPOSABLE_GUEST !== '1' }, async () => {
  const portServer = net.createServer();
  await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  const server = http.createServer((req, res) => res.end('<h1>fixture content</h1>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const child = spawn('cargo', ['run', '--quiet', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'focus_bridge_fixture', '--', String(port)], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => {
    let timeout;
    try {
      const result = await Promise.race([lines.next(), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('bridge response timeout')), 15000);
      })]);
      assert.equal(result.done, false, 'bridge exited unexpectedly');
      return result.value;
    } finally {
      clearTimeout(timeout);
    }
  };
  const command = async text => { child.stdin.write(text + '\n'); return next(); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomotroid-bridge-'));
  let context;
  try {
    assert.equal(await next(), 'ready');
    const ext = path.resolve('extensions/dist/chrome');
    context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    assert.equal(id, 'cgibenlmgmblmalggjalnoaikjkdnoid');
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.evaluate(port => chrome.storage.local.set({ port }), port);
    await options.click('#consentAccept');
    await options.locator('#advanced summary').click();
    await options.fill('#token', 'fixture-token');
    await options.fill('#profileId', 'fixture-profile');
    await options.click('#save');
    await options.close();
    const deadline = Date.now() + 10000;
    while (await command('status') !== 'true') {
      if (Date.now() > deadline) throw new Error('extension did not connect to Rust bridge');
      await delay(100);
    }
    const page = await context.newPage();
    await page.goto(url);
    assert.match(await page.content(), /fixture content/);
    assert.equal(await command('apply'), 'applied');
    await page.waitForURL(`chrome-extension://${id}/blocked.html**`, { timeout: 5000 });
    const nextPage = await context.newPage();
    await assert.rejects(nextPage.goto(url), /ERR_BLOCKED_BY_CLIENT/);
    const cdp = await context.newCDPSession(nextPage);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    const stoppedDeadline = Date.now() + 5000;
    while (await command('status') !== 'false') {
      if (Date.now() > stoppedDeadline) throw new Error('extension worker did not disconnect');
      await delay(100);
    }
    await page.bringToFront();
    const reconnectDeadline = Date.now() + 10000;
    while (await command('status') !== 'true') {
      if (Date.now() > reconnectDeadline) throw new Error('extension did not reconnect after worker stop');
      await delay(100);
    }
    await assert.rejects(nextPage.goto(url), /ERR_BLOCKED_BY_CLIENT/);
    await cdp.detach();
    assert.equal(await command('release'), 'released');
    await nextPage.goto(url);
    assert.match(await nextPage.content(), /fixture content/);
  } finally {
    if (context) await context.close();
    child.stdin.end('quit\n');
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  }
});
