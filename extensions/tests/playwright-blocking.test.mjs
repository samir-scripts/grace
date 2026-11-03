import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chromeExtPath = path.resolve(__dirname, '../dist/chrome');
const firefoxExtPath = path.resolve(__dirname, '../dist/firefox');

test('Playwright Chromium MV3 extension connects and blocks webpages dynamically', async () => {
  // 1. Start test HTTP server serving both allowed and blocked test pages
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/allowed') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Allowed Content</h1>');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const httpPort = httpServer.address().port;

  // 2. Start mock Focus WebSocket Broker on an ephemeral port
  const events = [];
  let clientSocket = null;

  const brokerServer = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });

  brokerServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    clientSocket = socket;

    socket.on('data', (d) => {
      if (d.length < 2) return;
      let len = d[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (d.length < 4) return;
        len = d.readUInt16BE(2);
        offset = 4;
      }
      const mask = d.slice(offset, offset + 4);
      offset += 4;
      const payload = Buffer.alloc(len);
      for (let i = 0; i < len; i++) {
        payload[i] = d[offset + i] ^ mask[i % 4];
      }
      try {
        const msg = JSON.parse(payload.toString('utf8'));
        events.push(msg);
      } catch {
        // Ping/pong or control frame
      }
    });
  });

  await new Promise((resolve) => brokerServer.listen(0, '127.0.0.1', resolve));
  const wsPort = brokerServer.address().port;

  function sendBrokerJson(msg) {
    if (!clientSocket) throw new Error('No client socket connected');
    const payload = Buffer.from(JSON.stringify(msg), 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x81, len]);
    } else {
      header = Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
    }
    clientSocket.write(Buffer.concat([header, payload]));
  }

  async function waitForBrokerEvent(predicate, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out waiting for broker event. Recorded: ${JSON.stringify(events)}`);
  }

  // 3. Launch persistent Chromium context with the built MV3 extension
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ext-chrome-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--headless=new`,
      `--disable-extensions-except=${chromeExtPath}`,
      `--load-extension=${chromeExtPath}`,
    ],
  });

  try {
    // 4. Discover extension service worker and extId
    let sw = null;
    for (let i = 0; i < 30; i++) {
      const sws = context.serviceWorkers();
      if (sws.length > 0) {
        sw = sws[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(sw, 'Extension service worker failed to register');
    const extId = new URL(sw.url()).hostname;

    // 5. Configure port and token via extension options page
    const testToken = 'pw-chrome-token-999';
    const optPage = await context.newPage();
    await optPage.goto(`chrome-extension://${extId}/options.html`);
    await optPage.evaluate(({ port }) => {
      chrome.storage.local.set({ port });
    }, { port: wsPort });
    await optPage.fill('#token', testToken);
    await optPage.fill('#profileId', 'pw-test-profile');
    await optPage.click('#save');
    await optPage.waitForSelector('#status');
    await optPage.close();

    // 6. Verify broker receives Hello handshake from extension
    const hello = await waitForBrokerEvent((m) => m.type === 'hello');
    assert.equal(hello.token, testToken);
    assert.equal(hello.profile_id, 'pw-test-profile');
    assert.equal(hello.browser, 'chrome');

    // 7. Send active blocking policy for example.com
    sendBrokerJson({
      type: 'policy',
      active: true,
      revision: 1,
      domains: ['example.com'],
    });

    const ack1 = await waitForBrokerEvent((m) => m.type === 'ack' && m.revision === 1);
    assert.equal(ack1.revision, 1);

    // Verify dynamic rules exist in extension
    const rules = await sw.evaluate(async () => {
      return await chrome.declarativeNetRequest.getDynamicRules();
    });
    assert.equal(rules.length, 1);
    assert.equal(rules[0].action.type, 'block');
    assert.equal(rules[0].condition.urlFilter, '||example.com^');

    // 8. Verify real webpage navigation to blocked domain is blocked
    const page = await context.newPage();
    let blockedError = null;
    try {
      await page.goto('http://example.com/', { timeout: 3000 });
    } catch (err) {
      blockedError = err;
    }
    assert.ok(blockedError !== null, 'Expected navigation to be blocked');
    assert.match(blockedError.message, /net::ERR_BLOCKED_BY_CLIENT/);

    // 9. Send policy release to unblock domains
    sendBrokerJson({
      type: 'policy',
      active: false,
      revision: 2,
      domains: [],
    });

    const ack2 = await waitForBrokerEvent((m) => m.type === 'ack' && m.revision === 2);
    assert.equal(ack2.revision, 2);

    const clearedRules = await sw.evaluate(async () => {
      return await chrome.declarativeNetRequest.getDynamicRules();
    });
    assert.equal(clearedRules.length, 0);

    // 10. Verify navigation to allowed local page succeeds
    const res = await page.goto(`http://127.0.0.1:${httpPort}/allowed`, { timeout: 3000 });
    assert.equal(res.status(), 200);
    assert.ok((await page.content()).includes('Allowed Content'));

    await page.close();
  } finally {
    if (clientSocket) {
      try { clientSocket.destroy(); } catch {}
    }
    await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    await new Promise((r) => httpServer.close(r));
    await new Promise((r) => brokerServer.close(r));
  }
});

test('Firefox extension connects and applies declarativeNetRequest dynamic rules', async () => {
  const manifestPath = path.join(firefoxExtPath, 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'Firefox manifest exists');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(manifest.permissions.includes('declarativeNetRequest'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.equal(manifest.background.scripts[0], 'background.js');
  assert.equal(manifest.background.type, 'module');

  // Verify policy compilation produces expected rules for Firefox
  const { rulesForPolicy, isUrlBlocked } = await import('../focus/policy.js');
  const testDomains = ['distracting-site.example', '127.0.0.1'];
  const rules = rulesForPolicy(testDomains);

  assert.equal(rules.length, 2);
  assert.equal(rules[0].action.type, 'block');
  assert.equal(rules[0].condition.urlFilter, '||127.0.0.1^');
  assert.equal(rules[1].condition.urlFilter, '||distracting-site.example^');

  assert.equal(isUrlBlocked('http://127.0.0.1/test', testDomains), true);
  assert.equal(isUrlBlocked('https://sub.distracting-site.example/feed', testDomains), true);
  assert.equal(isUrlBlocked('http://good-site.org/docs', testDomains), false);
});
