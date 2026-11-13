import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chromeExtPath = path.resolve(__dirname, '../dist/chrome');

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

  // 2. Independent authenticated Focus WebSocket broker on an ephemeral port.
  const events = [];
  const wireMessages = [];
  const testToken = 'pw-chrome-token-999';
  const prefix = 'pomotroid-focus-v3\n';
  const mac = (key, message) => crypto.createHmac('sha256', key).update(message).digest('hex');
  const brokerServer = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server: brokerServer });
  let clientSocket = null;
  let serverKey;
  let sendSequence = 0;
  let currentPolicy = { type: 'policy', version: 3, active: false, revision: 0, domains: [], lease_secs: 15 };
  let holdChallenge = false;
  let pendingChallenge;

  function sendBrokerJson(msg) {
    if (!clientSocket || !serverKey) throw new Error('No authenticated client socket connected');
    const sequence = ++sendSequence;
    const payload = JSON.stringify(msg);
    clientSocket.send(JSON.stringify({
      type: 'authenticated', sequence, payload,
      mac: mac(serverKey, `${prefix}frame\n${sequence}\n${payload}`),
    }));
  }

  wss.on('connection', socket => {
    clientSocket = socket;
    serverKey = undefined;
    sendSequence = 0;
    let clientNonce;
    let serverNonce;
    let clientKey;
    let receivedSequence = 0;
    socket.on('message', data => {
      const raw = data.toString();
      wireMessages.push(raw);
      const msg = JSON.parse(raw);
      if (msg.type === 'auth_init') {
        assert.equal(msg.version, 3);
        clientNonce = msg.client_nonce;
        serverNonce = crypto.randomBytes(32).toString('hex');
        const challenge = {
          type: 'auth_challenge', version: 3, server_nonce: serverNonce,
          proof: mac(testToken, `${prefix}server\n${clientNonce}\n${serverNonce}`),
        };
        if (holdChallenge) pendingChallenge = () => socket.send(JSON.stringify(challenge));
        else socket.send(JSON.stringify(challenge));
      } else if (msg.type === 'auth_response') {
        assert.equal(msg.version, 3);
        assert.equal(msg.proof, mac(testToken, `${prefix}client\n${clientNonce}\n${serverNonce}\n${msg.metadata}`));
        const metadata = JSON.parse(msg.metadata);
        assert.deepEqual(metadata, ['pw-test-profile']);
        clientKey = Buffer.from(mac(testToken, `${prefix}key-client\n${clientNonce}\n${serverNonce}\n${msg.metadata}`), 'hex');
        serverKey = Buffer.from(mac(testToken, `${prefix}key-server\n${clientNonce}\n${serverNonce}\n${msg.metadata}`), 'hex');
        events.push({ type: 'authenticated', metadata });
        sendBrokerJson(currentPolicy);
      } else if (msg.type === 'authenticated') {
        assert.equal(msg.sequence, ++receivedSequence);
        assert.equal(msg.mac, mac(clientKey, `${prefix}frame\n${msg.sequence}\n${msg.payload}`));
        events.push(JSON.parse(msg.payload));
      } else {
        assert.fail(`Unexpected broker message type: ${msg.type}`);
      }
    });
  });

  await new Promise((resolve) => brokerServer.listen(0, '127.0.0.1', resolve));
  const wsPort = brokerServer.address().port;

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
  let context = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--headless=new`,
        `--disable-extensions-except=${chromeExtPath}`,
        `--load-extension=${chromeExtPath}`,
      ],
    });
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
    // The broker token is an independent test-only credential.
    const optPage = await context.newPage();
    await optPage.goto(`chrome-extension://${extId}/options.html`);
    assert.equal(await optPage.locator('#advanced').isVisible(), false);
    assert.equal(await optPage.locator('#connectionStatus').textContent(), 'Disconnected');
    assert.equal(clientSocket, null, 'no socket opens before consent');
    await optPage.keyboard.press('Tab');
    assert.equal(await optPage.evaluate(() => document.activeElement.id), 'consentAccept');
    await optPage.screenshot({ path: '/tmp/grace-extension-before-consent.png' });
    await optPage.evaluate(({ port }) => {
      chrome.storage.local.set({ port });
    }, { port: wsPort });
    await optPage.click('#consentAccept');
    await optPage.locator('#advanced summary').click();
    await optPage.fill('#token', testToken);
    await optPage.fill('#profileId', 'pw-test-profile');
    await optPage.click('#save');
    await optPage.waitForSelector('#status');

    // 6. Verify mutual authentication without sending the shared token.
    await waitForBrokerEvent((m) => m.type === 'authenticated');
    await waitForBrokerEvent((m) => m.type === 'ack' && m.revision === 0);
    assert.ok(wireMessages.every((message) => !message.includes(testToken)));

    // 7. Send active blocking policy for example.com
    currentPolicy = { type: 'policy', version: 3, lease_secs: 15, active: true, revision: 1, domains: ['example.com'] };
    sendBrokerJson(currentPolicy);

    const ack1 = await waitForBrokerEvent((m) => m.type === 'ack' && m.revision === 1);
    assert.equal(ack1.revision, 1);

    // Verify dynamic rules exist in extension
    const rules = await sw.evaluate(async () => {
      return await chrome.declarativeNetRequest.getDynamicRules();
    });
    assert.equal(rules.length, 1);
    assert.equal(rules[0].action.type, 'block');
    assert.equal(rules[0].condition.urlFilter, '||example.com^');

    // 8. Verify allowed page loads, and real webpage navigation to blocked domain is blocked
    const page = await context.newPage();

    const allowedRes = await page.goto(`http://127.0.0.1:${httpPort}/allowed`, { timeout: 3000 });
    assert.equal(allowedRes.status(), 200);
    assert.ok((await page.content()).includes('Allowed Content'));

    let blockedError = null;
    try {
      await page.goto('http://example.com/', { timeout: 3000 });
    } catch (err) {
      blockedError = err;
    }
    assert.ok(blockedError !== null, 'Expected navigation to be blocked');
    assert.match(blockedError.message, /net::ERR_BLOCKED_BY_CLIENT/);

    // Stop the MV3 worker through Chromium, then wake it with an extension message.
    // DNR rules must survive worker termination and authentication must recover.
    const authCount = () => events.filter((event) => event.type === 'authenticated').length;
    const ackCount = () => events.filter((event) => event.type === 'ack' && event.revision === 1).length;
    let previousAuth = authCount();
    let previousAck = ackCount();
    holdChallenge = true;
    const cdp = await context.newCDPSession(optPage);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await optPage.evaluate(() => chrome.runtime.sendMessage({ type: 'connection:status' }));
    await optPage.waitForFunction(() => chrome.declarativeNetRequest.getDynamicRules().then(rules => rules.some(rule => rule.condition.urlFilter === '||example.com^')));
    await waitForBrokerEvent(() => Boolean(pendingChallenge));
    assert.equal(authCount(), previousAuth, 'worker must authenticate again before receiving policy');
    pendingChallenge(); pendingChallenge = undefined; holdChallenge = false;
    await waitForBrokerEvent(() => authCount() > previousAuth && ackCount() > previousAck);
    await cdp.detach();

    // Restart the browser using the same profile. Hold authentication so the
    // rule is observed before any policy can be sent over the new connection.
    previousAuth = authCount(); previousAck = ackCount(); holdChallenge = true;
    await context.close();
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ['--headless=new', `--disable-extensions-except=${chromeExtPath}`, `--load-extension=${chromeExtPath}`],
    });
    const restartedWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.equal(new URL(restartedWorker.url()).hostname, extId);
    const persistedRules = await restartedWorker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
    assert.equal(persistedRules.length, 1);
    assert.equal(persistedRules[0].condition.urlFilter, '||example.com^');
    await waitForBrokerEvent(() => Boolean(pendingChallenge));
    assert.equal(authCount(), previousAuth, 'restart must authenticate before receiving policy');
    pendingChallenge(); pendingChallenge = undefined; holdChallenge = false;
    await waitForBrokerEvent(() => authCount() > previousAuth && ackCount() > previousAck);
    sw = restartedWorker;
    const restartedOptions = await context.newPage();
    await restartedOptions.goto(`chrome-extension://${extId}/options.html`);
    const restartedPage = await context.newPage();
    await assert.rejects(restartedPage.goto('http://example.com/', { timeout: 3000 }), /net::ERR_BLOCKED_BY_CLIENT/);

    // 9. Send policy release to unblock domains
    sendBrokerJson({
      type: 'policy',
      version: 3,
      lease_secs: 15,
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

    // 10. Verify navigation to previously blocked domain succeeds after policy release
    const releasedRes = await restartedPage.goto('http://example.com/', { timeout: 4000 });
    assert.ok(releasedRes !== null && releasedRes.status() >= 200);
    const releasedContent = await restartedPage.content();
    assert.ok(releasedContent.toLowerCase().includes('example domain'));
    assert.ok(wireMessages.every((message) => !message.includes(testToken)));
    await restartedOptions.bringToFront();
    await restartedOptions.evaluate(() => window.dispatchEvent(new Event('focus')));
    await restartedOptions.waitForFunction(() => document.querySelector('#connectionStatus').textContent === 'Connected');
    await restartedOptions.click('#consentStop');
    await restartedOptions.waitForFunction(() => document.querySelector('#consentStatus').textContent === 'Data sharing is disabled.');
    assert.equal(await restartedOptions.locator('#advanced').isVisible(), false);
    assert.equal(await restartedOptions.locator('#connectionStatus').textContent(), 'Disconnected');
    await new Promise((resolve, reject) => {
      if (clientSocket.readyState === 3) return resolve();
      const timer = setTimeout(() => reject(new Error('socket did not close on withdrawal')), 3000);
      clientSocket.once('close', () => { clearTimeout(timer); resolve(); });
    });
    await restartedOptions.close();
    await restartedPage.close();
  } finally {
    if (clientSocket) clientSocket.terminate();
    wss.close();
    if (context) await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    await new Promise((r) => httpServer.close(r));
    await new Promise((r) => brokerServer.close(r));
  }
});

test('options use cached appearance before consent and remain usable at narrow widths', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grace-options-chrome-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, args: ['--headless=new', `--disable-extensions-except=${chromeExtPath}`, `--load-extension=${chromeExtPath}`],
    });
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(sw.url()).hostname;
    // Explicit test fixture: this is a cached palette, not a native-host response.
    const roles = ['background', 'background-light', 'foreground', 'foreground-darker', 'hover', 'selected', 'border', 'separator', 'button', 'button-text', 'status-error', 'status-success', 'status-warning'];
    const colors = Object.fromEntries(roles.map(role => [`--color-${role}`, ['foreground', 'foreground-darker', 'button-text', 'status-error', 'status-success', 'status-warning'].includes(role) ? '#ffffff' : '#123456']));
    await sw.evaluate(colors => chrome.storage.local.set({ focus_appearance: { type: 'appearance', version: 1, colors, animations_enabled: false } }), colors);
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`chrome-extension://${id}/options.html`);
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim() === '#123456');
    assert.equal(await page.locator('#advanced').isVisible(), false);
    assert.equal(await page.locator('#consentStatus').textContent(), 'Data sharing is disabled.');
    await page.locator('#chromeConnectionHelp').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#chromeConnectionHelp').textContent(), '', 'native pairing diagnostics stay silent before consent');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.animations), 'disabled');
    await page.screenshot({ path: '/tmp/grace-extension-cached-theme-narrow.png', fullPage: true });
    // Invalid cached data is ignored, leaving the default system theme in place.
    await page.evaluate(() => chrome.storage.local.set({ focus_appearance: { type: 'appearance', version: 1, colors: { '--color-background': 'url(evil)' }, animations_enabled: false } }));
    await page.reload();
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--background').trim() !== '#123456');
    assert.equal(await page.locator('#advanced').isVisible(), false);
    await page.close();
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
